import { randomUUID } from "node:crypto";
import path from "node:path";
import type WebSocket from "ws";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  duration_ms: number;
}

export interface DoctorReport {
  ok: boolean;
  generated_at: string;
  broker_url: string;
  summary: Record<CheckStatus, number>;
  checks: DoctorCheck[];
}

export interface JournalStats {
  path: string;
  runs: number;
  actions: number;
  stale_pending: number;
}

export interface DoctorDeps {
  brokerUrl: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  nodeVersion: string;
  repoRoot: string;
  homeDir: string;
  fileExists: (file: string) => boolean;
  connect: (url: string, timeoutMs: number) => Promise<WebSocket | null>;
  startBroker?: () => Promise<boolean>;
  readJournal?: () => Promise<JournalStats | null>;
  registryHasKey?: (key: string) => boolean | null;
  timeouts?: { connectMs?: number; extensionMs?: number };
}

export const NATIVE_HOST_NAME = "com.opencode.chrome_relay";
const REQUIRED_EXTENSION_OUTPUTS = ["dist/background/index.js", "dist/content/index.js", "dist/sidepanel/index.html"];

export function brokerBinaryCandidates(repoRoot: string, platform: NodeJS.Platform): string[] {
  const exe = platform === "win32" ? "relay-broker.exe" : "relay-broker";
  return ["debug", "release"].map((profile) => path.join(repoRoot, "target", profile, exe));
}

export function nativeHostManifestPaths(platform: NodeJS.Platform, homeDir: string): string[] {
  const file = `${NATIVE_HOST_NAME}.json`;
  if (platform === "darwin") {
    const base = path.join(homeDir, "Library", "Application Support");
    return [
      path.join(base, "Google", "Chrome", "NativeMessagingHosts", file),
      path.join(base, "Chromium", "NativeMessagingHosts", file),
    ];
  }
  if (platform === "linux") {
    const base = path.join(homeDir, ".config");
    return [
      path.join(base, "google-chrome", "NativeMessagingHosts", file),
      path.join(base, "chromium", "NativeMessagingHosts", file),
    ];
  }
  return [];
}

function parseVersion(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  return [major, minor, patch];
}

function atLeast(version: string, major: number, minor: number): boolean {
  const [ma, mi] = parseVersion(version);
  return ma > major || (ma === major && mi >= minor);
}

interface RelayReply {
  kind: "finished" | "failed" | "unauthorized" | "timeout";
  payload?: any;
  error?: string;
}

export function authenticate(ws: WebSocket, token: string, timeoutMs: number): Promise<"ok" | "unauthorized" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "bridge.connected") finish("ok");
        else if (msg.error === "Unauthorized") finish("unauthorized");
      } catch {
        return;
      }
    };
    const finish = (result: "ok" | "unauthorized" | "timeout") => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(result);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ auth_token: token }));
  });
}

export function requestViaBroker(ws: WebSocket, action: Record<string, unknown>, timeoutMs: number): Promise<RelayReply> {
  const key = `doctor_${randomUUID()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.error === "Unauthorized") return finish({ kind: "unauthorized" });
      if (msg.idempotency_key !== key) return;
      if (msg.event === "action.finished") finish({ kind: "finished", payload: msg.payload });
      else if (msg.event === "action.failed") finish({ kind: "failed", error: msg.payload?.error, payload: msg.payload });
    };
    const finish = (reply: RelayReply) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(reply);
    };
    ws.on("message", onMessage);
    ws.send(
      JSON.stringify({
        v: 1,
        event: "browser.action.request",
        event_id: `evt_${key}`,
        timestamp: new Date().toISOString(),
        run_id: "doctor",
        epoch: 0,
        sequence: 0,
        idempotency_key: key,
        action,
      })
    );
  });
}

async function timed(
  id: string,
  title: string,
  run: () => Promise<Omit<DoctorCheck, "id" | "title" | "duration_ms">> | Omit<DoctorCheck, "id" | "title" | "duration_ms">
): Promise<DoctorCheck> {
  const started = Date.now();
  try {
    const result = await run();
    return { id, title, ...result, duration_ms: Date.now() - started };
  } catch (error) {
    return {
      id,
      title,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - started,
    };
  }
}

function checkNode(deps: DoctorDeps) {
  return timed("node", "Node.js runtime", () => {
    if (!atLeast(deps.nodeVersion, 20, 0)) {
      return { status: "fail", detail: `Node ${deps.nodeVersion} is too old`, hint: "Install Node.js 22 LTS or newer" };
    }
    if (!atLeast(deps.nodeVersion, 22, 5)) {
      return {
        status: "warn",
        detail: `Node ${deps.nodeVersion} works, but node:sqlite needs 22.5+`,
        hint: "Upgrade to Node 22.5+ so `status` and `doctor` can read the action journal",
      };
    }
    return { status: "pass", detail: `Node ${deps.nodeVersion}` };
  });
}

function checkConfig(deps: DoctorDeps) {
  return timed("config", "Environment configuration", () => {
    const problems: string[] = [];
    const notes: string[] = [];
    const { env } = deps;

    try {
      const url = new URL(deps.brokerUrl);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") problems.push(`broker URL must be ws:// or wss:// (got ${url.protocol})`);
    } catch {
      problems.push(`broker URL "${deps.brokerUrl}" is not a valid URL`);
    }
    if (env.RELAY_TAB_ID !== undefined && !/^[1-9]\d*$/.test(env.RELAY_TAB_ID.trim())) {
      problems.push(`RELAY_TAB_ID="${env.RELAY_TAB_ID}" is not a positive integer`);
    }
    if (env.RELAY_JSONL_CONCURRENCY !== undefined && !/^[1-9]\d*$/.test(env.RELAY_JSONL_CONCURRENCY.trim())) {
      problems.push(`RELAY_JSONL_CONCURRENCY="${env.RELAY_JSONL_CONCURRENCY}" is not a positive integer`);
    }
    for (const flag of ["RELAY_ISOLATE_TAB", "RELAY_BACKGROUND"]) {
      const value = env[flag];
      if (value !== undefined && !/^(1|0|true|false|yes|no|on|off)$/i.test(value.trim())) {
        problems.push(`${flag}="${value}" should be 1/0 or true/false`);
      }
    }

    notes.push(env.RELAY_RUN_ID ? `run ${env.RELAY_RUN_ID}` : "run run_1 (shared default)");
    if (env.RELAY_TAB_ID) notes.push(`tab ${env.RELAY_TAB_ID}`);
    if (/^(1|true|yes|on)$/i.test(env.RELAY_ISOLATE_TAB || "")) notes.push("isolated tabs");
    if (env.RELAY_AUTH_TOKEN) notes.push("auth token set");

    if (problems.length) {
      return { status: "fail", detail: problems.join("; "), hint: "Fix or unset the variables above" };
    }
    if (!env.RELAY_RUN_ID) {
      return {
        status: "warn",
        detail: `${notes.join(", ")}`,
        hint: "Parallel pipelines should each export RELAY_RUN_ID (and RELAY_TAB_ID) so they never share a session or tab",
      };
    }
    return { status: "pass", detail: notes.join(", ") };
  });
}

function checkBrokerBinary(deps: DoctorDeps) {
  return timed("broker-binary", "Broker binary", () => {
    const candidates = brokerBinaryCandidates(deps.repoRoot, deps.platform);
    const found = candidates.find(deps.fileExists);
    if (found) return { status: "pass", detail: path.relative(deps.repoRoot, found) || found };
    return {
      status: "warn",
      detail: "No local relay-broker build found, so the CLI cannot auto-start the broker",
      hint: "cargo build -p relay-broker --release",
    };
  });
}

function checkExtensionBuild(deps: DoctorDeps) {
  return timed("extension-build", "Extension build", () => {
    const extDir = path.join(deps.repoRoot, "apps", "chrome-extension");
    if (!deps.fileExists(path.join(extDir, "manifest.json"))) {
      return { status: "skip", detail: "Not running from a source checkout" };
    }
    const missing = REQUIRED_EXTENSION_OUTPUTS.filter((rel) => !deps.fileExists(path.join(extDir, rel)));
    if (missing.length) {
      return { status: "fail", detail: `Missing ${missing.join(", ")}`, hint: "npm run build, then reload the unpacked extension" };
    }
    return { status: "pass", detail: "Built (load apps/chrome-extension as an unpacked extension)" };
  });
}

function checkNativeHost(deps: DoctorDeps) {
  return timed("native-host", "Native messaging host", () => {
    const fallbackNote = "Only needed for the native-messaging fallback; the extension talks to the broker over WebSocket";
    if (deps.platform === "win32") {
      const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      const present = deps.registryHasKey?.(key) ?? null;
      if (present === null) return { status: "skip", detail: "Could not query the registry" };
      return present
        ? { status: "pass", detail: `Registered (${key})` }
        : { status: "warn", detail: "Not registered", hint: `${fallbackNote}. Install: installer\\windows\\install-host.ps1` };
    }
    const paths = nativeHostManifestPaths(deps.platform, deps.homeDir);
    if (!paths.length) return { status: "skip", detail: `Unsupported platform ${deps.platform}` };
    const found = paths.find(deps.fileExists);
    return found
      ? { status: "pass", detail: found }
      : { status: "warn", detail: "Host manifest not installed", hint: `${fallbackNote}. Expected at ${paths[0]}` };
  });
}

function checkJournal(deps: DoctorDeps) {
  return timed("journal", "SQLite action journal", async () => {
    if (!deps.readJournal) return { status: "skip", detail: "Journal reader unavailable" };
    const stats = await deps.readJournal();
    if (!stats) return { status: "skip", detail: "No journal yet (created on first broker run)" };
    const detail = `${stats.runs} runs, ${stats.actions} actions (${stats.path})`;
    if (stats.stale_pending > 0) {
      return {
        status: "warn",
        detail: `${detail}; ${stats.stale_pending} action(s) pending for over 10 minutes`,
        hint: "These never received a result; usually the extension was reloaded mid-action. Safe to ignore or restart the run",
      };
    }
    return { status: "pass", detail };
  });
}

export async function runDoctor(deps: DoctorDeps, options: { fix?: boolean } = {}): Promise<DoctorReport> {
  const connectMs = deps.timeouts?.connectMs ?? 1500;
  const extensionMs = deps.timeouts?.extensionMs ?? 4000;

  const localChecks = Promise.all([
    checkNode(deps),
    checkConfig(deps),
    checkBrokerBinary(deps),
    checkExtensionBuild(deps),
    checkNativeHost(deps),
  ]);

  let ws: WebSocket | null = null;
  const brokerCheck = await timed("broker", "Broker connection", async () => {
    const started = Date.now();
    ws = await deps.connect(deps.brokerUrl, connectMs);
    if (!ws && options.fix && deps.startBroker) {
      const launched = await deps.startBroker();
      if (launched) ws = await deps.connect(deps.brokerUrl, connectMs);
      if (ws) return { status: "pass", detail: `Started broker and connected (${deps.brokerUrl})` };
    }
    if (!ws) {
      return {
        status: "fail",
        detail: `Nothing answered at ${deps.brokerUrl}`,
        hint: options.fix
          ? "Could not start it automatically. Run: cargo run -p relay-broker --release"
          : "Run `browser-relay doctor --fix` or start it: cargo run -p relay-broker --release",
      };
    }
    return { status: "pass", detail: `${deps.brokerUrl} (${Date.now() - started} ms)` };
  });

  const relayChecks: DoctorCheck[] = [brokerCheck];
  const socket = ws as WebSocket | null;

  if (!socket) {
    relayChecks.push(
      { id: "extension", title: "Chrome extension link", status: "skip", detail: "Broker unreachable", duration_ms: 0 },
      { id: "tab-binding", title: "Pinned tab", status: "skip", detail: "Broker unreachable", duration_ms: 0 }
    );
  } else {
    let extensionUp = false;
    let authFailed = false;
    relayChecks.push(
      await timed("extension", "Chrome extension link", async () => {
        const token = deps.env.RELAY_AUTH_TOKEN;
        const auth = token ? await authenticate(socket, token, connectMs) : "ok";
        const reply: RelayReply =
          auth === "ok" ? await requestViaBroker(socket, { type: "browser_status" }, extensionMs) : { kind: "unauthorized" };
        if (reply.kind === "unauthorized") {
          authFailed = true;
          return {
            status: "fail",
            detail: "Broker rejected the auth token",
            hint: deps.env.RELAY_AUTH_TOKEN ? "RELAY_AUTH_TOKEN does not match the broker" : "The broker requires RELAY_AUTH_TOKEN",
          };
        }
        if (reply.kind === "timeout") {
          return {
            status: "fail",
            detail: `No extension answered within ${extensionMs} ms`,
            hint: "Open Chrome with the OpenCode Chrome Relay extension enabled (chrome://extensions), then rerun",
          };
        }
        if (reply.kind === "failed") {
          return { status: "warn", detail: `Extension answered with an error: ${reply.error || "unknown"}` };
        }
        extensionUp = true;
        const tab = reply.payload?.active_tab_id;
        return { status: "pass", detail: `Connected${tab ? `, active tab ${tab}` : ", no active tab"}` };
      })
    );

    relayChecks.push(
      await timed("tab-binding", "Pinned tab", async () => {
        const pinned = deps.env.RELAY_TAB_ID?.trim();
        if (!pinned) return { status: "skip", detail: "RELAY_TAB_ID not set (commands use the active tab)" };
        if (!extensionUp) return { status: "skip", detail: authFailed ? "Not authorized" : "Extension unreachable" };
        const reply = await requestViaBroker(socket, { type: "browser_list_tabs" }, extensionMs);
        const tabs: Array<{ id: number; title?: string; url?: string }> = reply.payload?.tabs ?? [];
        const match = tabs.find((t) => String(t.id) === pinned);
        if (!match) {
          return {
            status: "fail",
            detail: `Tab ${pinned} is not open (${tabs.length} tabs open)`,
            hint: "Open a fresh one: browser-relay new-tab <url> --background --json, then update RELAY_TAB_ID",
          };
        }
        return { status: "pass", detail: `Tab ${pinned}: ${match.title || match.url || "untitled"}` };
      })
    );
    socket.close();
  }

  const journalCheck = await checkJournal(deps);
  return finalize(deps, [...(await localChecks), journalCheck, ...relayChecks]);
}

function finalize(deps: DoctorDeps, checks: DoctorCheck[]): DoctorReport {
  const summary: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;
  return {
    ok: summary.fail === 0,
    generated_at: new Date().toISOString(),
    broker_url: deps.brokerUrl,
    summary,
    checks,
  };
}

const ICONS: Record<CheckStatus, string> = { pass: "✅", warn: "⚠️ ", fail: "❌", skip: "⏭️ " };

export function renderDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.title.length)) + 2;
  const lines = ["🩺 browser-relay doctor", ""];
  for (const check of report.checks) {
    lines.push(`${ICONS[check.status]} ${check.title.padEnd(width)}${check.detail}`);
    if (check.hint && check.status !== "pass") lines.push(`   ${" ".repeat(width)}↳ ${check.hint}`);
  }
  const { pass, warn, fail, skip } = report.summary;
  lines.push(
    "",
    `${report.ok ? "🎉 Healthy" : "🚨 Problems found"}: ${pass} passed, ${warn} warning(s), ${fail} failed, ${skip} skipped`,
    ""
  );
  return lines.join("\n");
}
