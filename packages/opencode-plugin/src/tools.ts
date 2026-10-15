import { RelayBrokerClient } from "./client.js";
import { ElementLocator, RiskLevel } from "@opencode/chrome-relay-protocol";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: any, client: RelayBrokerClient) => Promise<any>;
}

export const browserTools: Record<string, ToolDefinition> = {
  browser_list_tabs: {
    name: "browser_list_tabs",
    description: "List currently open and authorized browser tabs in user's Chrome.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, client) => {
      return client.sendAction({
        type: "browser_list_tabs",
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_attach: {
    name: "browser_attach",
    description: "Attach agent to a specific Chrome tab by ID.",
    parameters: {
      type: "object",
      required: ["tab_id"],
      properties: {
        tab_id: { type: "number", description: "Tab ID to attach to" },
      },
    },
    execute: async (args, client) => {
      const res = await client.sendAction(
        {
          type: "browser_attach",
          risk: "read_only",
          is_irreversible: false,
        },
        args.tab_id
      );
      client.setTabBinding(args.tab_id, `lease_${args.tab_id}`);
      return res;
    },
  },

  browser_snapshot: {
    name: "browser_snapshot",
    description: "Get semantic DOM accessibility tree and interactive elements snapshot of the attached tab.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, client) => {
      return client.sendAction({
        type: "browser_snapshot",
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_screenshot: {
    name: "browser_screenshot",
    description: "Capture visible viewport screenshot for visual grounding (opt-in).",
    parameters: { type: "object", properties: {} },
    execute: async (_args, client) => {
      return client.sendAction({
        type: "browser_screenshot",
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_navigate: {
    name: "browser_navigate",
    description: "Navigate the attached browser tab to a specified URL.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Target URL to navigate to" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_navigate",
        url: args.url,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      });
    },
  },

  browser_click: {
    name: "browser_click",
    description: "Click an interactive element located by semantic role, accessible name, or selector.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string" },
        name: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        point: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_click",
        locator: args as ElementLocator,
        risk: "external_effect",
        is_irreversible: false,
      });
    },
  },

  browser_type: {
    name: "browser_type",
    description: "Type text into an input field located by semantic locator.",
    parameters: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Text to type" },
        role: { type: "string" },
        name: { type: "string" },
        selector: { type: "string" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_type",
        text: args.text,
        locator: { role: args.role, name: args.name, selector: args.selector },
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      });
    },
  },

  browser_keypress: {
    name: "browser_keypress",
    description: "Send keyboard keypress (e.g. Enter, Tab, Escape, ArrowDown).",
    parameters: {
      type: "object",
      required: ["key"],
      properties: {
        key: { type: "string", description: "Key name" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_keypress",
        key: args.key,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      });
    },
  },

  browser_scroll: {
    name: "browser_scroll",
    description: "Scroll the page viewport or element in a specified direction.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"], default: "down" },
        amount: { type: "number", default: 400 },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_scroll",
        scroll_direction: args.direction || "down",
        scroll_amount: args.amount || 400,
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_select: {
    name: "browser_select",
    description: "Select an option in a dropdown <select> element.",
    parameters: {
      type: "object",
      required: ["value"],
      properties: {
        value: { type: "string", description: "Option value to select" },
        selector: { type: "string" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_select",
        value: args.value,
        locator: { selector: args.selector },
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      });
    },
  },

  browser_wait: {
    name: "browser_wait",
    description: "Wait for a specific element or text predicate to appear.",
    parameters: {
      type: "object",
      properties: {
        predicate: { type: "string" },
        timeout_ms: { type: "number", default: 5000 },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_wait",
        predicate: args.predicate,
        timeout_ms: args.timeout_ms || 5000,
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_extract: {
    name: "browser_extract",
    description: "Extract text or structured data from specified elements.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_extract",
        locator: { selector: args.selector },
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_download: {
    name: "browser_download",
    description: "Download authorized file or resource from page.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_download",
        url: args.url,
        risk: "sensitive_action",
        is_irreversible: true,
      });
    },
  },

  browser_verify: {
    name: "browser_verify",
    description: "Verify that an expected DOM element or text state exists on the page.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_verify",
        text: args.text,
        locator: { selector: args.selector },
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_detach: {
    name: "browser_detach",
    description: "Detach from currently attached browser tab.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, client) => {
      return client.sendAction({
        type: "browser_detach",
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },

  browser_status: {
    name: "browser_status",
    description: "Check relay bridge status, current tab lease, and execution state.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, client) => {
      return client.sendAction({
        type: "browser_status",
        risk: "read_only",
        is_irreversible: false,
      });
    },
  },
};
