import { z } from "zod";
import { RiskLevelSchema } from "./state.js";

export const ElementLocatorSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  testId: z.string().optional(),
  point: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
});
export type ElementLocator = z.infer<typeof ElementLocatorSchema>;

export const BrowserActionTypeSchema = z.enum([
  "browser_list_tabs",
  "browser_attach",
  "browser_snapshot",
  "browser_screenshot",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_keypress",
  "browser_scroll",
  "browser_select",
  "browser_wait",
  "browser_extract",
  "browser_download",
  "browser_verify",
  "browser_detach",
  "browser_status",
]);
export type BrowserActionType = z.infer<typeof BrowserActionTypeSchema>;

export const ActionPayloadSchema = z.object({
  type: BrowserActionTypeSchema,
  locator: ElementLocatorSchema.optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  url: z.string().url().optional(),
  expected_origin: z.string().optional(),
  predicate: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
  scroll_amount: z.number().optional(),
  risk: RiskLevelSchema.default("read_only"),
  is_irreversible: z.boolean().default(false),
});
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;
