import { z } from "zod";
import { AuthorizationMode, RiskLevel } from "./state.js";
import { ActionPayload } from "./actions.js";

export const ApprovalDecisionSchema = z.enum(["approved", "denied", "modified"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalRequestSchema = z.object({
  approval_id: z.string(),
  run_id: z.string(),
  epoch: z.number().int().nonnegative(),
  action_idempotency_key: z.string(),
  reason: z.string(),
  risk: z.string(),
  details: z.record(z.unknown()),
  created_at: z.string(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalResolutionSchema = z.object({
  approval_id: z.string(),
  decision: ApprovalDecisionSchema,
  resolved_by: z.enum(["user", "policy"]),
  resolved_at: z.string(),
  notes: z.string().optional(),
});
export type ApprovalResolution = z.infer<typeof ApprovalResolutionSchema>;

export const SENSITIVE_OPERATION_PATTERNS = [
  /checkout|purchase|pay|buy|order/i,
  /delete|remove|destroy|terminate/i,
  /send|submit|post|publish/i,
  /security|password|permission|api[-_]?key|credential/i,
];

export const FORBIDDEN_URL_PATTERNS = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^edge:\/\//i,
  /^about:/i,
  /^devtools:\/\//i,
];

export function isForbiddenUrl(url: string): boolean {
  return FORBIDDEN_URL_PATTERNS.some((pat) => pat.test(url));
}

export function evaluateActionPolicy(
  mode: AuthorizationMode,
  action: ActionPayload,
  origin: string,
  allowedOrigins: string[]
): { requiresApproval: boolean; reason?: string; isForbidden: boolean } {
  if (action.url && isForbiddenUrl(action.url)) {
    return {
      requiresApproval: false,
      isForbidden: true,
      reason: `Access to internal browser URL ${action.url} is strictly forbidden.`,
    };
  }

  if (allowedOrigins.length > 0 && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) {
    return {
      requiresApproval: true,
      isForbidden: false,
      reason: `Origin ${origin} is outside current authorized scopes: ${allowedOrigins.join(", ")}`,
    };
  }

  if (action.risk === "sensitive_action" || action.is_irreversible) {
    return {
      requiresApproval: true,
      isForbidden: false,
      reason: `Action is classified as sensitive or irreversible (${action.type}). User confirmation required.`,
    };
  }

  // Check element text or locator against sensitive operation patterns
  const candidateText = `${action.text || ""} ${action.locator?.name || ""} ${action.locator?.role || ""}`;
  for (const pattern of SENSITIVE_OPERATION_PATTERNS) {
    if (pattern.test(candidateText)) {
      return {
        requiresApproval: true,
        isForbidden: false,
        reason: `Target element matches sensitive pattern "${pattern.source}". User confirmation required.`,
      };
    }
  }

  if (mode === "inspect") {
    if (action.risk !== "read_only") {
      return {
        requiresApproval: true,
        isForbidden: false,
        reason: "Current authorization mode is 'inspect'. Mutations require approval.",
      };
    }
  } else if (mode === "assist") {
    if (action.risk === "external_effect") {
      return {
        requiresApproval: true,
        isForbidden: false,
        reason: "Current authorization mode is 'assist'. External effect requires approval.",
      };
    }
  }

  return { requiresApproval: false, isForbidden: false };
}
