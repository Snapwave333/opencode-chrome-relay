use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::db::Database;
use crate::policy::{evaluate_action, PolicyResult};
use crate::protocol::{
    AuthorizationMode, ControlCommand, ControlType, ExecutionState, ProtocolEnvelope,
};
use crate::state_machine::RunSession;

#[derive(Clone)]
pub struct Scheduler {
    db: Database,
    sessions: Arc<Mutex<HashMap<String, RunSession>>>,
    allowed_origins: Arc<Mutex<Vec<String>>>,
    auth_mode: Arc<Mutex<AuthorizationMode>>,
}

impl Scheduler {
    pub fn new(db: Database) -> Self {
        Scheduler {
            db,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            allowed_origins: Arc::new(Mutex::new(vec!["*".to_string()])),
            auth_mode: Arc::new(Mutex::new(AuthorizationMode::Assist)),
        }
    }

    pub fn set_mode(&self, mode: AuthorizationMode) {
        *self.auth_mode.lock().unwrap() = mode;
    }

    pub fn set_allowed_origins(&self, origins: Vec<String>) {
        *self.allowed_origins.lock().unwrap() = origins;
    }

    pub fn set_session_state(&self, run_id: &str, state: ExecutionState) {
        let mut map = self.sessions.lock().unwrap();
        if let Some(session) = map.get_mut(run_id) {
            session.state = state;
        }
    }

    pub fn create_session(&self, run_id: &str, name: Option<&str>) -> RunSession {
        let mut map = self.sessions.lock().unwrap();
        let session_name = name.map(|s| s.to_string()).unwrap_or_else(|| {
            format!("Session {}", &run_id[..std::cmp::min(run_id.len(), 8)])
        });
        let session = RunSession::with_name(run_id.to_string(), session_name.clone());
        let _ = self.db.create_or_update_run(
            run_id,
            Some(&session_name),
            None,
            None,
            None,
            ExecutionState::Ready,
            0,
            None,
            false,
        );
        map.insert(run_id.to_string(), session.clone());
        session
    }

    pub fn set_session_pinned(&self, run_id: &str, is_pinned: bool) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        if let Some(session) = map.get_mut(run_id) {
            session.is_pinned = is_pinned;
        }
        self.db.set_run_pinned(run_id, is_pinned).map_err(|e| e.to_string())
    }

    pub fn delete_session(&self, run_id: &str) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        if let Some(session) = map.remove(run_id) {
            if let Some(tab_id) = session.tab_id {
                let _ = self.db.release_tab_lease(tab_id, run_id);
            }
        }
        self.db.delete_run(run_id).map_err(|e| e.to_string())
    }

    pub fn close_session(&self, run_id: &str) -> Result<bool, String> {
        let mut map = self.sessions.lock().unwrap();
        let session = map.get(run_id).cloned();
        match session {
            Some(s) => {
                if s.is_pinned {
                    // Pinned sessions are preserved on close
                    Ok(false)
                } else {
                    // Unpinned sessions delete on close
                    if let Some(tab_id) = s.tab_id {
                        let _ = self.db.release_tab_lease(tab_id, run_id);
                    }
                    map.remove(run_id);
                    let _ = self.db.delete_run(run_id);
                    Ok(true) // Deleted
                }
            }
            None => {
                let _ = self.db.delete_run(run_id);
                Ok(true)
            }
        }
    }

    pub fn list_sessions(&self) -> Vec<RunSession> {
        let map = self.sessions.lock().unwrap();
        map.values().cloned().collect()
    }

    pub fn cleanup_unpinned(&self) -> Result<usize, String> {
        let mut map = self.sessions.lock().unwrap();
        map.retain(|_, s| s.is_pinned);
        self.db.cleanup_unpinned_runs().map_err(|e| e.to_string())
    }

    pub fn get_or_create_session(&self, run_id: &str) -> RunSession {
        let mut map = self.sessions.lock().unwrap();
        map.entry(run_id.to_string())
            .or_insert_with(|| {
                let session = RunSession::new(run_id.to_string());
                let _ = self.db.create_or_update_run(
                    run_id,
                    Some(&session.name),
                    None,
                    None,
                    None,
                    ExecutionState::Ready,
                    0,
                    None,
                    false,
                );
                session
            })
            .clone()
    }

    pub fn handle_control(&self, cmd: &ControlCommand) -> Result<ExecutionState, String> {
        let mut map = self.sessions.lock().unwrap();
        let session = map.get_mut(&cmd.run_id).ok_or_else(|| "Session not found".to_string())?;

        let new_state = session.apply_control(cmd.command.clone(), cmd.instruction.clone())?;
        let _ = self.db.update_run_state(&cmd.run_id, new_state.clone(), session.epoch);

        if cmd.command == ControlType::TakeOver || cmd.command == ControlType::Stop {
            if let Some(tab_id) = session.tab_id {
                let _ = self.db.release_tab_lease(tab_id, &cmd.run_id);
            }
        }

        Ok(new_state)
    }

    pub fn submit_action(
        &self,
        envelope: &ProtocolEnvelope,
    ) -> Result<PolicyResult, String> {
        let run_id = envelope.run_id.as_deref().ok_or("Missing run_id")?;
        let epoch = envelope.epoch.ok_or("Missing epoch")?;
        let sequence = envelope.sequence.unwrap_or(0);
        let idempotency_key = envelope.idempotency_key.as_deref().ok_or("Missing idempotency_key")?;
        let action = envelope.action.as_ref().ok_or("Missing action")?;

        let mut map = self.sessions.lock().unwrap();
        let session = map.get_mut(run_id).ok_or_else(|| "Session not found".to_string())?;

        // Check cancellation fence
        session.can_admit_action(epoch)?;

        // Check tab lease if tab specified
        if let Some(tab_id) = envelope.tab_id {
            let lease_id = envelope.lease_id.as_deref().unwrap_or("default_lease");
            let leased = self.db.acquire_tab_lease(lease_id, tab_id, run_id, 300).map_err(|e| e.to_string())?;
            if !leased {
                return Err(format!("Tab {} is leased by another run or lease expired", tab_id));
            }
            session.tab_id = Some(tab_id);
            session.lease_id = Some(lease_id.to_string());
        }

        // Evaluate policy
        let mode = self.auth_mode.lock().unwrap().clone();
        let allowed = self.allowed_origins.lock().unwrap().clone();
        let origin = action.expected_origin.as_deref().unwrap_or("");
        let pol = evaluate_action(&mode, action, origin, &allowed);

        if pol.is_forbidden {
            return Ok(pol);
        }

        // Record action in journal
        let payload_json = serde_json::to_string(action).unwrap_or_default();
        let admitted = self
            .db
            .record_action_pending(run_id, epoch, sequence, idempotency_key, &action.action_type, &payload_json)
            .map_err(|e| e.to_string())?;

        if !admitted {
            return Err(format!("Action with idempotency_key '{}' already finished; replay rejected", idempotency_key));
        }

        session.sequence = sequence;
        Ok(pol)
    }

    pub fn complete_action(
        &self,
        idempotency_key: &str,
        success: bool,
        verified: bool,
        outcome_json: &str,
    ) -> Result<(), String> {
        // Sanitize and purge screenshots right after use
        let sanitized_outcome = if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(outcome_json) {
            // Delete screenshot from disk if temporary file path was passed
            if let Some(path) = val.get("screenshot_path").and_then(|p| p.as_str()) {
                let _ = std::fs::remove_file(path);
            }
            // Purge large screenshot base64 bytes from SQLite journal
            if val.get("screenshot_base64").is_some() {
                val["screenshot_base64"] = serde_json::json!("[PURGED_RIGHT_AFTER_USE]");
                val["screenshot_deleted"] = serde_json::json!(true);
            }
            serde_json::to_string(&val).unwrap_or_else(|_| outcome_json.to_string())
        } else {
            outcome_json.to_string()
        };

        self.db
            .record_action_result(idempotency_key, success, verified, &sanitized_outcome)
            .map_err(|e| e.to_string())
    }
}
