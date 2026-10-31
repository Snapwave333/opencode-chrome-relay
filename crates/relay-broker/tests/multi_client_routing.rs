use futures_util::{SinkExt, StreamExt};
use relay_broker::db::Database;
use relay_broker::scheduler::Scheduler;
use relay_broker::server::BrokerServer;
use serde_json::{json, Value};
use std::net::{SocketAddr, TcpListener};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn free_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap()
}

async fn start_broker() -> (SocketAddr, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::new(dir.path().join("relay.sqlite").to_str().unwrap()).unwrap();
    let addr = free_addr();
    let server = BrokerServer::new(addr, String::new(), Scheduler::new(db));
    tokio::spawn(async move {
        let _ = server.run().await;
    });
    for _ in 0..50 {
        if TcpStream::connect(addr).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    (addr, dir)
}

async fn connect(addr: SocketAddr) -> Client {
    connect_async(format!("ws://{}", addr)).await.unwrap().0
}

async fn send(client: &mut Client, value: Value) {
    client.send(Message::Text(value.to_string())).await.unwrap();
}

async fn frames_within(client: &mut Client, window: Duration) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(Some(Ok(msg))) = timeout(window, client.next()).await {
        if let Ok(text) = msg.to_text() {
            if let Ok(v) = serde_json::from_str::<Value>(text) {
                out.push(v);
            }
        }
    }
    out
}

fn request(run_id: &str, key: &str, tab_id: i64) -> Value {
    json!({
        "v": 1,
        "event": "browser.action.request",
        "event_id": format!("evt_{}", key),
        "timestamp": "2026-10-31T00:00:00Z",
        "run_id": run_id,
        "epoch": 0,
        "sequence": 1,
        "tab_id": tab_id,
        "idempotency_key": key,
        "action": { "type": "browser_snapshot", "background": true }
    })
}

fn finished(key: &str) -> Value {
    json!({
        "v": 1,
        "event": "action.finished",
        "event_id": format!("fin_{}", key),
        "timestamp": "2026-10-31T00:00:01Z",
        "idempotency_key": key,
        "payload": { "success": true, "from_extension": true }
    })
}

fn results_for(frames: &[Value]) -> Vec<String> {
    frames
        .iter()
        .filter(|f| f["event"] == "action.finished")
        .map(|f| {
            f["idempotency_key"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn concurrent_agents_on_separate_tabs_only_receive_their_own_results() {
    let (addr, _dir) = start_broker().await;
    let mut agent_a = connect(addr).await;
    let mut agent_b = connect(addr).await;
    let mut extension = connect(addr).await;

    send(&mut agent_a, request("run_agent_a", "a:1", 101)).await;
    send(&mut agent_b, request("run_agent_b", "b:1", 202)).await;

    let started = frames_within(&mut extension, Duration::from_millis(400)).await;
    let started_keys: Vec<_> = started
        .iter()
        .filter(|f| f["event"] == "action.started")
        .map(|f| f["idempotency_key"].as_str().unwrap().to_string())
        .collect();
    assert!(started_keys.contains(&"a:1".to_string()));
    assert!(started_keys.contains(&"b:1".to_string()));
    let forwarded = started
        .iter()
        .find(|f| f["idempotency_key"] == "a:1")
        .unwrap();
    assert_eq!(forwarded["action"]["background"], json!(true));

    frames_within(&mut agent_a, Duration::from_millis(100)).await;
    frames_within(&mut agent_b, Duration::from_millis(100)).await;

    send(&mut extension, finished("b:1")).await;
    send(&mut extension, finished("a:1")).await;

    let a_frames = frames_within(&mut agent_a, Duration::from_millis(400)).await;
    let b_frames = frames_within(&mut agent_b, Duration::from_millis(400)).await;
    assert_eq!(results_for(&a_frames), vec!["a:1".to_string()]);
    assert_eq!(results_for(&b_frames), vec!["b:1".to_string()]);
}

#[tokio::test]
async fn a_second_run_cannot_steal_a_leased_tab() {
    let (addr, _dir) = start_broker().await;
    let mut agent_a = connect(addr).await;
    let mut agent_b = connect(addr).await;

    send(&mut agent_a, request("run_agent_a", "a:lease", 303)).await;
    let a_frames = frames_within(&mut agent_a, Duration::from_millis(300)).await;
    assert!(a_frames
        .iter()
        .any(|f| f["event"] == "action.started" && f["idempotency_key"] == "a:lease"));

    send(&mut agent_b, request("run_agent_b", "b:lease", 303)).await;
    let b_frames = frames_within(&mut agent_b, Duration::from_millis(300)).await;
    let failure = b_frames
        .iter()
        .find(|f| f["event"] == "action.failed" && f["idempotency_key"] == "b:lease")
        .expect("lease conflict should fail fast");
    assert!(failure["payload"]["error"]
        .as_str()
        .unwrap()
        .contains("leased by another run"));
}

#[tokio::test]
async fn results_for_untracked_keys_still_broadcast() {
    let (addr, _dir) = start_broker().await;
    let mut observer = connect(addr).await;
    let mut extension = connect(addr).await;

    send(&mut extension, finished("legacy:1")).await;
    let frames = frames_within(&mut observer, Duration::from_millis(400)).await;
    assert_eq!(results_for(&frames), vec!["legacy:1".to_string()]);
}
