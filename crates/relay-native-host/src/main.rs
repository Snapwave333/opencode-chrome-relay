mod framing;

use futures_util::{SinkExt, StreamExt};
use std::io::{stdin, stdout};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let broker_url =
        std::env::var("RELAY_BROKER_URL").unwrap_or_else(|_| "ws://127.0.0.1:4098".into());
    let auth_token = std::env::var("RELAY_AUTH_TOKEN").unwrap_or_default();

    // Connect to local broker WebSocket
    let (ws_stream, _) = match connect_async(broker_url.as_str()).await {
        Ok(res) => res,
        Err(e) => {
            let err_json = serde_json::json!({
                "v": 1,
                "event": "bridge.disconnected",
                "error": format!("Could not connect to broker at {}: {}", broker_url, e)
            });
            let _ = framing::write_native_message(stdout(), &err_json.to_string());
            return Err(e.into());
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Send auth token if configured
    if !auth_token.is_empty() {
        let auth_msg = serde_json::json!({ "auth_token": auth_token });
        let _ = ws_sender
            .send(tokio_tungstenite::tungstenite::Message::Text(
                auth_msg.to_string(),
            ))
            .await;
    }

    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(100);

    // Stdio reading thread (blocking stdio)
    std::thread::spawn(move || {
        let mut handle = stdin();
        loop {
            match framing::read_native_message(&mut handle) {
                Ok(Some(msg)) => {
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
