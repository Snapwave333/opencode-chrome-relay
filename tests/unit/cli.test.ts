import { describe, it, expect } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import {
  parseCliArgs,
  buildLocatorFromArg,
  executeRelayAction,
  splitCommandLine,
  runCli,
} from "../../packages/opencode-plugin/src/cli.js";

describe("Universal Browser Relay CLI (browser-relay / oc-relay)", () => {
  it("splits command lines preserving quoted substrings", () => {
    expect(splitCommandLine('click "Sign In to Google" --tab 4')).toEqual([
      "click",
      "Sign In to Google",
      "--tab",
      "4",
    ]);
    expect(splitCommandLine("type [3] 'Hello world!' -v")).toEqual([
      "type",
      "[3]",
      "Hello world!",
      "-v",
    ]);
    expect(splitCommandLine("")).toEqual([]);
  });

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
      "-v",
      "-T",
      "7500",
    ]);
    expect(parsed.command).toBe("nav");
    expect(parsed.positionals).toEqual(["https://console.cloud.google.com/apis/credentials"]);
    expect(parsed.options.tabId).toBe(42);
    expect(parsed.options.runId).toBe("agent_run_9");
    expect(parsed.options.json).toBe(true);
    expect(parsed.options.newTab).toBe(true);
    expect(parsed.options.verbose).toBe(true);
    expect(parsed.options.timeoutMs).toBe(7500);

    const parsedEquals = parseCliArgs([
      "click",
      "3",
      "--tab=99",
      "--run=agent_fast",
      "--timeout=5000",
      "--broker=ws://127.0.0.1:4098",
    ]);
    expect(parsedEquals.command).toBe("click");
    expect(parsedEquals.positionals).toEqual(["3"]);
    expect(parsedEquals.options.tabId).toBe(99);
    expect(parsedEquals.options.runId).toBe("agent_fast");
    expect(parsedEquals.options.timeoutMs).toBe(5000);
    expect(parsedEquals.options.brokerUrl).toBe("ws://127.0.0.1:4098");
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
    expect(buildLocatorFromArg("3")).toEqual({
      selector: '[data-relay-index="3"]',
      name: "3",
    });
    expect(buildLocatorFromArg("[14]")).toEqual({
      selector: '[data-relay-index="14"]',
      name: "[14]",
    });
    expect(buildLocatorFromArg("@5")).toEqual({
      selector: '[data-relay-index="5"]',
      name: "@5",
    });
    expect(buildLocatorFromArg("text=Save")).toEqual({
      text: "Save",
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
          verbose: false,
        }
      );

      expect(outcome.success).toBe(true);
      expect(outcome.eval_result).toEqual({ title: "Google Cloud Console", ready: true });
    } finally {
      await new Promise<void>((r) => wss.close(() => r()));
    }
  });

  it("reuses a persistent WebSocket connection across multiple sequential actions without reconnecting", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const address = wss.address();
    const port = typeof address === "object" && address ? address.port : 14099;
    const brokerUrl = `ws://127.0.0.1:${port}`;
    let connectionsCount = 0;

    wss.on("connection", (ws) => {
      connectionsCount++;
      ws.on("message", (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.event === "browser.action.request") {
          ws.send(
            JSON.stringify({
              v: 1,
              event: "action.finished",
              event_id: `evt_${env.idempotency_key}`,
              timestamp: new Date().toISOString(),
              run_id: env.run_id,
              idempotency_key: env.idempotency_key,
              payload: {
                success: true,
                action_type: env.action.type,
              },
            })
          );
        }
      });
    });

    try {
      const sharedWs = new WebSocket(brokerUrl);
      await new Promise<void>((res) => sharedWs.on("open", () => res()));

      const opt = {
        brokerUrl,
        runId: "run_persistent",
        timeoutMs: 2000,
        json: true,
        newTab: false,
        follow: false,
        verbose: false,
      };

      const res1 = await executeRelayAction(
        { type: "browser_dblclick", locator: { name: "Folder item" }, risk: "non_sensitive_mutation", is_irreversible: false },
        opt,
        sharedWs
      );
      expect(res1.success).toBe(true);
      expect(res1.action_type).toBe("browser_dblclick");

      const res2 = await executeRelayAction(
        { type: "browser_rightclick", locator: { name: "File row" }, risk: "non_sensitive_mutation", is_irreversible: false },
        opt,
        sharedWs
      );
      expect(res2.success).toBe(true);
      expect(res2.action_type).toBe("browser_rightclick");

      const res3 = await executeRelayAction(
        { type: "browser_switch_tab", value: "42", risk: "non_sensitive_mutation", is_irreversible: false },
        opt,
        sharedWs
      );
      expect(res3.success).toBe(true);
      expect(res3.action_type).toBe("browser_switch_tab");

      // Verify that only a single persistent connection was opened
      expect(connectionsCount).toBe(1);
      sharedWs.close();
    } finally {
      await new Promise<void>((r) => wss.close(() => r()));
    }
  });
});

