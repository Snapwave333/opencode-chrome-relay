#!/usr/bin/env node
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ActionPayload, BrowserActionType } from "@opencode/chrome-relay-protocol";
import {
  dismissNativeSaveDialog,
  isNativeDialogActive,
  NativeDialogResult,
} from "./native_dialog.js";
import os from "node:os";
import { helpManifest, renderCommandHelp, renderOverview, resolveCommand, unknownCommandMessage } from "./cli_help.js";
import {
  brokerBinaryCandidates,
  renderDoctorReport,
  runDoctor,
  type DoctorDeps,
  type JournalStats,
} from "./doctor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_BROKER_URL = process.env.RELAY_BROKER_URL || "ws://127.0.0.1:4098";
const SQLITE_PATH = process.env.RELAY_DB_PATH
  ? path.resolve(process.env.RELAY_DB_PATH)
  : path.resolve(REPO_ROOT, "opencode_relay.sqlite");

export const CLI_VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface CliOptions {
  brokerUrl: string;
  tabId?: number;
  runId: string;
  timeoutMs: number;
  json: boolean;
  newTab: boolean;
  background: boolean;
  follow: boolean;
  fix: boolean;
  cancel: boolean;
  verbose: boolean;
}

function parseEnvTabId(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function applyBackgroundPreference(action: ActionPayload, options: Pick<CliOptions, "background">): ActionPayload {
  if (!options.background) return action;
  if (action.type !== "browser_navigate" && action.type !== "browser_new_tab") return action;
  return { ...action, background: action.background ?? true };
}

export function parseCliArgs(argv: string[]): {
  command: string;
  positionals: string[];
  options: CliOptions;
} {
  const options: CliOptions = {
    brokerUrl: DEFAULT_BROKER_URL,
    runId: process.env.RELAY_RUN_ID || "run_1",
    tabId: parseEnvTabId(process.env.RELAY_TAB_ID),
    timeoutMs: 18000,
    json: false,
    newTab: false,
    background: /^(1|true|yes|on)$/i.test(process.env.RELAY_BACKGROUND || ""),
    follow: false,
    fix: false,
    cancel: false,
    verbose: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json" || arg === "-j") {
      options.json = true;
    } else if (arg === "--new-tab" || arg === "-n") {
      options.newTab = true;
    } else if (arg === "--background" || arg === "-b") {
      options.background = true;
    } else if (arg === "--follow" || arg === "-f") {
      options.follow = true;
    } else if (arg === "--fix") {
      options.fix = true;
    } else if (arg === "--cancel" || arg === "-c") {
      options.cancel = true;
    } else if (arg === "--version" || arg === "-V") {
      positionals.unshift("version");
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg.startsWith("--tab=") || arg.startsWith("-t=")) {
      options.tabId = parseInt(arg.split("=")[1], 10);
    } else if ((arg === "--tab" || arg === "-t") && argv[i + 1]) {
      options.tabId = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--run=") || arg.startsWith("-r=")) {
      options.runId = arg.split("=")[1];
    } else if ((arg === "--run" || arg === "-r") && argv[i + 1]) {
      options.runId = argv[++i];
    } else if (arg.startsWith("--timeout=") || arg.startsWith("-T=")) {
      options.timeoutMs = parseInt(arg.split("=")[1], 10);
    } else if ((arg === "--timeout" || arg === "-T") && argv[i + 1]) {
      options.timeoutMs = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--broker=")) {
      options.brokerUrl = arg.split("=")[1];
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
  text?: string;
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
  const indexMatch = trimmed.match(/^@?\[?(\d+)\]?$/);
  if (indexMatch && !trimmed.startsWith("#") && !trimmed.startsWith(".")) {
    return { selector: `[data-relay-index="${indexMatch[1]}"]`, name: trimmed };
  }
  if (trimmed.startsWith("text=")) {
    return { text: trimmed.slice(5).replace(/^['"]|['"]$/g, "") };
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

  const exePath = brokerBinaryCandidates(REPO_ROOT, process.platform).find((p) => fs.existsSync(p)) ?? null;

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
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 350));
      ws = await tryConnectBroker(url, 1000);
      if (ws) return ws;
    }
  }

  throw new Error(`Could not connect to OpenCode Relay Broker at ${url}`);
}

export function tryDismissNativeSaveDialog(filename?: string, action: "save" | "cancel" = "save"): boolean {
  const res = dismissNativeSaveDialog({ filename, action });
  return res.dismissed;
}

export async function executeRelayAction(
  action: ActionPayload,
  options: CliOptions,
  existingWs?: WebSocket
): Promise<any> {
  const ws = existingWs || (await ensureBrokerConnected(options.brokerUrl));
  const shouldClose = !existingWs;
  const idempotencyKey = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  action = applyBackgroundPreference(action, options);

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
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearInterval(retryInterval);
      clearTimeout(dialogCheckTimer);
      clearTimeout(timer);
      ws.off("message", onMessage);
      if (shouldClose) {
        try {
          ws.close();
        } catch {}
      }
    };

    const dialogCheckTimer = setTimeout(() => {
      if (settled) return;
      if (
        action.type === "browser_click" ||
        action.type === "browser_download" ||
        /save|download/i.test(action.locator?.name || action.locator?.selector || "")
      ) {
        tryDismissNativeSaveDialog();
      }
    }, 2000);

    const retryInterval = setInterval(() => {
      if (settled) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            ...envelope,
            event: "action.started",
            timestamp: new Date().toISOString(),
          })
        );
      }
    }, 1500);

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      const diagRes = dismissNativeSaveDialog({ action: "save" });
      if (diagRes.dismissed) {
        resolve({
          success: true,
          verified: true,
          ...diagRes,
          outcome_summary: `Confirmed native ${diagRes.windowTitle || "Save As"} dialogue box via OS automation`,
        });
        return;
      }
      reject(
        new Error(
          `Timed out waiting (${options.timeoutMs}ms) for Chrome extension to execute ${action.type}. Ensure Chrome is open and the OpenCode Chrome Relay extension is loaded/reloaded.`
        )
      );
    }, options.timeoutMs);

    const onMessage = (data: WebSocket.RawData) => {
      if (settled) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.idempotency_key !== idempotencyKey) return;

        if (msg.event === "action.finished") {
          cleanup();
          resolve(msg.payload || { success: true });
        } else if (msg.event === "action.failed") {
          cleanup();
          const errMsg = msg.payload?.error || `Action ${action.type} failed`;
          // If an action on Save/Download/Enter failed or element wasn't found in DOM, check for a native OS dialog
          if (
            (action.type === "browser_click" || action.type === "browser_keypress" || action.type === "browser_download") &&
            (/could not find clickable element|element not found/i.test(errMsg) ||
              /save|download|speichern|confirm|accept|ok/i.test(action.locator?.name || action.locator?.selector || action.key || ""))
          ) {
            const diagRes = dismissNativeSaveDialog({ action: "save" });
            if (diagRes.dismissed) {
              resolve({
                success: true,
                verified: true,
                ...diagRes,
                outcome_summary: `Confirmed native ${diagRes.windowTitle || "Save As"} dialogue box via OS automation`,
              });
              return;
            }
          }
          reject(new Error(errMsg));
        }
      } catch {
      }
    };

    ws.on("message", onMessage);
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
      const sqliteMod: any = await importSqliteQuietly();
      const db = new sqliteMod.DatabaseSync(SQLITE_PATH, { open: true });
      dbRuns = db.prepare("SELECT * FROM runs ORDER BY updated_at DESC LIMIT 10").all();
      dbActions = db.prepare("SELECT * FROM action_journal ORDER BY created_at DESC LIMIT 15").all();
      db.close();
    } catch {
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

export function renderHelp(positionals: string[], json: boolean): string {
  if (json) return JSON.stringify(helpManifest(CLI_VERSION), null, 2);
  const topic = positionals[0];
  if (!topic || topic === "help") return renderOverview(CLI_VERSION);
  const spec = resolveCommand(topic);
  if (!spec) throw new Error(unknownCommandMessage(topic));
  return renderCommandHelp(spec);
}

async function importSqliteQuietly(): Promise<any> {
  const originalEmit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
    return (originalEmit as any).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = originalEmit;
  }
}

async function readJournalStats(): Promise<JournalStats | null> {
  if (!fs.existsSync(SQLITE_PATH)) return null;
  const sqliteMod: any = await importSqliteQuietly();
  const db = new sqliteMod.DatabaseSync(SQLITE_PATH, { readOnly: true });
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const count = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);
    return {
      path: SQLITE_PATH,
      runs: count("SELECT COUNT(*) AS n FROM runs"),
      actions: count("SELECT COUNT(*) AS n FROM action_journal"),
      stale_pending: count("SELECT COUNT(*) AS n FROM action_journal WHERE status = 'pending' AND created_at < ?", cutoff),
    };
  } finally {
    db.close();
  }
}

export function defaultDoctorDeps(options: CliOptions): DoctorDeps {
  return {
    brokerUrl: options.brokerUrl,
    env: process.env,
    platform: process.platform,
    nodeVersion: process.version,
    repoRoot: REPO_ROOT,
    homeDir: os.homedir(),
    fileExists: (file) => fs.existsSync(file),
    connect: tryConnectBroker,
    startBroker: async () => {
      try {
        const ws = await ensureBrokerConnected(options.brokerUrl);
        ws.close();
        return true;
      } catch {
        return false;
      }
    },
    readJournal: readJournalStats,
    registryHasKey: (key) => {
      try {
        execSync(`reg query "${key}"`, { stdio: "ignore", windowsHide: true });
        return true;
      } catch (error: any) {
        return typeof error?.status === "number" ? false : null;
      }
    },
  };
}

export function splitCommandLine(cmdLine: string): string[] {
  const matches = cmdLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) return [];
  return matches.map((m) => {
    if ((m.startsWith('"') && m.endsWith('"')) || (m.startsWith("'") && m.endsWith("'"))) {
      return m.slice(1, -1);
    }
    return m;
  });
}

export async function runCli(argv = process.argv.slice(2), existingWs?: WebSocket): Promise<void> {
  const { command, positionals, options } = parseCliArgs(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(renderHelp(positionals, options.json));
    return;
  }

  if (command === "version") {
    console.log(options.json ? JSON.stringify({ name: "browser-relay", version: CLI_VERSION }) : CLI_VERSION);
    return;
  }

  if (command === "doctor" || command === "diagnose" || command === "check") {
    const report = await runDoctor(defaultDoctorDeps(options), { fix: options.fix });
    console.log(options.json ? JSON.stringify(report, null, 2) : renderDoctorReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "status") {
    await printStatusAndJournal(options);
    return;
  }

  if (command === "repl" || command === "interactive" || command === "shell") {
    const readline = await import("node:readline");
    const ws = await ensureBrokerConnected(options.brokerUrl);
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║             browser-relay interactive shell (connected to broker)          ║
║      Type commands directly (e.g. 'snapshot', 'click 3', 'tabs', 'exit')   ║
╚════════════════════════════════════════════════════════════════════════════╝
`);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "relay> ",
    });
    rl.prompt();
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        continue;
      }
      if (trimmed === "exit" || trimmed === "quit") {
        break;
      }
      try {
        const lineArgs = splitCommandLine(trimmed);
        await runCli(lineArgs, ws);
      } catch (err: any) {
        console.error(`❌ ${err?.message || err}`);
      }
      rl.prompt();
    }
    rl.close();
    ws.close();
    console.log("👋 Exited interactive shell.");
    return;
  }

  if (command === "batch") {
    const filePath = positionals[0];
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error("Usage: browser-relay batch <path-to-commands-file>");
    }
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    console.log(`🚀 Executing ${lines.length} batch command(s) from ${filePath}...`);
    const ws = existingWs || (await ensureBrokerConnected(options.brokerUrl));
    try {
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        console.log(`\n[${idx + 1}/${lines.length}] > ${line}`);
        const lineArgs = splitCommandLine(line);
        await runCli(lineArgs, ws);
      }
      console.log(`\n🎉 All ${lines.length} batch commands executed successfully.`);
    } finally {
      if (!existingWs) ws.close();
    }
    return;
  }

  if (command === "monitor") {
    await printStatusAndJournal(options);
    if (options.follow) {
      const ws = await ensureBrokerConnected(options.brokerUrl);
      console.log(`📡 Streaming live events from ${options.brokerUrl} (Ctrl+C to stop)...`);
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

  if (command === "save-dialog" || command === "confirm-dialog" || command === "accept-dialog") {
    const filename = positionals[0] || undefined;
    const isCancel = options.cancel;
    const res = dismissNativeSaveDialog({ filename, action: isCancel ? "cancel" : "save" });
    if (res.dismissed) {
      if (options.json) {
        console.log(JSON.stringify({ success: true, verified: true, ...res }));
      } else {
        console.log(`💾 Confirmed and dismissed native ${res.windowTitle || "Save As"} dialogue box (${res.actionTaken}).`);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ success: false, verified: false, outcome_summary: "No active native Save As dialogue box found", ...res }));
      } else {
        console.log("ℹ️ No active native Save As dialogue box detected.");
      }
    }
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

    case "switch-tab":
    case "focus":
    case "tab": {
      const target = positionals.join(" ").trim();
      if (!target) {
        throw new Error("Usage: browser-relay switch-tab <tabId|search-query>");
      }
      if (/^\d+$/.test(target)) {
        action = {
          type: "browser_switch_tab" as BrowserActionType,
          value: target,
          risk: "non_sensitive_mutation",
          is_irreversible: false,
        };
        options.tabId = parseInt(target, 10);
      } else {
        const tabsRes = await executeRelayAction(
          { type: "browser_list_tabs" as BrowserActionType, risk: "read_only", is_irreversible: false },
          options,
          existingWs
        );
        const allTabs: Array<{ id: number; title: string; url: string }> = tabsRes?.tabs || [];
        const query = target.toLowerCase();
        const matched = allTabs.find(
          (t) => (t.title && t.title.toLowerCase().includes(query)) || (t.url && t.url.toLowerCase().includes(query))
        );
        if (!matched) {
          throw new Error(`No open Chrome tab matched "${target}". Run 'browser-relay tabs' to view all open tabs.`);
        }
        action = {
          type: "browser_switch_tab" as BrowserActionType,
          value: String(matched.id),
          risk: "non_sensitive_mutation",
          is_irreversible: false,
        };
        options.tabId = matched.id;
      }
      break;
    }

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

    case "reload":
    case "refresh":
      action = {
        type: "browser_eval" as BrowserActionType,
        text: "location.reload()",
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;

    case "back":
      action = {
        type: "browser_eval" as BrowserActionType,
        text: "history.back()",
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;

    case "forward":
      action = {
        type: "browser_eval" as BrowserActionType,
        text: "history.forward()",
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;

    case "url":
      action = {
        type: "browser_eval" as BrowserActionType,
        text: "window.location.href",
        risk: "read_only",
        is_irreversible: false,
      };
      break;

    case "title":
      action = {
        type: "browser_eval" as BrowserActionType,
        text: "document.title",
        risk: "read_only",
        is_irreversible: false,
      };
      break;

    case "snapshot":
    case "observe":
    case "dom":
      action = { type: "browser_snapshot", risk: "read_only", is_irreversible: false };
      break;

    case "find":
    case "search": {
      const query = positionals.join(" ").trim();
      if (!query) throw new Error("Usage: browser-relay find <query-text>");
      const jsFind = `(() => {
        const query = ${JSON.stringify(query.toLowerCase())};
        function isVisible(el) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const s = window.getComputedStyle(el);
          return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
        }
        const selectorQuery = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, [tabindex="0"]';
        const interactive = Array.from(document.querySelectorAll(selectorQuery)).filter(isVisible);
        const matches = [];
        for (let i = 0; i < interactive.length; i++) {
          const el = interactive[i];
          const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.value || '').replace(/\\s+/g, ' ').trim();
          if (text.toLowerCase().includes(query)) {
            const rawIdx = el.getAttribute('data-relay-index');
            matches.push({
              index: rawIdx ? parseInt(rawIdx, 10) : i,
              tag: el.tagName.toLowerCase(),
              label: text.slice(0, 80),
              selector: el.id ? '#' + el.id : el.className ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : undefined,
              href: el.href || undefined
            });
          }
        }
        return { query: ${JSON.stringify(query)}, count: matches.length, matches: matches.slice(0, 30) };
      })()`;
      action = {
        type: "browser_eval" as BrowserActionType,
        text: jsFind,
        risk: "read_only",
        is_irreversible: false,
      };
      const res = await executeRelayAction(action, options, existingWs);
      const findData = res?.eval_result || { query, count: 0, matches: [] };
      if (options.json) {
        console.log(JSON.stringify({ success: true, ...findData }, null, 2));
      } else {
        if (!findData.matches || findData.matches.length === 0) {
          console.log(`🔍 No interactive elements found matching "${query}".`);
        } else {
          console.log(`🔍 Found ${findData.count} interactive match(es) for "${query}":`);
          for (const m of findData.matches) {
            console.log(
              `  [${m.index}] <${m.tag}> "${m.label}"${m.selector ? ` selector='${m.selector}'` : ""}${m.href ? ` href='${m.href}'` : ""}`
            );
          }
          console.log(`\n💡 Tip: Click any match using "browser-relay click <index>"`);
        }
      }
      return;
    }

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

    case "dblclick":
    case "double-click": {
      const target = positionals.join(" ").trim();
      if (!target) throw new Error("Usage: browser-relay dblclick <label|selector|x,y>");
      action = {
        type: "browser_dblclick" as BrowserActionType,
        locator: buildLocatorFromArg(target),
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "rightclick":
    case "contextmenu": {
      const target = positionals.join(" ").trim();
      if (!target) throw new Error("Usage: browser-relay rightclick <label|selector|x,y>");
      action = {
        type: "browser_rightclick" as BrowserActionType,
        locator: buildLocatorFromArg(target),
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      break;
    }

    case "hover": {
      const target = positionals.join(" ").trim();
      if (!target) throw new Error("Usage: browser-relay hover <label|selector|x,y>");
      action = {
        type: "browser_hover" as BrowserActionType,
        locator: buildLocatorFromArg(target),
        risk: "read_only",
        is_irreversible: false,
      };
      break;
    }

    case "clear": {
      const target = positionals.join(" ").trim();
      const locator = target ? buildLocatorFromArg(target) : {};
      action = {
        type: "browser_type",
        locator,
        text: "",
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
      const res = await executeRelayAction(action, options, existingWs);
      if (!res?.screenshot_base64) {
        throw new Error(res?.error || "Screenshot capture returned no image data");
      }
      const outPath = path.resolve(process.cwd(), positionals[0] || "screenshot.png");
      fs.writeFileSync(outPath, Buffer.from(res.screenshot_base64, "base64"));
      const bytes = Buffer.byteLength(res.screenshot_base64, "base64");
      if (options.json) {
        console.log(JSON.stringify({ success: true, file: outPath, bytes }));
      } else {
        console.log(`📸 Screenshot saved to ${outPath} (${bytes} bytes)`);
      }
      return;
    }

    case "pdf":
    case "print": {
      action = {
        type: "browser_pdf" as BrowserActionType,
        risk: "read_only",
        is_irreversible: false,
      };
      const res = await executeRelayAction(action, options, existingWs);
      if (!res?.pdf_base64) {
        throw new Error(res?.error || "PDF generation returned no document data");
      }
      const outPath = path.resolve(process.cwd(), positionals[0] || "page.pdf");
      fs.writeFileSync(outPath, Buffer.from(res.pdf_base64, "base64"));
      const bytes = Buffer.byteLength(res.pdf_base64, "base64");
      if (options.json) {
        console.log(JSON.stringify({ success: true, file: outPath, bytes }));
      } else {
        console.log(`📄 PDF saved to ${outPath} (${bytes} bytes)`);
      }
      return;
    }

    case "cookies": {
      const jsCookies = `(() => {
        return document.cookie.split('; ').filter(Boolean).map(c => {
          const eq = c.indexOf('=');
          return { name: eq >= 0 ? c.slice(0, eq) : c, value: eq >= 0 ? c.slice(eq + 1) : '' };
        });
      })()`;
      action = {
        type: "browser_eval" as BrowserActionType,
        text: jsCookies,
        risk: "read_only",
        is_irreversible: false,
      };
      const res = await executeRelayAction(action, options, existingWs);
      const cookieList = Array.isArray(res?.eval_result) ? res.eval_result : [];
      if (options.json) {
        console.log(JSON.stringify({ success: true, count: cookieList.length, cookies: cookieList }, null, 2));
      } else {
        console.log(`🍪 Cookies (${cookieList.length}):`);
        for (const c of cookieList) {
          console.log(`  - ${c.name} = ${c.value.slice(0, 40)}${c.value.length > 40 ? "..." : ""}`);
        }
      }
      return;
    }

    case "storage": {
      const jsStorage = `(() => {
        const ls = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) ls[k] = localStorage.getItem(k);
        }
        const ss = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k) ss[k] = sessionStorage.getItem(k);
        }
        return { localStorage: ls, sessionStorage: ss };
      })()`;
      action = {
        type: "browser_eval" as BrowserActionType,
        text: jsStorage,
        risk: "read_only",
        is_irreversible: false,
      };
      const res = await executeRelayAction(action, options, existingWs);
      const data = res?.eval_result || { localStorage: {}, sessionStorage: {} };
      if (options.json) {
        console.log(JSON.stringify({ success: true, ...data }, null, 2));
      } else {
        const keyTarget = positionals[0];
        if (keyTarget) {
          const val = data.localStorage?.[keyTarget] ?? data.sessionStorage?.[keyTarget];
          console.log(`💾 ${keyTarget}: ${val !== undefined ? val : "(not found)"}`);
        } else {
          const lsKeys = Object.keys(data.localStorage || {});
          const ssKeys = Object.keys(data.sessionStorage || {});
          console.log(`💾 localStorage (${lsKeys.length} items):`);
          for (const k of lsKeys) console.log(`  - ${k}: ${String(data.localStorage[k]).slice(0, 50)}`);
          console.log(`\n💾 sessionStorage (${ssKeys.length} items):`);
          for (const k of ssKeys) console.log(`  - ${k}: ${String(data.sessionStorage[k]).slice(0, 50)}`);
        }
      }
      return;
    }

    case "zoom": {
      const level = positionals[0] || "100%";
      const val = level.toLowerCase() === "reset" ? "1" : level;
      action = {
        type: "browser_eval" as BrowserActionType,
        text: `document.body.style.zoom = ${JSON.stringify(val)}`,
        risk: "non_sensitive_mutation",
        is_irreversible: false,
      };
      await executeRelayAction(action, options, existingWs);
      if (options.json) {
        console.log(JSON.stringify({ success: true, zoom: level }));
      } else {
        console.log(`🔍 Zoom set to ${level}`);
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
      throw new Error(unknownCommandMessage(command));
  }

  const outcome = await executeRelayAction(action, options, existingWs);

  if (options.json) {
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  if (action.type === ("browser_list_tabs" as any) && Array.isArray(outcome?.tabs)) {
    console.log(`🗂️ Open Chrome Tabs (${outcome.tabs.length}):`);
    for (const t of outcome.tabs) {
      console.log(`  [${t.id}] ${t.active ? "★ ACTIVE" : "        "} | ${t.title || "(Untitled)"} -> ${t.url}`);
    }
  } else if (action.type === ("browser_switch_tab" as any)) {
    console.log(`🔀 ${outcome?.outcome_summary || `Switched to tab ${options.tabId}`}`);
  } else if (action.type === ("browser_dblclick" as any)) {
    console.log(`🖱️🖱️ ${outcome?.outcome_summary || "Double-clicked element."}`);
  } else if (action.type === ("browser_rightclick" as any)) {
    console.log(`🖱️ ${outcome?.outcome_summary || "Right-clicked element."}`);
  } else if (action.type === "browser_snapshot" && outcome?.snapshot) {
    const snap = outcome.snapshot;
    console.log(`🌐 URL:   ${snap.url}`);
    console.log(`📄 Title: ${snap.title}`);
    if (snap.is_modal_active) {
      console.log(`⚡ Active Modal/Dialog: "${snap.modal_title || 'Active Dialog'}"`);
    }
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
  } else if (command === "reload" || command === "refresh") {
    console.log("🔄 Reloaded tab.");
  } else if (command === "back") {
    console.log("◀️ Navigated back.");
  } else if (command === "forward") {
    console.log("▶️ Navigated forward.");
  } else if (command === "url") {
    console.log(outcome?.eval_result || "about:blank");
  } else if (command === "title") {
    console.log(outcome?.eval_result || "Untitled");
  } else if (command === "clear") {
    console.log("🧹 Cleared input field.");
  } else if (command === "hover") {
    const h = outcome?.outcome_summary || outcome?.eval_result?.hovered || "Hovered over element.";
    console.log(`👆 ${h}`);
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

const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(__filename) ||
    process.argv[1].endsWith("browser-relay") ||
    process.argv[1].endsWith("oc-relay") ||
    process.argv[1].endsWith("cli.js"));

if (isMain) {
  const argv = process.argv.slice(2);
  runCli(argv).catch((err) => {
    const message = err?.message || String(err);
    if (argv.includes("--json") || argv.includes("-j")) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(`❌ ${message}`);
    }
    process.exit(1);
  });
}
