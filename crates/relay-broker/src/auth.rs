use std::fs;
use std::path::PathBuf;

pub fn get_auth_token() -> Result<String, Box<dyn std::error::Error>> {
    // First check environment variable
    if let Ok(token) = std::env::var("RELAY_AUTH_TOKEN") {
        if !token.is_empty() {
            return Ok(token);
        }
    }
    
    // Then check config file
    let token_path = get_token_path()?;
    let token = fs::read_to_string(&token_path)?
        .trim()
        .to_string();
    
    if token.is_empty() {
        return Err("Auth token file is empty".into());
    }
    
    Ok(token)
}

pub fn get_token_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let config_dir = dirs::config_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .ok_or("Could not determine config directory")?;
    
    Ok(config_dir.join("opencode-relay").join("auth-token"))
}
