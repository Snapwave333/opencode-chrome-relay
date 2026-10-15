use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use futures_util::{SinkExt, StreamExt};
use crate::scheduler::Scheduler;
use crate::protocol::{ControlCommand, ProtocolEnvelope};

pub struct BrokerServer {
    addr: SocketAddr,
    auth_token: String,
    scheduler: Scheduler,
    event_sender: broadcast::Sender<String>,
}

impl BrokerServer {
    pub fn new(addr: SocketAddr, auth_token: String, scheduler: Scheduler) -> Self {
        let (tx, _rx) = broadcast::channel(100);
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
                if let Err(e) = handle_connection(stream, peer_addr, auth_token, scheduler, event_tx, &mut event_rx).await {
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
    let ws_stream = accept_async(stream).await?;
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    let mut authenticated = auth_token.is_empty();

    loop {
        tokio::select! {
            msg_res = ws_receiver.next() => {
                match msg_res {
                    Some(Ok(msg)) => {
                        if msg.is_text() {
                            let text = msg.to_text()?;
                            let parsed: serde_json::Value = serde_json::from_str(text)?;

                            if !authenticated {
                                if let Some(token) = parsed.get("auth_token").and_then(|t| t.as_str()) {
                                    if token == auth_token {
                                        authenticated = true;
                                        let ok_resp = serde_json::json!({
                                            "v": 1,
                                            "event": "bridge.connected",
                                            "event_id": "auth_ok",
                                            "status": "authenticated"
                                        });
                                        ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(ok_resp.to_string())).await?;
                                        continue;
                                    }
                                }
                                let unauth = serde_json::json!({ "error": "Unauthorized" });
                                ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(unauth.to_string())).await?;
                                return Ok(());
                            }

                            // Process message
                            if let Ok(ctrl) = serde_json::from_value::<ControlCommand>(parsed.clone()) {
                                match scheduler.handle_control(&ctrl) {
                                    Ok(new_state) => {
                                        let resp = serde_json::json!({
                                            "v": 1,
                                            "event": "run.state_changed",
                                            "event_id": uuid::Uuid::new_v4().to_string(),
                                            "run_id": ctrl.run_id,
                                            "epoch": ctrl.epoch,
                                            "payload": {
                                                "new_state": new_state,
                                                "command": ctrl.command
                                            }
                                        });
                                        let resp_str = resp.to_string();
                                        let _ = event_tx.send(resp_str.clone());
                                        ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(resp_str)).await?;
                                    }
                                    Err(err) => {
                                        let err_resp = serde_json::json!({
                                            "error": err,
                                            "run_id": ctrl.run_id
                                        });
                                        ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(err_resp.to_string())).await?;
                                    }
                                }
                            } else if let Ok(envelope) = serde_json::from_value::<ProtocolEnvelope>(parsed.clone()) {
                                if envelope.event == "browser.action.request" || envelope.action.is_some() {
                                    match scheduler.submit_action(&envelope) {
                                        Ok(policy) => {
                                            let resp = serde_json::json!({
                                                "v": 1,
                                                "event": if policy.requires_approval { "approval.requested" } else { "action.started" },
                                                "event_id": uuid::Uuid::new_v4().to_string(),
                                                "run_id": envelope.run_id,
                                                "epoch": envelope.epoch,
                                                "sequence": envelope.sequence,
                                                "idempotency_key": envelope.idempotency_key,
                                                "payload": {
                                                    "requires_approval": policy.requires_approval,
                                                    "is_forbidden": policy.is_forbidden,
                                                    "reason": policy.reason
                                                }
                                            });
                                            let resp_str = resp.to_string();
                                            let _ = event_tx.send(resp_str.clone());
                                            ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(resp_str)).await?;
                                        }
                                        Err(err) => {
                                            let err_resp = serde_json::json!({
                                                "v": 1,
                                                "event": "action.failed",
                                                "event_id": uuid::Uuid::new_v4().to_string(),
                                                "run_id": envelope.run_id,
                                                "idempotency_key": envelope.idempotency_key,
                                                "payload": { "error": err }
                                            });
                                            let _ = event_tx.send(err_resp.to_string());
                                            ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(err_resp.to_string())).await?;
                                        }
                                    }
                                } else {
                                    // Broadcast other events
                                    let _ = event_tx.send(text.to_string());
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(Box::new(e)),
                    None => break,
                }
            }
            ev = event_rx.recv() => {
                if let Ok(ev_str) = ev {
                    ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(ev_str)).await?;
                }
            }
        }
    }

    Ok(())
}
