use crate::protocol::ExecutionState;
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::sync::{Arc, Mutex};

// Helper to recover from poisoned mutex by extracting the guard
fn lock_or_recover<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    match mutex.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            // Mutex was poisoned but we can still access the data
            eprintln!("WARNING: Database mutex was poisoned, recovering...");
            Ok(poisoned.into_inner())
        }
    }
}

#[derive(Clone)]
pub struct Database {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                name TEXT,
                project_id TEXT,
                session_id TEXT,
                tab_id INTEGER,
                current_state TEXT NOT NULL,
                epoch INTEGER NOT NULL DEFAULT 0,
                origin_scope TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS action_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                epoch INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                action_type TEXT NOT NULL,
                status TEXT NOT NULL, -- pending, finished, failed
                payload_json TEXT NOT NULL,
                outcome_json TEXT,
                verified INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS checkpoints (
                checkpoint_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                epoch INTEGER NOT NULL,
                step_index INTEGER NOT NULL,
                page_url TEXT NOT NULL,
                page_title TEXT,
                serialized_state TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tab_leases (
                lease_id TEXT PRIMARY KEY,
                tab_id INTEGER NOT NULL UNIQUE,
                owner_run_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS approvals (
                approval_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                epoch INTEGER NOT NULL,
                idempotency_key TEXT NOT NULL,
                reason TEXT NOT NULL,
                decision TEXT,
                resolved_by TEXT,
                created_at TEXT NOT NULL,
                resolved_at TEXT
            );
            ",
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_or_update_run(
        &self,
        run_id: &str,
        name: Option<&str>,
        project_id: Option<&str>,
        session_id: Option<&str>,
        tab_id: Option<i64>,
        state: ExecutionState,
        epoch: u64,
        origin_scope: Option<&str>,
        is_pinned: bool,
    ) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();
        let state_str = serde_json::to_string(&state).unwrap().replace('\"', "");

        conn.execute(
            "INSERT INTO runs (run_id, name, project_id, session_id, tab_id, current_state, epoch, origin_scope, is_pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(run_id) DO UPDATE SET
                name = COALESCE(excluded.name, runs.name),
                current_state = excluded.current_state,
                epoch = excluded.epoch,
                tab_id = COALESCE(excluded.tab_id, runs.tab_id),
                is_pinned = excluded.is_pinned,
                updated_at = excluded.updated_at;",
            params![
                run_id,
                name,
                project_id,
                session_id,
                tab_id,
                state_str,
                epoch,
                origin_scope,
                if is_pinned { 1 } else { 0 },
                now
            ],
        )?;
        Ok(())
    }

    pub fn set_run_pinned(&self, run_id: &str, is_pinned: bool) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE runs SET is_pinned = ?1, updated_at = ?2 WHERE run_id = ?3",
            params![if is_pinned { 1 } else { 0 }, now, run_id],
        )?;
        Ok(())
    }

    pub fn delete_run(&self, run_id: &str) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        conn.execute(
            "DELETE FROM action_journal WHERE run_id = ?1",
            params![run_id],
        )?;
        conn.execute("DELETE FROM checkpoints WHERE run_id = ?1", params![run_id])?;
        conn.execute(
            "DELETE FROM tab_leases WHERE owner_run_id = ?1",
            params![run_id],
        )?;
        conn.execute("DELETE FROM approvals WHERE run_id = ?1", params![run_id])?;
        conn.execute("DELETE FROM runs WHERE run_id = ?1", params![run_id])?;
        Ok(())
    }

    pub fn cleanup_unpinned_runs(&self) -> Result<usize> {
        let conn = lock_or_recover(&self.conn)?;
        
        // BUG-015 fix: Use transaction for atomicity
        conn.execute("BEGIN IMMEDIATE", [])?;
        
        // Get count first
        let count: usize = conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE is_pinned = 0",
            [],
            |row| row.get(0)
        )?;
        
        // Delete in correct order (foreign key constraints)
        conn.execute("DELETE FROM action_journal WHERE run_id IN (SELECT run_id FROM runs WHERE is_pinned = 0)", [])?;
        conn.execute("DELETE FROM checkpoints WHERE run_id IN (SELECT run_id FROM runs WHERE is_pinned = 0)", [])?;
        conn.execute("DELETE FROM tab_leases WHERE owner_run_id IN (SELECT run_id FROM runs WHERE is_pinned = 0)", [])?;
        conn.execute("DELETE FROM approvals WHERE run_id IN (SELECT run_id FROM runs WHERE is_pinned = 0)", [])?;
        conn.execute("DELETE FROM runs WHERE is_pinned = 0", [])?;
        
        conn.execute("COMMIT", [])?;
        
        Ok(count)
    }

    pub fn update_run_state(&self, run_id: &str, state: ExecutionState, epoch: u64) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();
        let state_str = serde_json::to_string(&state).unwrap().replace('\"', "");

        conn.execute(
            "UPDATE runs SET current_state = ?1, epoch = ?2, updated_at = ?3 WHERE run_id = ?4",
            params![state_str, epoch, now, run_id],
        )?;
        Ok(())
    }

    pub fn record_action_pending(
        &self,
        run_id: &str,
        epoch: u64,
        sequence: u64,
        idempotency_key: &str,
        action_type: &str,
        payload_json: &str,
    ) -> Result<bool> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();

        // Check if already exists
        let mut stmt =
            conn.prepare("SELECT status FROM action_journal WHERE idempotency_key = ?1")?;
        let mut rows = stmt.query(params![idempotency_key])?;
        if let Some(row) = rows.next()? {
            let status: String = row.get(0)?;
            // Already recorded, cannot re-execute if finished or failed
            if status == "finished" {
                return Ok(false);
            }
        }

        conn.execute(
            "INSERT INTO action_journal (run_id, epoch, sequence, idempotency_key, action_type, status, payload_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?7)
             ON CONFLICT(idempotency_key) DO UPDATE SET
                status = 'pending',
                updated_at = excluded.updated_at;",
            params![run_id, epoch, sequence, idempotency_key, action_type, payload_json, now],
        )?;
        Ok(true)
    }

    pub fn record_action_result(
        &self,
        idempotency_key: &str,
        success: bool,
        verified: bool,
        outcome_json: &str,
    ) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();
        let status = if success { "finished" } else { "failed" };

        conn.execute(
            "UPDATE action_journal SET status = ?1, verified = ?2, outcome_json = ?3, updated_at = ?4
             WHERE idempotency_key = ?5",
            params![status, if verified { 1 } else { 0 }, outcome_json, now, idempotency_key],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_checkpoint(
        &self,
        checkpoint_id: &str,
        run_id: &str,
        epoch: u64,
        step_index: u64,
        page_url: &str,
        page_title: Option<&str>,
        serialized_state: &str,
    ) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO checkpoints (checkpoint_id, run_id, epoch, step_index, page_url, page_title, serialized_state, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(checkpoint_id) DO UPDATE SET
                epoch = excluded.epoch,
                step_index = excluded.step_index,
                page_url = excluded.page_url,
                page_title = excluded.page_title,
                serialized_state = excluded.serialized_state;",
            params![checkpoint_id, run_id, epoch, step_index, page_url, page_title, serialized_state, now],
        )?;
        Ok(())
    }

    pub fn acquire_tab_lease(
        &self,
        lease_id: &str,
        tab_id: i64,
        run_id: &str,
        duration_secs: u64,
    ) -> Result<bool> {
        // First clean up any expired leases (BUG-007 fix)
        let _ = self.cleanup_expired_leases();
        
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now();
        let now_str = now.to_rfc3339();
        let expires_at = (now + chrono::Duration::seconds(duration_secs as i64)).to_rfc3339();

        // Use atomic transaction with immediate mode to prevent TOCTOU race
        conn.execute("BEGIN IMMEDIATE", [])?;

        // Try to update existing lease if we own it or it's expired
        let updated = conn.execute(
            "UPDATE tab_leases 
             SET lease_id = ?1, owner_run_id = ?2, expires_at = ?3
             WHERE tab_id = ?4 AND (owner_run_id = ?2 OR expires_at < ?5)",
            params![lease_id, run_id, expires_at, tab_id, now_str],
        )?;

        if updated > 0 {
            conn.execute("COMMIT", [])?;
            return Ok(true);
        }

        // Check if another run holds a valid lease
        let conflict: Option<String> = conn
            .query_row(
                "SELECT owner_run_id FROM tab_leases WHERE tab_id = ?1 AND expires_at >= ?2",
                params![tab_id, now_str],
                |row| row.get(0),
            )
            .optional()?;

        if conflict.is_some() {
            conn.execute("ROLLBACK", [])?;
            return Ok(false);
        }

        // No existing lease, insert new one
        conn.execute(
            "INSERT INTO tab_leases (lease_id, tab_id, owner_run_id, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![lease_id, tab_id, run_id, expires_at, now_str],
        )?;

        conn.execute("COMMIT", [])?;
        Ok(true)
    }

    pub fn cleanup_expired_leases(&self) -> Result<usize> {
        let conn = lock_or_recover(&self.conn)?;
        let now = chrono::Utc::now().to_rfc3339();
        let deleted = conn.execute(
            "DELETE FROM tab_leases WHERE expires_at < ?1",
            params![now],
        )?;
        Ok(deleted)
    }

    pub fn release_tab_lease(&self, tab_id: i64, run_id: &str) -> Result<()> {
        let conn = lock_or_recover(&self.conn)?;
        conn.execute(
            "DELETE FROM tab_leases WHERE tab_id = ?1 AND owner_run_id = ?2",
            params![tab_id, run_id],
        )?;
        Ok(())
    }
}
