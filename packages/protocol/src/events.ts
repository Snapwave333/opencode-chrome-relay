import { z } from "zod";
import { ActionPayloadSchema } from "./actions.js";
import { ExecutionStateSchema } from "./state.js";
import { ApprovalRequestSchema, ApprovalResolutionSchema } from "./policy.js";

export const EventTypeSchema = z.enum([
  "bridge.connected",
  "bridge.disconnected",
  "session.bound",
  "session.created",
  "session.deleted",
  "session.pinned",
  "session.unpinned",
  "session.closed",
  "session.switched",
  "session.list",
  "tab.attach_requested",
  "tab.attached",
  "tab.detached",
  "run.started",
  "run.state_changed",
  "observation.ready",
  "action.preview",
  "action.started",
  "action.finished",
  "action.failed",
  "approval.requested",
  "approval.resolved",
  "steer.received",
  "chat.response",
  "checkpoint.saved",
  "run.completed",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const ProtocolEnvelopeSchema = z.object({
  v: z.literal(1),
  event: EventTypeSchema,
  event_id: z.string(),
  run_id: z.string().optional(),
  epoch: z.number().int().nonnegative().optional(),
  sequence: z.number().int().nonnegative().optional(),
  tab_id: z.number().int().optional(),
  lease_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  timestamp: z.string().default(() => new Date().toISOString()),
  payload: z.record(z.unknown()).optional(),
  action: ActionPayloadSchema.optional(),
});
export type ProtocolEnvelope = z.infer<typeof ProtocolEnvelopeSchema>;

export const StateChangedPayloadSchema = z.object({
  previous_state: ExecutionStateSchema,
  new_state: ExecutionStateSchema,
  epoch: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
export type StateChangedPayload = z.infer<typeof StateChangedPayloadSchema>;

export const ActionFinishedPayloadSchema = z.object({
  success: z.boolean(),
  verified: z.boolean(),
  elapsed_ms: z.number().nonnegative(),
  outcome_summary: z.string(),
  error: z.string().optional(),
});
export type ActionFinishedPayload = z.infer<typeof ActionFinishedPayloadSchema>;
