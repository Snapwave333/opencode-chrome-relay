pub mod db;
pub mod policy;
pub mod protocol;
pub mod scheduler;
pub mod server;
pub mod state_machine;

#[cfg(test)]
mod tests {
    use super::*;
    use db::Database;
    use policy::is_forbidden_url;
    use protocol::{
        ActionPayload, ControlCommand, ControlType,
        ExecutionState, ProtocolEnvelope, RiskLevel,
    };
    use scheduler::Scheduler;
    use state_machine::RunSession;

    #[test]
    fn test_forbidden_urls() {
        assert!(is_forbidden_url("chrome://settings"));
        assert!(is_forbidden_url("chrome-extension://xyz/options.html"));
        assert!(is_forbidden_url("edge://version"));
        assert!(!is_forbidden_url("https://github.com"));
    }

    #[test]
    fn test_state_machine_controls() {
        let mut session = RunSession::new("run_1".into());
        assert_eq!(session.state, ExecutionState::Ready);

        // Pause from Ready is invalid, must be running
        session.state = ExecutionState::Running;
        let paused_state = session.apply_control(ControlType::Pause, None).unwrap();
        assert_eq!(paused_state, ExecutionState::Paused);

        // Resume from Paused
        let running_state = session.apply_control(ControlType::Resume, None).unwrap();
        assert_eq!(running_state, ExecutionState::Running);

        // Steer while running
        let steer_state = session
            .apply_control(ControlType::Steer, Some("New direction".into()))
            .unwrap();
        assert_eq!(steer_state, ExecutionState::Running);
        assert_eq!(session.pending_instruction.as_deref(), Some("New direction"));

        // Stop bumps epoch and halts
        let initial_epoch = session.epoch;
        let stopped_state = session.apply_control(ControlType::Stop, None).unwrap();
        assert_eq!(stopped_state, ExecutionState::Stopped);
        assert_eq!(session.epoch, initial_epoch + 1);

        // New action with old epoch must be rejected by cancellation fence
        assert!(session.can_admit_action(initial_epoch).is_err());
    }

    #[test]
    fn test_database_idempotency_journal() {
        let db = Database::new_in_memory().unwrap();

        // Record pending action
        let admitted = db
            .record_action_pending(
                "run_1",
                0,
                1,
                "run_1:0:1",
                "browser_click",
                "{\"type\":\"browser_click\"}",
            )
            .unwrap();
        assert!(admitted);

        // Complete action
        db.record_action_result("run_1:0:1", true, true, "{\"verified\":true}")
            .unwrap();

        // Re-attempting same idempotency key must reject replay
        let replay_admitted = db
            .record_action_pending(
                "run_1",
                0,
                1,
                "run_1:0:1",
                "browser_click",
                "{\"type\":\"browser_click\"}",
            )
            .unwrap();
        assert!(!replay_admitted);
    }

    #[test]
    fn test_tab_lease_locking() {
        let db = Database::new_in_memory().unwrap();

        // Acquire lease for tab 42 by run_A
        let ok1 = db.acquire_tab_lease("lease_1", 42, "run_A", 60).unwrap();
        assert!(ok1);

        // Another run attempts to lease same tab 42 -> denied
        let ok2 = db.acquire_tab_lease("lease_2", 42, "run_B", 60).unwrap();
        assert!(!ok2);

        // Release lease
        db.release_tab_lease(42, "run_A").unwrap();

        // Now run_B can lease
        let ok3 = db.acquire_tab_lease("lease_2", 42, "run_B", 60).unwrap();
        assert!(ok3);
    }

    #[test]
    fn test_scheduler_action_submission_and_fencing() {
        let db = Database::new_in_memory().unwrap();
        let scheduler = Scheduler::new(db);

        scheduler.get_or_create_session("run_1");
        scheduler.set_session_state("run_1", ExecutionState::Running);

        let envelope = ProtocolEnvelope {
            v: 1,
            event: "browser.action.request".into(),
            event_id: "evt_1".into(),
            run_id: Some("run_1".into()),
            epoch: Some(0),
            sequence: Some(1),
            tab_id: Some(10),
            lease_id: Some("lease_10".into()),
            idempotency_key: Some("run_1:0:1".into()),
            timestamp: "2026-10-15T00:00:00Z".into(),
            payload: None,
            action: Some(ActionPayload {
                action_type: "browser_snapshot".into(),
                locator: None,
                text: None,
                key: None,
                value: None,
                url: None,
                expected_origin: Some("https://example.com".into()),
                predicate: None,
                timeout_ms: None,
                scroll_direction: None,
                scroll_amount: None,
                risk: RiskLevel::ReadOnly,
                is_irreversible: false,
            }),
        };

        let pol = scheduler.submit_action(&envelope).unwrap();
        assert!(!pol.requires_approval);
        assert!(!pol.is_forbidden);

        // Pause run
        let ctrl = ControlCommand {
            command: ControlType::Pause,
            run_id: "run_1".into(),
            epoch: 0,
            instruction: None,
            restart_options: None,
            reason: None,
        };
        let new_state = scheduler.handle_control(&ctrl).unwrap();
        assert_eq!(new_state, ExecutionState::Paused);

        // Action while paused must fail
        let envelope_paused = ProtocolEnvelope {
            idempotency_key: Some("run_1:0:2".into()),
            sequence: Some(2),
            ..envelope.clone()
        };
        assert!(scheduler.submit_action(&envelope_paused).is_err());
    }

    #[test]
    fn test_screenshot_purged_right_after_use() {
        let db = Database::new_in_memory().unwrap();
        let scheduler = Scheduler::new(db.clone());

        // Create a temporary screenshot file
        let temp_dir = std::env::temp_dir();
        let screenshot_file = temp_dir.join(format!("test_screenshot_{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&screenshot_file, b"fake image bytes").unwrap();
        assert!(screenshot_file.exists());

        // Register pending action
        db.record_action_pending(
            "run_shot",
            0,
            1,
            "run_shot:0:1",
            "browser_screenshot",
            "{}",
        )
        .unwrap();

        let outcome = serde_json::json!({
            "success": true,
            "screenshot_path": screenshot_file.to_str().unwrap(),
            "screenshot_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        });

        // Complete action
        scheduler
            .complete_action("run_shot:0:1", true, true, &outcome.to_string())
            .unwrap();

        // 1. Verify screenshot file was deleted right after use
        assert!(!screenshot_file.exists());
    }
}
