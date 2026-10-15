import { z } from "zod";

export const ControlTypeSchema = z.enum([
  "pause",
  "resume",
  "stop",
  "restart",
  "steer",
  "take_over",
  "return_control",
]);
export type ControlType = z.infer<typeof ControlTypeSchema>;

export const RestartOptionsSchema = z.object({
  from_current_page: z.boolean().default(true),
  retry_safe_step: z.boolean().default(false),
});
export type RestartOptions = z.infer<typeof RestartOptionsSchema>;

export const ControlCommandSchema = z.object({
  command: ControlTypeSchema,
  run_id: z.string(),
  epoch: z.number().int().nonnegative(),
  instruction: z.string().optional(), // For steer
  restart_options: RestartOptionsSchema.optional(), // For restart
  reason: z.string().optional(),
});
export type ControlCommand = z.infer<typeof ControlCommandSchema>;
