use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionState {
    Disconnected,
    Ready,
    Running,
    Pausing,
    Paused,
    Stopping,
    Stopped,
    Restarting,
    Steering,
    ManualTakeover,
    RecoveryRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthorizationMode {
    Inspect,
    Assist,
    Autopilot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    ReadOnly,
    NonSensitiveMutation,
    ExternalEffect,
    SensitiveAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ElementLocator {
    pub role: Option<String>,
    pub name: Option<String>,
    pub selector: Option<String>,
    pub text: Option<String>,
    pub test_id: Option<String>,
    pub point: Option<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionPayload {
    #[serde(rename = "type")]
    pub action_type: String,
    pub locator: Option<ElementLocator>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub value: Option<String>,
    pub url: Option<String>,
    pub expected_origin: Option<String>,
    pub predicate: Option<String>,
    pub timeout_ms: Option<u64>,
    pub scroll_direction: Option<String>,
    pub scroll_amount: Option<f64>,
    #[serde(default = "default_risk")]
    pub risk: RiskLevel,
    #[serde(default)]
    pub is_irreversible: bool,
}

fn default_risk() -> RiskLevel {
    RiskLevel::ReadOnly
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlType {
    Pause,
    Resume,
    Stop,
    Restart,
    Steer,
    TakeOver,
    ReturnControl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestartOptions {
    #[serde(default = "default_true")]
    pub from_current_page: bool,
    #[serde(default)]
    pub retry_safe_step: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlCommand {
    pub command: ControlType,
    pub run_id: String,
    pub epoch: u64,
    pub instruction: Option<String>,
    pub restart_options: Option<RestartOptions>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolEnvelope {
    pub v: u32,
    pub event: String,
    pub event_id: String,
    pub run_id: Option<String>,
    pub epoch: Option<u64>,
    pub sequence: Option<u64>,
    pub tab_id: Option<i64>,
    pub lease_id: Option<String>,
    pub idempotency_key: Option<String>,
    pub timestamp: String,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
    #[serde(default)]
    pub action: Option<ActionPayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalDecision {
    Approved,
    Denied,
    Modified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub approval_id: String,
    pub run_id: String,
    pub epoch: u64,
    pub action_idempotency_key: String,
    pub reason: String,
    pub risk: String,
    pub details: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalResolution {
    pub approval_id: String,
    pub decision: ApprovalDecision,
    pub resolved_by: String,
    pub resolved_at: String,
    pub notes: Option<String>,
}
