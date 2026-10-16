#!/usr/bin/env node
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ActionPayload, BrowserActionType } from "@opencode/chrome-relay-protocol";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_BROKER_URL = process.env.RELAY_BROKER_URL || "ws://127.0.0.1:4098";
const SQLITE_PATH = path.resolve(REPO_ROOT, "opencode_relay.sqlite");
const BROKER_EXE_DEBUG = path.resolve(REPO_ROOT, "target/debug/relay-broker.exe");
const BROKER_EXE_RELEASE = path.resolve(REPO_ROOT, "target/release/relay-broker.exe");

export interface CliOptions {
  brokerUrl: string;
  tabId?: number;
  runId: string;
  timeoutMs: number;
  json: boolean;
  newTab: boolean;
  follow: boolean;
}

export function parseCliArgs(argv: string[]): {
  command: string;
  positionals: string[];
  options: CliOptions;
} {
  const options: CliOptions = {
    brokerUrl: DEFAULT_BROKER_URL,
    runId: "run_1",
    timeoutMs: 18000,
    json: false,
    newTab: false,
    follow: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json" || arg === "-j") {
      options.json = true;
    } else if (arg === "--new-tab" || arg === "-n") {
      options.newTab = true;
    } else if (arg === "--follow" || arg === "-f") {
      options.follow = true;
    } else if ((arg === "--tab" || arg === "-t") && argv[i + 1]) {
      options.tabId = parseInt(argv[++i], 10);
    } else if ((arg === "--run" || arg === "-r") && argv[i + 1]) {
      options.runId = argv[++i];
    } else if (arg === "--timeout" && argv[i + 1]) {
      options.timeoutMs = parseInt(argv[++i], 10);
    } else if (arg === "--broker" && argv[i + 1]) {
      options.brokerUrl = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      positionals.unshift("help");
    } else {
      positionals.push(arg);
    }
  }

  const command = (positionals.shift() || "help").toLowerCase();
  return { command, positionals, options };
}

export function buildLocatorFromArg(target: string): {
  selector?: string;
  name?: string;
  point?: { x: number; y: number };
} {
  const trimmed = target.trim();
  const coordMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    return {
      point: {
        x: parseFloat(coordMatch[1]),
        y: parseFloat(coordMatch[2]),
      },
    };
  }
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith(".") ||
    trimmed.startsWith("[") ||
    trimmed.includes(" > ") ||
    /^[a-z]+\[/.test(trimmed)
  ) {
    return { selector: trimmed, name: trimmed };
  }
  return { name: trimmed };
}

async function tryConnectBroker(url: string, timeoutMs = 1500): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.terminate();
        } catch {}
        resolve(null);
      }
    }, timeoutMs);

    ws.on("open", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(ws);
      }
    });

    ws.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    });
  });
}

export async function ensureBrokerConnected(url = DEFAULT_BROKER_URL): Promise<WebSocket> {
  let ws = await tryConnectBroker(url, 1200);
  if (ws) return ws;

  // Auto-start relay-broker.exe if present on disk
  const exePath = fs.existsSync(BROKER_EXE_DEBUG)
    ? BROKER_EXE_DEBUG
    : fs.existsSync(BROKER_EXE_RELEASE)
      ? BROKER_EXE_RELEASE
      : null;

  if (exePath) {
    try {
      const child = spawn(exePath, [], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    } catch {
      // Ignore spawn error
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 350));
      ws = await tryConnectBroker(url, 1000);
      if (ws) return ws;
    }
  }

  throw new Error(`Could not connect to OpenCode Relay Broker at ${url}`);
}

export async function executeRelayAction(
  action: ActionPayload,
  options: CliOptions
): Promise<any> {
  const ws = await ensureBrokerConnected(options.brokerUrl);
  const idempotencyKey = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const envelope = {
    v: 1,
    event: "browser.action.request",
    event_id: `evt_${idempotencyKey}`,
    timestamp: new Date().toISOString(),
    run_id: options.runId,
    epoch: 0,
    sequence: Date.now() % 1000000,
    tab_id: options.tabId,
    idempotency_key: idempotencyKey,
    action,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(
        new Error(
          `Timed out waiting (${options.timeoutMs}ms) for Chrome extension to execute ${action.type}. Ensure Chrome is open and the OpenCode Chrome Relay extension is loaded/reloaded.`
        )
      );
    }, options.timeoutMs);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.idempotency_key !== idempotencyKey) return;

        if (msg.event === "action.finished") {
          clearTimeout(timer);
          ws.close();
          resolve(msg.payload || { success: true });
        } else if (msg.event === "action.failed") {
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.payload?.error || `Action ${action.type} failed`));
        }
      } catch {
        // Ignore non-JSON frame
      }
    });

    ws.send(JSON.stringify(envelope));
  });
}

async function runAutonomousAgentFromCli(goal: string, options: CliOptions): Promise<void> {
  const ws = await ensureBrokerConnected(options.brokerUrl);
  const cmd = {
    command: "steer",
    run_id: options.runId,
    epoch: 0,
    instruction: goal,
  };

  if (!options.json) {
    console.log(`🚀 Dispatched autonomous goal to Chrome Relay (${options.runId}): "${goal}"`);
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (!options.json) {
        console.log("⏱️ Agent stream window elapsed.");
      }
      ws.close();
      resolve();
    }, Math.max(options.timeoutMs, 90000));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.run_id && msg.run_id !== options.runId) return;

        if (options.json) {
          console.log(JSON.stringify(msg));
        } else if (msg.event === "chat.response") {
          console.log(`🤖 [${msg.payload?.model || "Agent"}]: ${msg.payload?.text || ""}`);
        } else if (msg.event === "action.started" && msg.action) {
          const target =
            msg.action.url ||
            msg.action.locator?.name ||
            msg.action.locator?.selector ||
            msg.action.text ||
            "";
          console.log(`⚡ [Action Started] ${msg.action.type} ${target}`);
        } else if (msg.event === "action.finished") {
          console.log(`✅ [Action Verified] ${msg.payload?.outcome_summary || "Done"}`);
        } else if (msg.event === "action.failed") {
          console.error(`❌ [Action Failed] ${msg.payload?.error || "Error"}`);
        }

        if (msg.event === "run.completed") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch {
        // Ignore malformed
      }
    });

    ws.send(JSON.stringify(cmd));
  });
}

async function printStatusAndJournal(options: CliOptions): Promise<void> {
  const ws = await ensureBrokerConnected(options.brokerUrl);
  const sessionsPromise = new Promise<any[]>((resolve) => {
    const t = setTimeout(() => resolve([]), 1500);
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.event === "session.list") {
          clearTimeout(t);
          resolve(msg.payload?.sessions || []);
        }
      } catch {}
    });
    ws.send(
      JSON.stringify({
        v: 1,
        event: "session.list",
        event_id: `evt_list_${Date.now()}`,
        timestamp: new Date().toISOString(),
      })
    );
  });

  const sessions = await sessionsPromise;
  ws.close();

  let dbRuns: any[] = [];
  let dbActions: any[] = [];
  if (fs.existsSync(SQLITE_PATH)) {
    try {
      const sqliteMod: any = await import("node:sqlite");
      const db = new sqliteMod.DatabaseSync(SQLITE_PATH, { open: true });
      dbRuns = db.prepare("SELECT * FROM runs ORDER BY updated_at DESC LIMIT 10").all();
      dbActions = db.prepare("SELECT * FROM action_journal ORDER BY created_at DESC LIMIT 15").all();
      db.close();
    } catch {
      // node:sqlite optional
    }
  }

  const statusReport = {
    broker_url: options.brokerUrl,
    broker_online: true,
    sqlite_path: SQLITE_PATH,
    active_sessions: sessions,
    recent_runs: dbRuns,
    recent_actions: dbActions,
  };

  if (options.json) {
    console.log(JSON.stringify(statusReport, null, 2));
    return;
  }

  console.log(`🟢 OpenCode Chrome Relay Broker: ONLINE (${options.brokerUrl})`);
  console.log(`📂 SQLite Journal: ${SQLITE_PATH}`);
  console.log(`🗂️ Active Broker Sessions (${sessions.length}):`);
  for (const s of sessions) {
    console.log(`   - ${s.run_id} "${s.name}" [${s.state}] pinned=${s.is_pinned} tab=${s.tab_id ?? "auto"}`);
  }
  console.log(`📜 Recent Journaled Actions (${dbActions.length}):`);
  for (const a of dbActions) {
    console.log(
      `   - [${a.created_at}] (${a.run_id}) ${a.action_type} -> ${a.status} (key=${a.idempotency_key})`
    );
  }
}

function printHelp(): void {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║               OpenCode Chrome Relay CLI (browser-relay / oc-relay)         ║
║         Universal Browser Control CLI for AI Agents on Your Laptop         ║
╚════════════════════════════════════════════════════════════════════════════╝

USAGE:
  browser-relay <command> [args...] [options]
  oc-relay <command> [args...] [options]

CORE COMMANDS (Deterministic Direct Execution):
  status                         Check broker health, active sessions & SQLite journal
  tabs                           List all open Chrome tabs across all windows
  new-tab [url]                  Open a new Chrome tab (default: https://www.google.com)
  close-tab [--tab <id>]         Close the specified or active Chrome tab
  nav <url-or-site>              Navigate tab to URL, domain, or site name ("google cloud credentials", "youtube studio")
  snapshot                       Observe live DOM: URL, title, headings & interactive elements with selectors
  extract [selector]             Extract visible page text and links (or from a specific CSS selector)
  eval <js-expression>           Execute arbitrary JavaScript in the live tab and return the result
  click <name|selector|x,y>      Click any button, link, menu item, CSS selector, or x,y coordinate
  type [target] <text>           Type text into a matching input/textarea (or focused input)
  press <key>                    Press a keyboard key via CDP (Enter, Tab, Escape, ArrowDown, etc.)
  select <selector> <value>      Select an option in a <select> dropdown
  scroll <down|up|left|right> [px] Scroll the active tab viewport (default: 450px)
  wait <selector|text|ms>        Wait for a selector/text to appear or sleep N milliseconds
  verify <selector|text>         Check if a selector or text exists on the current page
  screenshot [output.png]        Capture a PNG screenshot via CDP and save to disk
  download <url> [filename]      Download a URL using your logged-in Chrome cookies

AUTONOMOUS MULTI-STEP AGENT & TELEMETRY COMMANDS:
  agent "<goal>"                 Run the autonomous multi-step NVIDIA NIM browser agent and stream progress
  control <pause|stop|restart>   Control an active autonomous run
  monitor [--follow]             Inspect SQLite action journal and optionally stream live WebSocket events
  reload-ext                     Remotely hot-reload the Chrome extension service worker

GLOBAL OPTIONS:
  --tab, -t <tabId>              Target a specific Chrome tab ID (default: active tab)
  --new-tab, -n                  Open navigation target in a new Chrome tab
  --run, -r <runId>              Session run ID (default: run_1)
  --timeout <ms>                 Action timeout in milliseconds (default: 18000)
  --json, -j                     Output structured JSON for programmatic AI agent consumption
`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const { command, positionals, options } = parseCliArgs(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "status") {
    await printStatusAndJournal(options);
    return;
  }

  if (command === "monitor") {
    await printStatusAndJournal(options);
    if (options.follow) {
      const ws = await ensureBrokerConnected(options.brokerUrl);
      console.log("📡 Streaming live events from ws://127.0.0.1:4098 (Ctrl+C to stop)...");
      ws.on("message", (data) => {
        console.log(`[${new Date().toISOString()}] ${data.toString()}`);
      });
    }
    return;
  }

  if (command === "reload-ext") {
    const ws = await ensureBrokerConnected(options.brokerUrl);
    ws.send(
      JSON.stringify({
        v: 1,
        event: "extension.reload",
        event_id: `evt_reload_${Date.now()}`,
        timestamp: new Date().toISOString(),
      })
    );
    await new Promise((r) => setTimeout(r, 250));
    ws.close();
    console.log("🔄 Sent extension.reload signal to Chrome Relay extension.");
    return;
  }

  if (command === "agent" || command === "ask" || command === "run") {
    const goal = positionals.join(" ").trim();
    if (!goal) {
      throw new Error('Usage: browser-relay agent "<goal>"');
    }
    await runAutonomousAgentFromCli(goal, options);
    return;
  }

  if (command === "control") {
    const sub = (positionals[0] || "stop").toLowerCase();
    const ws = await ensureBrokerConnected(options.brokerUrl);
    ws.send(
      JSON.stringify({
        command: sub,
        run_id: options.runId,
        epoch: 0,
        instruction: positionals.slice(1).join(" ") || undefined,
      })
    );
    await new Promise((r) => setTimeout(r, 250));
    ws.close();
    console.log(`🎛️ Sent control command "${sub}" for ${options.runId}`);
    return;
  }

  let action: ActionPayload;

  switch (command) {
    case "tabs":
    case "list-tabs":
      action = { type: "browser_list_tabs" as BrowserActionType, risk: "read_only", is_irreversible: false };
      break;

    case "new-tab":
      action = {
        type: "browser_new_tab" as BrowserActionType,
        url: positionals.join(" ").trim() || "https://www.google.com",
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;

    case "close-tab":
      if (positionals[0] && /^\d+$/.test(positionals[0])) {
        options.tabId = parseInt(positionals[0], 10);
      }
      action = {
        type: "browser_close_tab" as BrowserActionType,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;

    case "nav":
    case "navigate":
    case "open":
    case "goto": {
      const targetUrl = positionals.join(" ").trim();
      if (!targetUrl) throw new Error("Usage: browser-relay nav <url-or-destination>");
      action = {
        type: (options.newTab ? "browser_new_tab" : "browser_navigate") as BrowserActionType,
        url: targetUrl,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "snapshot":
    case "observe":
    case "dom":
      action = { type: "browser_snapshot", risk: "read_only", is_irreversible: false };
      break;

    case "extract":
    case "text":
    case "read":
      action = {
        type: "browser_extract",
        locator: positionals[0] ? { selector: positionals.join(" ").trim() } : undefined,
        risk: "read_only",
        is_irreversible: false,
      };
      break;

    case "eval":
    case "js":
    case "exec": {
      const expr = positionals.join(" ").trim();
      if (!expr) throw new Error('Usage: browser-relay eval "<javascript-expression>"');
      action = {
        type: "browser_eval" as BrowserActionType,
        text: expr,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "click": {
      const target = positionals.join(" ").trim();
      if (!target) throw new Error("Usage: browser-relay click <label|selector|x,y>");
      action = {
        type: "browser_click",
        locator: buildLocatorFromArg(target),
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "type":
    case "fill": {
      if (positionals.length === 0) {
        throw new Error("Usage: browser-relay type [target] <text>");
      }
      const hasTarget = positionals.length >= 2;
      const locator = hasTarget ? buildLocatorFromArg(positionals[0]) : {};
      const text = hasTarget ? positionals.slice(1).join(" ") : positionals[0];
      action = {
        type: "browser_type",
        locator,
        text,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "press":
    case "key":
    case "keypress": {
      const key = positionals[0] || "Enter";
      action = {
        type: "browser_keypress",
        key,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "select": {
      if (positionals.length < 2) {
        throw new Error("Usage: browser-relay select <selector> <value>");
      }
      action = {
        type: "browser_select",
        locator: { selector: positionals[0] },
        value: positionals.slice(1).join(" "),
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "scroll": {
      const dir = (positionals[0]?.toLowerCase() || "down") as "down" | "up" | "left" | "right";
      const amt = positionals[1] ? parseInt(positionals[1], 10) : 450;
      action = {
        type: "browser_scroll",
        scroll_direction: ["down", "up", "left", "right"].includes(dir) ? dir : "down",
        scroll_amount: amt,
        risk: "read_only",
        is_irreversible: false,
      };
      break;
    }

    case "wait": {
      const arg = positionals.join(" ").trim();
      if (/^\d+$/.test(arg)) {
        action = {
          type: "browser_wait",
          timeout_ms: parseInt(arg, 10),
          risk: "read_only",
          is_irreversible: false,
        };
      } else {
        const isSel = arg.startsWith("#") || arg.startsWith(".") || arg.startsWith("[");
        action = {
          type: "browser_wait",
          locator: isSel ? { selector: arg } : undefined,
          text: !isSel ? arg : undefined,
          timeout_ms: options.timeoutMs,
          risk: "read_only",
          is_irreversible: false,
        };
      }
      break;
    }

    case "verify": {
      const arg = positionals.join(" ").trim();
      const isSel = arg.startsWith("#") || arg.startsWith(".") || arg.startsWith("[");
      action = {
        type: "browser_verify",
        locator: isSel ? { selector: arg } : undefined,
        text: !isSel ? arg : undefined,
        risk: "read_only",
        is_irreversible: false,
      };
      break;
    }

    case "screenshot": {
      action = {
        type: "browser_screenshot",
        risk: "read_only",
        is_irreversible: false,
      };
      const res = await executeRelayAction(action, options);
      const outPath = path.resolve(process.cwd(), positionals[0] || "screenshot.png");
      if (res?.screenshot_base64) {
        fs.writeFileSync(outPath, Buffer.from(res.screenshot_base64, "base64"));
      }
      if (options.json) {
        console.log(JSON.stringify({ success: true, file: outPath, bytes: res?.screenshot_base64?.length || 0 }));
      } else {
        console.log(`📸 Screenshot saved to ${outPath}`);
      }
      return;
    }

    case "download": {
      const url = positionals[0];
      if (!url) throw new Error("Usage: browser-relay download <url> [filename]");
      action = {
        type: "browser_download",
        url,
        download_path: positionals[1],
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "upload": {
      if (positionals.length < 2) {
        throw new Error("Usage: browser-relay upload <selector> <file1> [file2...]");
      }
      action = {
        type: "browser_upload",
        locator: { selector: positionals[0] },
        file_paths: positionals.slice(1).map((p) => path.resolve(process.cwd(), p)),
        risk: "external_effect",
        is_irreversible: false,
      };
      break;
    }

    default:
      throw new Error(`Unknown command "${command}". Run "browser-relay help" for usage.`);
  }

  const outcome = await executeRelayAction(action, options);

  if (options.json) {
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  if (action.type === ("browser_list_tabs" as any) && Array.isArray(outcome?.tabs)) {
    console.log(`🗂️ Open Chrome Tabs (${outcome.tabs.length}):`);
    for (const t of outcome.tabs) {
      console.log(`  [${t.id}] ${t.active ? "★ ACTIVE" : "        "} | ${t.title || "(Untitled)"} -> ${t.url}`);
    }
  } else if (action.type === "browser_snapshot" && outcome?.snapshot) {
    const snap = outcome.snapshot;
    console.log(`🌐 URL:   ${snap.url}`);
    console.log(`📄 Title: ${snap.title}`);
    if (snap.headings?.length) {
      console.log(`📑 Headings: ${snap.headings.join(" | ")}`);
    }
    console.log(`🔘 Interactive Elements (${snap.elements?.length || 0}):`);
    for (const el of snap.elements || []) {
      console.log(
        `  [${el.index}] <${el.tag}> "${el.label}"${el.selector ? ` selector='${el.selector}'` : ""}${
          el.href ? ` href='${el.href}'` : ""
        }`
      );
    }
  } else if (action.type === "browser_extract" && outcome?.extracted) {
    const ext = outcome.extracted;
    console.log(`🌐 ${ext.title} (${ext.url})\n`);
    console.log(ext.text);
    if (ext.links?.length) {
      console.log(`\n🔗 Links (${Math.min(ext.links.length, 25)} of ${ext.links.length}):`);
      for (const l of ext.links.slice(0, 25)) {
        console.log(`  - ${l.text || "(link)"}: ${l.href}`);
      }
    }
  } else if (action.type === ("browser_eval" as any)) {
    console.log(
      typeof outcome?.eval_result === "object"
        ? JSON.stringify(outcome.eval_result, null, 2)
        : String(outcome?.eval_result)
    );
  } else {
    console.log(`✅ ${outcome?.outcome_summary || JSON.stringify(outcome)}`);
  }
}

// Run when invoked directly as a CLI binary
const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(__filename) ||
    process.argv[1].endsWith("browser-relay") ||
    process.argv[1].endsWith("oc-relay") ||
    process.argv[1].endsWith("cli.js"));

if (isMain) {
  runCli().catch((err) => {
    console.error(`❌ ${err.message || err}`);
    process.exit(1);
  });
}
