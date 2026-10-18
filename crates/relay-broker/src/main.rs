use relay_broker::db::Database;
use relay_broker::scheduler::Scheduler;
use relay_broker::server::BrokerServer;
use std::net::SocketAddr;

fn generate_or_load_auth_token() -> String {
    // Try to load existing token from config
    let config_dir = dirs::config_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .expect("Could not determine config directory");
    
    let token_dir = config_dir.join("opencode-relay");
    let token_file = token_dir.join("auth-token");
    
    // Try to read existing token
    if let Ok(token) = std::fs::read_to_string(&token_file) {
        let token = token.trim();
        if !token.is_empty() {
            return token.to_string();
        }
    }
    
    // Generate new secure random token
    use rand::Rng;
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    
    // Save token with restricted permissions
    if let Err(e) = std::fs::create_dir_all(&token_dir) {
        eprintln!("Warning: Could not create config directory {:?}: {}", token_dir, e);
        return token;
    }
    
    if let Err(e) = std::fs::write(&token_file, &token) {
        eprintln!("Warning: Could not save auth token to {:?}: {}", token_file, e);
        eprintln!("The token will be regenerated on next restart unless RELAY_AUTH_TOKEN is set.");
        return token;
    }
    
    // Set restrictive permissions (Unix only; Windows uses ACLs differently)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600)) {
            eprintln!("Warning: Could not set restrictive permissions on {:?}: {}", token_file, e);
        }
    }
    
    println!("Generated new auth token and saved to: {:?}", token_file);
    println!("Token file permissions: owner read/write only (0600)");
    
    token
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting OpenCode Chrome Relay Broker...");

    let db_path = std::env::var("RELAY_DB_PATH").unwrap_or_else(|_| "opencode_relay.sqlite".into());
    let db = Database::new(&db_path)?;
    let scheduler = Scheduler::new(db);

    let host = std::env::var("RELAY_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("RELAY_PORT")
        .unwrap_or_else(|_| "4098".into())
        .parse()
        .unwrap_or(4098);
    let addr: SocketAddr = format!("{}:{}", host, port).parse()?;

    // ALWAYS require authentication - generate token if not provided
    let token = std::env::var("RELAY_AUTH_TOKEN")
        .unwrap_or_else(|_| generate_or_load_auth_token());
    
    if token.is_empty() {
        eprintln!("FATAL: Auth token is empty. Set RELAY_AUTH_TOKEN or allow auto-generation.");
        std::process::exit(1);
    }
    
    println!("Broker will require authentication with token (first 8 chars): {}...", 
             &token.chars().take(8).collect::<String>());
    
    let server = BrokerServer::new(addr, token, scheduler);

    server.run().await?;
    Ok(())
}
