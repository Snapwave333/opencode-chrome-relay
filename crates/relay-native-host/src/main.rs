mod framing;

use futures_util::{SinkExt, StreamExt};
use std::io::{stdin, stdout};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;

fn get_auth_token() -> String {
    // Check environment variable first
    if let Ok(token) = std::env::var("RELAY_AUTH_TOKEN") {
        if !token.is_empty() {
            return token;
        }
    }
    
    // Try to read from config file
    let config_dir = dirs::config_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")));
    
    if let Some(dir) = config_dir {
        let token_file = dir.join("opencode-relay").join("auth-token");
        if let Ok(token) = std::fs::read_to_string(&token_file) {
            let token = token.trim();
            if !token.is_empty() {
                return token.to_string();
            }
        }
    }
    
    String::new()
}

/// The NVIDIA NIM key OpenCode already uses, so the extension needn't ask for it again.
/// Order: NVIDIA_API_KEY env var, then OpenCode's auth store (`opencode auth login`).
fn get_nim_key() -> String {
    if let Ok(key) = std::env::var("NVIDIA_API_KEY") {
        if !key.trim().is_empty() {
            return key.trim().to_string();
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("share").join("opencode").join("auth.json"));
    }
    if let Some(data) = dirs::data_dir() {
        candidates.push(data.join("opencode").join("auth.json"));
    }

    for path in candidates {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let Ok(auth) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if let Some(key) = auth.pointer("/nvidia/key").and_then(|k| k.as_str()) {
            if !key.trim().is_empty() {
                return key.trim().to_string();
            }
        }
    }

    String::new()
}

async fn connect_with_retry(
    broker_url: &str,
    max_retries: u32,
) -> Result<
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    Box<dyn std::error::Error>,
> {
    let mut attempt = 0;
    let mut delay_ms = 1000;
    
    loop {
        match connect_async(broker_url).await {
            Ok((stream, _)) => return Ok(stream),
            Err(e) if attempt < max_retries => {
                attempt += 1;
                eprintln!(
                    "Connection attempt {} failed: {}. Retrying in {}ms...",
                    attempt, e, delay_ms
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                delay_ms = (delay_ms * 2).min(30000); // Cap at 30s
            }
            Err(e) => return Err(e.into()),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let broker_url =
        std::env::var("RELAY_BROKER_URL").unwrap_or_else(|_| "ws://127.0.0.1:4098".into());
    let auth_token = get_auth_token();

    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(100);

    // Clone token for the stdio thread
    let auth_token_for_thread = auth_token.clone();

    // Stdio reading thread (BUG-013 partial fix). Started before the broker connects so
    // local requests (auth token, NIM key) are answered even when the broker is down.
    std::thread::spawn(move || {
        let mut handle = stdin();
        loop {
            match framing::read_native_message(&mut handle) {
                Ok(Some(msg)) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                        let local_reply = match parsed.get("request").and_then(|r| r.as_str()) {
                            Some("get_auth_token") => {
                                Some(serde_json::json!({ "auth_token": auth_token_for_thread }))
                            }
                            Some("get_nim_key") => Some(serde_json::json!({ "nim_key": get_nim_key() })),
                            _ => None,
                        };
                        if let Some(reply) = local_reply {
                            // Respond directly to Chrome; don't forward to broker
                            let mut out = stdout();
                            let _ = framing::write_native_message(&mut out, &reply.to_string());
                            continue;
                        }
                    }

                    if stdin_tx.blocking_send(msg).is_err() {
                        break;
                    }
                }
                Ok(None) => break, // EOF
                Err(e) => {
                    eprintln!("Error reading native message: {}", e);
                    break;
                }
            }
        }
    });

    // Connect to local broker WebSocket with retry (BUG-008 fix)
    let ws_stream = match connect_with_retry(&broker_url, 5).await {
        Ok(stream) => stream,
        Err(e) => {
            let err_json = serde_json::json!({
                "v": 1,
                "event": "bridge.disconnected",
                "error": format!("Could not connect to broker at {} after retries: {}", broker_url, e)
            });
            let _ = framing::write_native_message(stdout(), &err_json.to_string());
            // Keep serving local requests until Chrome closes the port
            while stdin_rx.recv().await.is_some() {}
            return Err(e);
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Send auth token (BUG-004 fix)
    if !auth_token.is_empty() {
        let auth_msg = serde_json::json!({ "auth_token": auth_token });
        let _ = ws_sender
            .send(tokio_tungstenite::tungstenite::Message::Text(
                auth_msg.to_string(),
            ))
            .await;
    } else {
        eprintln!("Warning: No auth token found. Connection may be rejected by broker.");
    }

    // Relay loop
    while let Some(selected) = tokio::select! {
        from_chrome = stdin_rx.recv() => from_chrome.map(RelayEvent::FromChrome),
        from_broker = ws_receiver.next() => from_broker.map(RelayEvent::FromBroker),
    } {
        match selected {
            RelayEvent::FromChrome(msg) => {
                if ws_sender
                    .send(tokio_tungstenite::tungstenite::Message::Text(msg))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            RelayEvent::FromBroker(Ok(msg)) => {
                if msg.is_text() {
                    if let Ok(text) = msg.to_text() {
                        let mut out = stdout();
                        if framing::write_native_message(&mut out, text).is_err() {
                            break;
                        }
                    }
                }
            }
            RelayEvent::FromBroker(Err(_)) => break,
        }
    }

    Ok(())
}

enum RelayEvent {
    FromChrome(String),
    FromBroker(
        Result<tokio_tungstenite::tungstenite::Message, tokio_tungstenite::tungstenite::Error>,
    ),
}
