use crate::protocol::{ActionPayload, AuthorizationMode, RiskLevel};

pub struct PolicyResult {
    pub requires_approval: bool,
    pub is_forbidden: bool,
    pub reason: Option<String>,
}

pub fn is_forbidden_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("chrome://")
        || lower.starts_with("chrome-extension://")
        || lower.starts_with("edge://")
        || lower.starts_with("about:")
        || lower.starts_with("devtools://")
}

pub fn is_sensitive_pattern(text: &str) -> bool {
    let lower = text.to_lowercase();
    let keywords = [
        "checkout",
        "purchase",
        "pay",
        "buy",
        "order",
        "delete",
        "remove",
        "destroy",
        "terminate",
        "send",
        "submit",
        "post",
        "publish",
        "password",
        "passkey",
        "api_key",
        "secret",
        "token",
        "credential",
    ];
    keywords.iter().any(|&kw| lower.contains(kw))
}

pub fn evaluate_action(
    mode: &AuthorizationMode,
    action: &ActionPayload,
    current_origin: &str,
    allowed_origins: &[String],
) -> PolicyResult {
    if let Some(ref url) = action.url {
        if is_forbidden_url(url) {
            return PolicyResult {
                requires_approval: false,
                is_forbidden: true,
                reason: Some(format!(
                    "URL '{}' is restricted internal browser target.",
                    url
                )),
            };
        }
    }

    if !allowed_origins.is_empty()
        && !allowed_origins.contains(&"*".to_string())
        && !allowed_origins.contains(&current_origin.to_string())
    {
        return PolicyResult {
            requires_approval: true,
            is_forbidden: false,
            reason: Some(format!(
                "Origin '{}' outside allowed scopes.",
                current_origin
            )),
        };
    }

    if action.is_irreversible || action.risk == RiskLevel::SensitiveAction {
        return PolicyResult {
            requires_approval: true,
            is_forbidden: false,
            reason: Some(format!(
                "Action '{}' is sensitive or irreversible.",
                action.action_type
            )),
        };
    }

    let candidate_text = format!(
        "{} {} {}",
        action.text.as_deref().unwrap_or(""),
        action
            .locator
            .as_ref()
            .and_then(|l| l.name.as_deref())
            .unwrap_or(""),
        action
            .locator
            .as_ref()
            .and_then(|l| l.role.as_deref())
            .unwrap_or("")
    );
    if is_sensitive_pattern(&candidate_text) {
        return PolicyResult {
            requires_approval: true,
            is_forbidden: false,
            reason: Some(format!(
                "Action matches sensitive pattern in text '{}'",
                candidate_text.trim()
            )),
        };
    }

    match mode {
        AuthorizationMode::Inspect => {
            if action.risk != RiskLevel::ReadOnly {
                return PolicyResult {
                    requires_approval: true,
                    is_forbidden: false,
                    reason: Some("Inspect mode permits only read-only actions.".into()),
                };
            }
        }
        AuthorizationMode::Assist => {
            if action.risk == RiskLevel::ExternalEffect {
                return PolicyResult {
                    requires_approval: true,
                    is_forbidden: false,
                    reason: Some("Assist mode requires approval for external effects.".into()),
                };
            }
        }
        AuthorizationMode::Autopilot => {
            // Autopilot permits non-sensitive actions within scope
        }
    }

    PolicyResult {
        requires_approval: false,
        is_forbidden: false,
        reason: None,
    }
}
