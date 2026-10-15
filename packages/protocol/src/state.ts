import { z } from "zod";

export const ExecutionStateSchema = z.enum([
  "DISCONNECTED",
  "READY",
  "RUNNING",
  "PAUSING",
  "PAUSED",
  "STOPPING",
  "STOPPED",
  "RESTARTING",
  "STEERING",
  "MANUAL_TAKEOVER",
  "RECOVERY_REQUIRED",
]);

export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

export const AuthorizationModeSchema = z.enum(["inspect", "assist", "autopilot"]);
export type AuthorizationMode = z.infer<typeof AuthorizationModeSchema>;

export const RiskLevelSchema = z.enum([
  "read_only",
  "non_sensitive_mutation",
  "external_effect",
  "sensitive_action",
]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
