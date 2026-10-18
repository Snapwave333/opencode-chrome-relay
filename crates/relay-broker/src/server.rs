use crate::protocol::{ControlCommand, ProtocolEnvelope};
use crate::scheduler::Scheduler;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

const BROADCAST_CAPACITY: usize = 1024;
const AUTH_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);
const RELAYABLE_EVENTS: &[&str] = &[
    "action.preview",
    "approval.resolved",
    "bridge.connected",
    "bridge.disconnected",
    "bridge.heartbeat",
    "chat.response",
    "checkpoint.saved",
    "extension.reload",
    "observation.ready",
    "run.completed",
    "run.started",
    "session.bound",
    "session.switched",
    "steer.received",
    "tab.attach_requested",
    "tab.attached",
    "tab.detached",
];

fn is_allowed_origin(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => {
            o.starts_with("chrome-extension://")
                || o.starts_with("http://127.0.0.1")
                || o.starts_with("http://localhost")
        }
    }
}

fn tokens_match(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub struct BrokerServer {
    addr: SocketAddr,
    auth_token: String,
    scheduler: Scheduler,
    event_sender: broadcast::Sender<String>,
}

impl BrokerServer {
    pub fn new(addr: SocketAddr, auth_token: String, scheduler: Scheduler) -> Self {
        let (tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        BrokerServer {
            addr,
            auth_token,
            scheduler,
            event_sender: tx,
        }
    }

    pub fn get_event_sender(&self) -> broadcast::Sender<String> {
        self.event_sender.clone()
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(self.addr).await?;
        println!("Relay Broker listening on {}", self.addr);

        loop {
            let (stream, peer_addr) = listener.accept().await?;
            let scheduler = self.scheduler.clone();
            let auth_token = self.auth_token.clone();
            let event_tx = self.event_sender.clone();
            let mut event_rx = event_tx.subscribe();

            tokio::spawn(async move {
                if let Err(e) = handle_connection(
                    stream,
                    peer_addr,
                    auth_token,
                    scheduler,
                    event_tx,
                    &mut event_rx,
                )
                .await
                {
                    eprintln!("Connection error from {}: {}", peer_addr, e);
                }
            });
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    _peer_addr: SocketAddr,
    auth_token: String,
    scheduler: Scheduler,
    event_tx: broadcast::Sender<String>,
    event_rx: &mut broadcast::Receiver<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[allow(clippy::result_large_err)]
    let check_origin = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let origin = req.headers().get("origin").and_then(|o| o.to_str().ok());
        if is_allowed_origin(origin) {
            Ok(resp)
        } else {
            let mut err = ErrorResponse::new(Some("Forbidden origin".into()));
            *err.status_mut() = StatusCode::FORBIDDEN;
            Err(err)
        }
    };
    let ws_stream = accept_hdr_async(stream, check_origin).await?;
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    let mut authenticated = auth_token.is_empty();
    let auth_deadline = tokio::time::sleep(AUTH_DEADLINE);
    tokio::pin!(auth_deadline);

    loop {
        tokio::select! {
            _ = &mut auth_deadline, if !authenticated => {
                let unauth = serde_json::json!({ "error": "Authentication timeout" });
                ws_sender.send(Message::Text(unauth.to_string())).await?;
                return Ok(());
            }
            msg_res = ws_receiver.next() => {
                match msg_res {
                    Some(Ok(msg)) => {
                        if msg.is_text() {
                            let text = msg.to_text()?;
                            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) else {
                                let err = serde_json::json!({ "error": "Invalid JSON message" });
                                ws_sender.send(Message::Text(err.to_string())).await?;
                                continue;
                            };

                            if !authenticated {
                                if let Some(token) = parsed.get("auth_token").and_then(|t| t.as_str()) {
                                    if tokens_match(token, &auth_token) {
                                        authenticated = true;
                                        let ok_resp = serde_json::json!({
                                            "v": 1,
                                            "event": "bridge.connected",
                                            "event_id": "auth_ok",
                                            "status": "authenticated"
                                        });
                                        ws_sender.send(Message::Text(ok_resp.to_string())).await?;
                                        continue;
                                    }
                                }
                                let unauth = serde_json::json!({ "error": "Unauthorized" });
                                ws_sender.send(Message::Text(unauth.to_string())).await?;
                                return Ok(());
                            }

                            // Process message
                            if let Ok(ctrl) = ControlCommand::deserialize(&parsed) {
                                match scheduler.handle_control(&ctrl) {
                                    Ok((new_state, epoch)) => {
                                        let resp = serde_json::json!({
                                            "v": 1,
                                            "event": "run.state_changed",
                                            "event_id": uuid::Uuid::new_v4().to_string(),
                                            "timestamp": chrono::Utc::now().to_rfc3339(),
                                            "run_id": ctrl.run_id,
                                            "epoch": epoch,
                                            "payload": {
                                                "new_state": new_state,
                                                "command": ctrl.command,
                                                "instruction": ctrl.instruction
                                            }
                                        });
                                        let resp_str = resp.to_string();
                                        let _ = event_tx.send(resp_str);
                                    }
                                    Err(err) => {
                                        let err_resp = serde_json::json!({
                                            "error": err,
                                            "run_id": ctrl.run_id
                                        });
                                        ws_sender.send(Message::Text(err_resp.to_string())).await?;
                                    }
                                }
                            } else if let Ok(envelope) = ProtocolEnvelope::deserialize(&parsed) {
                                if envelope.event == "browser.action.request" {
                                    match scheduler.submit_action(&envelope) {
                                        Ok(policy) if policy.is_forbidden => {
                                            let err_resp = serde_json::json!({
                                                "v": 1,
                                                "event": "action.failed",
                                                "event_id": uuid::Uuid::new_v4().to_string(),
                                                "timestamp": chrono::Utc::now().to_rfc3339(),
                                                "run_id": envelope.run_id,
                                                "idempotency_key": envelope.idempotency_key,
                                                "payload": { "error": policy.reason, "is_forbidden": true }
                                            });
                                            let resp_str = err_resp.to_string();
                                            let _ = event_tx.send(resp_str);
                                        }
                                        Ok(policy) => {
                                            let resp = serde_json::json!({
                                                "v": 1,
                                                "event": if policy.requires_approval { "approval.requested" } else { "action.started" },
                                                "event_id": uuid::Uuid::new_v4().to_string(),
                                                "timestamp": chrono::Utc::now().to_rfc3339(),
                                                "run_id": envelope.run_id,
                                                "epoch": envelope.epoch,
                                                "sequence": envelope.sequence,
                                                "tab_id": envelope.tab_id,
                                                "idempotency_key": envelope.idempotency_key,
                                                "action": envelope.action,
                                                "payload": {
                                                    "requires_approval": policy.requires_approval,
                                                    "is_forbidden": policy.is_forbidden,
                                                    "reason": policy.reason
                                                }
                                            });
                                            let resp_str = resp.to_string();
                                            let _ = event_tx.send(resp_str);
                                        }
                                        Err(err) => {
                                            let err_resp = serde_json::json!({
                                                "v": 1,
                                                "event": "action.failed",
                                                "event_id": uuid::Uuid::new_v4().to_string(),
                                                "timestamp": chrono::Utc::now().to_rfc3339(),
                                                "run_id": envelope.run_id,
                                                "idempotency_key": envelope.idempotency_key,
                                                "payload": { "error": err }
                                            });
                                            let _ = event_tx.send(err_resp.to_string());
                                        }
                                    }
                                } else if envelope.event == "action.started" {
                                    match scheduler.evaluate_relayed_action(&envelope) {
                                        Ok(policy) if !policy.is_forbidden && !policy.requires_approval => {
                                            let _ = event_tx.send(text.to_string());
                                        }
                                        Ok(policy) => {
                                            let err = serde_json::json!({
                                                "error": policy.reason.unwrap_or_else(|| "Action requires approval".into()),
                                                "idempotency_key": envelope.idempotency_key
                                            });
                                            ws_sender.send(Message::Text(err.to_string())).await?;
                                        }
                                        Err(err) => {
                                            let err = serde_json::json!({
                                                "error": err,
                                                "idempotency_key": envelope.idempotency_key
                                            });
                                            ws_sender.send(Message::Text(err.to_string())).await?;
                                        }
                                    }
                                } else if envelope.event == "action.finished" || envelope.event == "action.failed" {
                                    if let Some(idem) = envelope.idempotency_key.as_deref() {
                                        let is_ok = envelope.event == "action.finished";
                                        let outcome_str = envelope
                                            .payload
                                            .as_ref()
                                            .map(|v| v.to_string())
                                            .unwrap_or_else(|| "{}".to_string());
                                        let _ = scheduler.complete_action(idem, is_ok, is_ok, &outcome_str);
                                    }
                                    let _ = event_tx.send(text.to_string());
                                } else if envelope.event == "session.create" {
                                    let run_id = envelope.run_id.unwrap_or_else(|| format!("run_{}", uuid::Uuid::new_v4()));
                                    let name = envelope.payload.as_ref().and_then(|p| p.get("name")).and_then(|n| n.as_str());
                                    let session = scheduler.create_session(&run_id, name);
                                    let resp = serde_json::json!({
                                        "v": 1,
                                        "event": "session.created",
                                        "event_id": uuid::Uuid::new_v4().to_string(),
                                        "run_id": session.run_id,
                                        "payload": {
                                            "run_id": session.run_id,
                                            "name": session.name,
                                            "is_pinned": session.is_pinned,
                                            "state": session.state
                                        }
                                    });
                                    let resp_str = resp.to_string();
                                    let _ = event_tx.send(resp_str);
                                } else if envelope.event == "session.delete" {
                                    if let Some(run_id) = envelope.run_id {
                                        let _ = scheduler.delete_session(&run_id);
                                        let resp = serde_json::json!({
                                            "v": 1,
                                            "event": "session.deleted",
                                            "event_id": uuid::Uuid::new_v4().to_string(),
                                            "run_id": run_id,
                                            "payload": { "run_id": run_id }
                                        });
                                        let resp_str = resp.to_string();
                                        let _ = event_tx.send(resp_str);
                                    }
                                } else if envelope.event == "session.pin" {
                                    if let Some(run_id) = envelope.run_id {
                                        let is_pinned = envelope.payload.as_ref().and_then(|p| p.get("is_pinned")).and_then(|b| b.as_bool()).unwrap_or(true);
                                        let _ = scheduler.set_session_pinned(&run_id, is_pinned);
                                        let resp = serde_json::json!({
                                            "v": 1,
                                            "event": if is_pinned { "session.pinned" } else { "session.unpinned" },
                                            "event_id": uuid::Uuid::new_v4().to_string(),
                                            "run_id": run_id,
                                            "payload": { "run_id": run_id, "is_pinned": is_pinned }
                                        });
                                        let resp_str = resp.to_string();
                                        let _ = event_tx.send(resp_str);
                                    }
                                } else if envelope.event == "session.close" {
                                    if let Some(run_id) = envelope.run_id {
                                        let deleted = scheduler.close_session(&run_id).unwrap_or(false);
                                        let event_name = if deleted { "session.deleted" } else { "session.closed" };
                                        let resp = serde_json::json!({
                                            "v": 1,
                                            "event": event_name,
                                            "event_id": uuid::Uuid::new_v4().to_string(),
                                            "run_id": run_id,
                                            "payload": { "run_id": run_id, "deleted": deleted }
                                        });
                                        let resp_str = resp.to_string();
                                        let _ = event_tx.send(resp_str);
                                    }
                                } else if envelope.event == "session.list" {
                                    let sessions = scheduler.list_sessions();
                                    let session_items: Vec<_> = sessions.iter().map(|s| {
                                        serde_json::json!({
                                            "run_id": s.run_id,
                                            "name": s.name,
                                            "is_pinned": s.is_pinned,
                                            "state": s.state,
                                            "tab_id": s.tab_id
                                        })
                                    }).collect();
                                    let resp = serde_json::json!({
                                        "v": 1,
                                        "event": "session.list",
                                        "event_id": uuid::Uuid::new_v4().to_string(),
                                        "payload": { "sessions": session_items }
                                    });
                                    ws_sender.send(Message::Text(resp.to_string())).await?;
                                } else if RELAYABLE_EVENTS.contains(&envelope.event.as_str()) {
                                    let _ = event_tx.send(text.to_string());
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(Box::new(e)),
                    None => break,
                }
            }
            ev = event_rx.recv(), if authenticated => {
                match ev {
                    Ok(ev_str) => ws_sender.send(Message::Text(ev_str)).await?,
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        let notice = serde_json::json!({
                            "v": 1,
                            "event": "bridge.lagged",
                            "event_id": uuid::Uuid::new_v4().to_string(),
                            "payload": { "dropped": dropped }
                        });
                        ws_sender.send(Message::Text(notice.to_string())).await?;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    Ok(())
}
