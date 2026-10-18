use relay_broker::db::Database;
use relay_broker::scheduler::Scheduler;
use relay_broker::server::BrokerServer;
use std::net::SocketAddr;
use tokio::time::{timeout, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};

#[tokio::test]
async fn test_broker_auth_enforcement() {
    // Start broker on a test port with a known token
    let test_token = "test-auth-token-12345678";
    let db = Database::new_in_memory().unwrap();
    let scheduler = Scheduler::new(db);
    // Use a high port to avoid conflicts
    let addr: SocketAddr = "127.0.0.1:14098".parse().unwrap();
    let server = BrokerServer::new(addr, test_token.to_string(), scheduler);
    let broker_url = "ws://127.0.0.1:14098";
    
    // Spawn server in background
    tokio::spawn(async move {
        let _ = server.run().await;
    });
    
    // Wait a bit for server to start
    tokio::time::sleep(Duration::from_millis(200)).await;
    
    // Test 1: Connection with NO token should be rejected
    {
        let result = test_connection(broker_url, None).await;
        // Should either fail to connect or be explicitly rejected
        match result {
            Ok(false) => println!("✓ No token correctly rejected"),
            Err(_) => println!("✓ No token connection failed (acceptable)"),
            Ok(true) => panic!("Connection without token should NOT be accepted"),
        }
    }
    
    // Test 2: Connection with WRONG token should be rejected
    {
        let result = test_connection(broker_url, Some("wrong-token")).await;
        match result {
            Ok(false) => println!("✓ Wrong token correctly rejected"),
            Err(_) => println!("✓ Wrong token connection failed (acceptable)"),
            Ok(true) => panic!("Connection with wrong token should NOT be accepted"),
        }
    }
    
    // Test 3: Connection with CORRECT token should be accepted
    {
        let result = test_connection(broker_url, Some(test_token)).await;
        match result {
            Ok(true) => println!("✓ Correct token accepted"),
            Ok(false) => panic!("Connection with correct token was rejected"),
            Err(e) => panic!("Connection with correct token failed: {}", e),
        }
    }
}

async fn test_connection(url: &str, token: Option<&str>) -> Result<bool, Box<dyn std::error::Error>> {
    let (ws_stream, _) = match connect_async(url).await {
        Ok((stream, response)) => (stream, response),
        Err(e) => return Err(e.into()),
    };
    let (mut sink, mut stream) = ws_stream.split();
    
    // Send auth token if provided
    if let Some(t) = token {
        let auth_msg = serde_json::json!({ "auth_token": t });
        if sink.send(Message::Text(auth_msg.to_string())).await.is_err() {
            return Ok(false); // Send failed = rejected
        }
    }
    
    // Wait for server response
    match timeout(Duration::from_millis(1000), stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            // Parse the response
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                // Check for auth success
                if parsed.get("event").and_then(|e| e.as_str()) == Some("bridge.connected") &&
                   parsed.get("status").and_then(|s| s.as_str()) == Some("authenticated") {
                    return Ok(true); // Authenticated!
                }
                // Check for explicit error
                if parsed.get("error").is_some() {
                    return Ok(false); // Rejected
                }
            }
            // Got some other message - unclear, assume rejected
            Ok(false)
        }
        Ok(Some(Ok(Message::Close(_)))) => Ok(false), // Server closed = rejected
        Ok(Some(Ok(_))) => Ok(false), // Other message types = unexpected
        Ok(Some(Err(_))) => Ok(false), // Error = rejected
        Ok(None) => Ok(false), // Connection closed = rejected
        Err(_) => Ok(false), // Timeout = rejected (no token was sent or invalid)
    }
}
