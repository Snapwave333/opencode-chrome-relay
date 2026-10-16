import { describe, it, expect } from "vitest";
import { WebSocketServer } from "ws";
import {
  parseCliArgs,
  buildLocatorFromArg,
  executeRelayAction,
} from "../../packages/opencode-plugin/src/cli.js";

describe("Universal Browser Relay CLI (browser-relay / oc-relay)", () => {
  it("parses CLI arguments and flags for AI agent commands", () => {
    const parsed = parseCliArgs([
      "nav",
      "https://console.cloud.google.com/apis/credentials",
      "--tab",
      "42",
      "--run",
      "agent_run_9",
      "--json",
      "--new-tab",
    ]);
    expect(parsed.command).toBe("nav");
    expect(parsed.positionals).toEqual(["https://console.cloud.google.com/apis/credentials"]);
    expect(parsed.options.tabId).toBe(42);
    expect(parsed.options.runId).toBe("agent_run_9");
    expect(parsed.options.json).toBe(true);
    expect(parsed.options.newTab).toBe(true);
  });

  it("builds locators from label text, CSS selectors, and x,y coordinates", () => {
    expect(buildLocatorFromArg("Create credentials")).toEqual({ name: "Create credentials" });
    expect(buildLocatorFromArg("#submit-btn")).toEqual({
      selector: "#submit-btn",
      name: "#submit-btn",
    });
    expect(buildLocatorFromArg("button[aria-label='Save']")).toEqual({
      selector: "button[aria-label='Save']",
      name: "button[aria-label='Save']",
    });
    expect(buildLocatorFromArg("320, 480")).toEqual({
      point: { x: 320, y: 480 },
    });
  });

  it("executes a browser action over WebSocket and resolves on action.finished", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const address = wss.address();
    const port = typeof address === "object" && address ? address.port : 14098;
    const brokerUrl = `ws://127.0.0.1:${port}`;

    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.event === "browser.action.request") {
          ws.send(
            JSON.stringify({
              v: 1,
              event: "action.finished",
              event_id: "evt_fin_test",
              timestamp: new Date().toISOString(),
              run_id: env.run_id,
              idempotency_key: env.idempotency_key,
              payload: {
                success: true,
                verified: true,
                eval_result: { title: "Google Cloud Console", ready: true },
                outcome_summary: "Evaluated JS expression",
              },
            })
          );
        }
      });
    });

    try {
      const outcome = await executeRelayAction(
        {
          type: "browser_eval",
          text: "({ title: document.title, ready: true })",
          risk: "read_only",
          is_irreversible: false,
        },
        {
          brokerUrl,
          runId: "run_cli_test",
          timeoutMs: 3000,
          json: true,
          newTab: false,
          follow: false,
        }
      );

      expect(outcome.success).toBe(true);
      expect(outcome.eval_result).toEqual({ title: "Google Cloud Console", ready: true });
    } finally {
      await new Promise<void>((r) => wss.close(() => r()));
    }
  });
});
