use crate::protocol::{ControlType, ExecutionState};

#[derive(Debug, Clone)]
pub struct RunSession {
    pub run_id: String,
    pub name: String,
    pub is_pinned: bool,
    pub state: ExecutionState,
    pub epoch: u64,
    pub sequence: u64,
    pub tab_id: Option<i64>,
    pub lease_id: Option<String>,
    pub pending_instruction: Option<String>,
}

impl RunSession {
    pub fn new(run_id: String) -> Self {
        RunSession {
            run_id: run_id.clone(),
            name: format!("Session {}", run_id.chars().take(8).collect::<String>()),
            is_pinned: false,
            state: ExecutionState::Ready,
            epoch: 0,
            sequence: 0,
            tab_id: None,
            lease_id: None,
            pending_instruction: None,
        }
    }

    pub fn with_name(run_id: String, name: String) -> Self {
        RunSession {
            run_id,
            name,
            is_pinned: false,
            state: ExecutionState::Ready,
            epoch: 0,
            sequence: 0,
            tab_id: None,
            lease_id: None,
            pending_instruction: None,
        }
    }

    pub fn can_admit_action(&self, cmd_epoch: u64) -> Result<(), String> {
        if cmd_epoch != self.epoch {
            return Err(format!(
                "Stale epoch rejection: command epoch {} does not match active run epoch {}",
                cmd_epoch, self.epoch
            ));
        }

        match self.state {
            ExecutionState::Running => Ok(()),
            ExecutionState::Ready => Ok(()),
            ExecutionState::Pausing | ExecutionState::Paused => {
                Err("Action rejected: run is paused or pausing".into())
            }
            ExecutionState::Stopping | ExecutionState::Stopped => {
                Err("Action rejected: run is stopped or stopping".into())
            }
            ExecutionState::ManualTakeover => {
                Err("Action rejected: user has taken over manual control".into())
            }
            ExecutionState::Disconnected => Err("Action rejected: disconnected".into()),
            ExecutionState::RecoveryRequired => {
                Err("Action rejected: recovery required before resuming".into())
            }
            ExecutionState::Restarting => {
                Err("Action rejected: run is currently restarting".into())
            }
            ExecutionState::Steering => Err("Action rejected: run is currently steering".into()),
        }
    }

    pub fn apply_control(
        &mut self,
        control: ControlType,
        instruction: Option<String>,
    ) -> Result<ExecutionState, String> {
        let prev = self.state.clone();
        match control {
            ControlType::Pause => {
                match self.state {
                    ExecutionState::Running => {
                        self.state = ExecutionState::Pausing;
                        // Settle to Paused immediately if idle
                        self.state = ExecutionState::Paused;
                        Ok(self.state.clone())
                    }
                    ExecutionState::Paused => Ok(ExecutionState::Paused),
                    _ => Err(format!("Cannot pause from state {:?}", prev)),
                }
            }
            ControlType::Resume => match self.state {
                ExecutionState::Paused => {
                    self.state = ExecutionState::Running;
                    Ok(self.state.clone())
                }
                _ => Err(format!("Cannot resume from state {:?}", prev)),
            },
            ControlType::Stop => {
                // Invalidate epoch to fence out any pending or delayed commands
                self.epoch += 1;
                self.state = ExecutionState::Stopping;
                self.state = ExecutionState::Stopped;
                Ok(self.state.clone())
            }
            ControlType::Restart => {
                // Invalidate epoch and start fresh execution epoch
                self.epoch += 1;
                self.sequence = 0;
                self.state = ExecutionState::Restarting;
                self.state = ExecutionState::Running;
                Ok(self.state.clone())
            }
            ControlType::Steer => match self.state {
                ExecutionState::Running | ExecutionState::Paused => {
                    self.state = ExecutionState::Steering;
                    self.pending_instruction = instruction;
                    self.state = ExecutionState::Running;
                    Ok(self.state.clone())
                }
                _ => Err(format!("Cannot steer from state {:?}", prev)),
            },
            ControlType::TakeOver => {
                self.state = ExecutionState::ManualTakeover;
                Ok(self.state.clone())
            }
            ControlType::ReturnControl => match self.state {
                ExecutionState::ManualTakeover => {
                    self.state = ExecutionState::Ready;
                    Ok(self.state.clone())
                }
                _ => Err(format!("Cannot return control from state {:?}", prev)),
            },
        }
    }
}
