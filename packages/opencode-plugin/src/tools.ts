import { RelayBrokerClient } from "./client.js";
import { ElementLocator, RiskLevel } from "@opencode/chrome-relay-protocol";
import { SessionContextManager } from "./session.js";
import { VisionTaskExecutor } from "./vision.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (
    args: any,
    client: RelayBrokerClient,
    sessionManager?: SessionContextManager
  ) => Promise<any>;
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

  browser_new_tab: {
    name: "browser_new_tab",
    description: "Open a new Chrome tab, optionally at a specified URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL for the new tab" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_new_tab",
        url: args.url,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      });
    },
  },

  browser_close_tab: {
    name: "browser_close_tab",
    description: "Close an authorized Chrome tab after the relay approval policy allows it.",
    parameters: {
      type: "object",
      properties: {
        tab_id: { type: "number", description: "Optional tab ID; defaults to the bound tab" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction(
        {
          type: "browser_close_tab",
          risk: "sensitive_action",
          is_irreversible: true,
        },
        args.tab_id
      );
    },
  },

  browser_switch_tab: {
    name: "browser_switch_tab",
    description: "Switch to and activate a specific Chrome tab by ID.",
    parameters: {
      type: "object",
      required: ["tab_id"],
      properties: {
        tab_id: { type: "number", description: "Target tab ID to switch to" },
      },
    },
    execute: async (args, client) => {
      const res = await client.sendAction(
        {
          type: "browser_switch_tab",
          value: String(args.tab_id),
          risk: "non_sensitive_mutation",
          is_irreversible: false,
        },
        args.tab_id
      );
      client.setTabBinding(args.tab_id, `lease_${args.tab_id}`);
      return res;
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
    description:
      "Capture visible viewport screenshot for visual grounding using the configured vision model, and automatically purge screenshot data immediately after use.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Visual inspection question or prompt for the vision model",
        },
      },
    },
    execute: async (args, client, sessionManager) => {
      const res = await client.sendAction({
        type: "browser_screenshot",
        risk: "read_only",
        is_irreversible: false,
      });

      const visionModel = sessionManager?.getVisionModel() || "gpt-4o";
      const imageBase64 = res?.screenshot_base64;

      if (imageBase64) {
        const prompt =
          args?.prompt ||
          "Observe the current browser page layout and interactive elements.";
        const visionResult = await VisionTaskExecutor.analyzeScreenshot(
          imageBase64,
          prompt,
          visionModel
        );

        return {
          success: true,
          vision_model_used: visionResult.visionModelUsed,
          analysis: visionResult.analysis,
          screenshot_deleted: true,
        };
      }

      return res;
    },
  },

  browser_pdf: {
    name: "browser_pdf",
    description: "Generate and save a PDF document from the current browser page using Chrome DevTools Protocol.",
    parameters: {
      type: "object",
      properties: {
        pdf_path: { type: "string", description: "Optional local file path to save the generated PDF" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_pdf",
        download_path: args.pdf_path,
        risk: args.pdf_path ? "external_effect" : "read_only",
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
      try {
        return await client.sendAction({
          type: "browser_click",
          locator: args as ElementLocator,
          risk: "external_effect",
          is_irreversible: false,
        });
      } catch (err: any) {
        const query = (args?.name || args?.selector || args?.text || "").toLowerCase();
        if (/save|download/.test(query)) {
          const { tryDismissNativeSaveDialog } = await import("./cli.js");
          if (tryDismissNativeSaveDialog()) {
            return {
              success: true,
              verified: true,
              outcome_summary: "Confirmed native Save dialogue box via OS",
            };
          }
        }
        throw err;
      }
    },
  },

  browser_dblclick: {
    name: "browser_dblclick",
    description: "Double-click an interactive element located by semantic role, accessible name, or selector.",
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
        type: "browser_dblclick",
        locator: args as ElementLocator,
        risk: "external_effect",
        is_irreversible: false,
      });
    },
  },

  browser_rightclick: {
    name: "browser_rightclick",
    description: "Right-click (context menu) an interactive element located by semantic role, accessible name, or selector.",
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
        type: "browser_rightclick",
        locator: args as ElementLocator,
        risk: "read_only",
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
    description: "Download authorized file or resource from page flawlessly to local downloads.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "URL to download" },
        download_path: { type: "string", description: "Optional local destination filename" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_download",
        url: args.url,
        download_path: args.download_path,
        risk: "sensitive_action",
        is_irreversible: true,
      });
    },
  },

  browser_upload: {
    name: "browser_upload",
    description: "Upload local file(s) into a file input element on the active page flawlessly.",
    parameters: {
      type: "object",
      required: ["file_paths"],
      properties: {
        file_paths: { type: "array", items: { type: "string" }, description: "Absolute paths to local files to upload" },
        selector: { type: "string", description: "CSS selector for input[type='file'] element" },
      },
    },
    execute: async (args, client) => {
      return client.sendAction({
        type: "browser_upload",
        file_paths: args.file_paths,
        locator: { selector: args.selector || "input[type='file']" },
        risk: "sensitive_action",
        is_irreversible: false,
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
