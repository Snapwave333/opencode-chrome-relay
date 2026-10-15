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

export const NVIDIA_NIM_FREE_MODELS = {
  generalText: "meta/llama-3.3-70b-instruct",
  fastText: "meta/llama-3.1-8b-instruct",
  reasoning: "nvidia/nemotron-4-340b-instruct",
  vision: "meta/llama-3.2-11b-vision-instruct",
  fallbackVision: "nvidia/neva-22b",
} as const;

export const SessionItemSchema = z.object({
  run_id: z.string(),
  name: z.string(),
  is_pinned: z.boolean().default(false),
  tab_id: z.number().int().optional(),
  state: ExecutionStateSchema.default("READY"),
  created_at: z.string(),
  model: z.string().default(NVIDIA_NIM_FREE_MODELS.generalText),
  vision_model: z.string().default(NVIDIA_NIM_FREE_MODELS.vision),
});
export type SessionItem = z.infer<typeof SessionItemSchema>;
