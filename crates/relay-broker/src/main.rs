use relay_broker::db::Database;
use relay_broker::scheduler::Scheduler;
use relay_broker::server::BrokerServer;
use std::net::SocketAddr;

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

    let token = std::env::var("RELAY_AUTH_TOKEN").unwrap_or_default();
    let server = BrokerServer::new(addr, token, scheduler);

    server.run().await?;
    Ok(())
}
