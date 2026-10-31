import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  COMMANDS,
  allCommandNames,
  helpManifest,
  renderCommandHelp,
  renderOverview,
  resolveCommand,
  suggestCommands,
  unknownCommandMessage,
} from "../../packages/opencode-plugin/src/cli_help.js";
import { parseCliArgs, renderHelp } from "../../packages/opencode-plugin/src/cli.js";
import {
  brokerBinaryCandidates,
  nativeHostManifestPaths,
  renderDoctorReport,
  runDoctor,
  type DoctorDeps,
} from "../../packages/opencode-plugin/src/doctor.js";

const CLI_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../packages/opencode-plugin/src/cli.ts"), "utf-8");

describe("CLI help registry", () => {
  it("documents every command and alias the CLI dispatches", () => {
    const dispatched = new Set<string>();
    for (const match of CLI_SOURCE.matchAll(/case "([a-z-]+)":/g)) dispatched.add(match[1]);
    for (const match of CLI_SOURCE.matchAll(/command === "([a-z][a-z-]*)"/g)) dispatched.add(match[1]);
    const documented = new Set(allCommandNames());
    const missing = [...dispatched].filter((name) => !documented.has(name));
    expect(missing).toEqual([]);
  });

  it("never maps one alias to two commands", () => {
    const seen = new Map<string, string>();
    for (const spec of COMMANDS) {
      for (const name of [spec.name, ...spec.aliases]) {
        expect(seen.get(name), `${name} is claimed twice`).toBeUndefined();
        seen.set(name, spec.name);
      }
    }
  });

  it("gives every command a summary, usage starting with its name, and at least one example", () => {
    for (const spec of COMMANDS) {
      expect(spec.summary.length).toBeGreaterThan(5);
      expect(spec.usage.startsWith(spec.name)).toBe(true);
      expect(spec.examples.length).toBeGreaterThan(0);
    }
  });

  it("resolves aliases case-insensitively", () => {
    expect(resolveCommand("GOTO")?.name).toBe("nav");
    expect(resolveCommand("double-click")?.name).toBe("dblclick");
    expect(resolveCommand("nope")).toBeUndefined();
  });

  it("suggests close matches for typos", () => {
    expect(suggestCommands("clik")[0]).toBe("click");
    expect(suggestCommands("snapshto")[0]).toBe("snapshot");
    expect(suggestCommands("doctr")[0]).toBe("doctor");
    expect(suggestCommands("zzzzzzzz")).toEqual([]);
    expect(unknownCommandMessage("clik")).toContain("Did you mean: click?");
  });

  it("renders a grouped overview with environment, parallel recipe and exit codes", () => {
    const text = renderOverview("9.9.9");
    for (const heading of ["SETUP & DIAGNOSTICS", "INTERACT", "GLOBAL OPTIONS", "ENVIRONMENT", "PARALLEL PIPELINES", "EXIT CODES"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("browser-relay 9.9.9");
    expect(text).toContain("RELAY_TAB_ID");
    expect(text).toContain("--broker <url>");
  });

  it("renders per-command help with aliases, options and examples", () => {
    const text = renderCommandHelp(resolveCommand("save-dialog")!);
    expect(text).toContain("browser-relay save-dialog [filename] [--cancel]");
    expect(text).toContain("confirm-dialog, accept-dialog");
    expect(text).toContain("--cancel, -c");
    expect(text).toContain("EXAMPLES");
  });

  it("serves help topics, JSON manifest and suggestions through renderHelp", () => {
    expect(renderHelp(["click"], false)).toContain("browser-relay click <index|name|selector|x,y>");
    expect(renderHelp([], false)).toContain("USAGE");
    const manifest = JSON.parse(renderHelp([], true));
    expect(manifest.commands.map((c: { name: string }) => c.name)).toContain("doctor");
    expect(manifest).toEqual(JSON.parse(JSON.stringify(helpManifest(manifest.version))));
    expect(() => renderHelp(["clik"], false)).toThrow(/Did you mean: click/);
  });
});

describe("CLI argument parsing for help, version, doctor and dialogs", () => {
  it("routes --help on a command to that command's help", () => {
    expect(parseCliArgs(["click", "--help"])).toMatchObject({ command: "help", positionals: ["click"] });
    expect(parseCliArgs(["-h"]).command).toBe("help");
  });

  it("routes --version and -V to the version command", () => {
    expect(parseCliArgs(["--version"]).command).toBe("version");
    expect(parseCliArgs(["-V"]).command).toBe("version");
  });

  it("parses doctor --fix and keeps --cancel out of positionals", () => {
    expect(parseCliArgs(["doctor", "--fix"]).options.fix).toBe(true);
    const dialog = parseCliArgs(["save-dialog", "--cancel"]);
    expect(dialog.options.cancel).toBe(true);
    expect(dialog.positionals).toEqual([]);
  });
});

describe("doctor helpers", () => {
  it("picks platform-correct broker binary names", () => {
    expect(brokerBinaryCandidates("/repo", "win32").every((p) => p.endsWith("relay-broker.exe"))).toBe(true);
    expect(brokerBinaryCandidates("/repo", "linux").every((p) => p.endsWith(`${path.sep}relay-broker`))).toBe(true);
    expect(brokerBinaryCandidates("/repo", "darwin")).toHaveLength(2);
  });

  it("knows where Chrome looks for native host manifests", () => {
    expect(nativeHostManifestPaths("linux", "/home/u")[0]).toBe(
      path.join("/home/u", ".config", "google-chrome", "NativeMessagingHosts", "com.opencode.chrome_relay.json")
    );
    expect(nativeHostManifestPaths("darwin", "/Users/u")[0]).toContain(path.join("Library", "Application Support"));
    expect(nativeHostManifestPaths("win32", "C:/Users/u")).toEqual([]);
  });
});

describe("runDoctor", () => {
  const servers: WebSocketServer[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) client.terminate();
            server.close(() => resolve());
          })
      )
    );
  });

  async function fakeRelay(options: { token?: string; extension?: boolean; tabs?: number[] } = {}) {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as { port: number };
    server.on("connection", (socket) => {
      let authed = !options.token;
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (!authed) {
          if (msg.auth_token === options.token) {
            authed = true;
            socket.send(JSON.stringify({ event: "bridge.connected" }));
          } else {
            socket.send(JSON.stringify({ error: "Unauthorized" }));
            socket.close();
          }
          return;
        }
        if (options.extension === false || msg.event !== "browser.action.request") return;
        const payload =
          msg.action.type === "browser_list_tabs"
            ? { tabs: (options.tabs ?? [5]).map((id) => ({ id, title: `Tab ${id}`, url: "https://x" })) }
            : { success: true, active_tab_id: 5, bridge_connected: true };
        socket.send(JSON.stringify({ event: "action.finished", idempotency_key: msg.idempotency_key, payload }));
      });
    });
    return `ws://127.0.0.1:${port}`;
  }

  function connectWs(url: string, timeoutMs: number): Promise<WebSocket | null> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => (ws.terminate(), resolve(null)), timeoutMs);
      ws.once("open", () => (clearTimeout(timer), resolve(ws)));
      ws.once("error", () => (clearTimeout(timer), resolve(null)));
    });
  }

  function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
    const files = new Set([
      "/repo/target/release/relay-broker",
      "/repo/apps/chrome-extension/manifest.json",
      "/repo/apps/chrome-extension/dist/background/index.js",
      "/repo/apps/chrome-extension/dist/content/index.js",
      "/repo/apps/chrome-extension/dist/sidepanel/index.html",
      "/home/u/.config/google-chrome/NativeMessagingHosts/com.opencode.chrome_relay.json",
    ].map((p) => path.normalize(p)));
    return {
      brokerUrl: "ws://127.0.0.1:1",
      env: { RELAY_RUN_ID: "pipeline_a" },
      platform: "linux",
      nodeVersion: "v22.12.0",
      repoRoot: path.normalize("/repo"),
      homeDir: path.normalize("/home/u"),
      fileExists: (file) => files.has(path.normalize(file)),
      connect: connectWs,
      readJournal: async () => ({ path: "/repo/opencode_relay.sqlite", runs: 2, actions: 9, stale_pending: 0 }),
      timeouts: { connectMs: 500, extensionMs: 400 },
      ...overrides,
    };
  }

  const byId = (report: Awaited<ReturnType<typeof runDoctor>>) =>
    Object.fromEntries(report.checks.map((c) => [c.id, c]));

  it("reports a fully healthy setup", async () => {
    const brokerUrl = await fakeRelay({ tabs: [5, 9] });
    const report = await runDoctor(deps({ brokerUrl, env: { RELAY_RUN_ID: "p", RELAY_TAB_ID: "9" } }));
    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ pass: 9, warn: 0, fail: 0, skip: 0 });
    expect(byId(report)["tab-binding"].detail).toContain("Tab 9");
    expect(renderDoctorReport(report)).toContain("🎉 Healthy: 9 passed");
  });

  it("fails the broker and skips dependent checks when nothing is listening", async () => {
    const report = await runDoctor(deps());
    const checks = byId(report);
    expect(report.ok).toBe(false);
    expect(checks.broker.status).toBe("fail");
    expect(checks.broker.hint).toContain("doctor --fix");
    expect(checks.extension.status).toBe("skip");
    expect(checks["tab-binding"].status).toBe("skip");
  });

  it("starts the broker with --fix and then connects", async () => {
    let started = false;
    const brokerUrl = "ws://127.0.0.1:1";
    let liveUrl = "";
    const report = await runDoctor(
      deps({
        brokerUrl,
        connect: (url, ms) => connectWs(started ? liveUrl : url, ms),
        startBroker: async () => {
          liveUrl = await fakeRelay();
          started = true;
          return true;
        },
      }),
      { fix: true }
    );
    expect(started).toBe(true);
    expect(byId(report).broker).toMatchObject({ status: "pass" });
    expect(byId(report).broker.detail).toContain("Started broker");
    expect(byId(report).extension.status).toBe("pass");
  });

  it("flags a missing extension with an actionable hint", async () => {
    const brokerUrl = await fakeRelay({ extension: false });
    const checks = byId(await runDoctor(deps({ brokerUrl })));
    expect(checks.broker.status).toBe("pass");
    expect(checks.extension.status).toBe("fail");
    expect(checks.extension.hint).toContain("chrome://extensions");
  });

  it("authenticates once and reuses the session for follow-up checks", async () => {
    const brokerUrl = await fakeRelay({ token: "s3cret", tabs: [7] });
    const checks = byId(
      await runDoctor(deps({ brokerUrl, env: { RELAY_RUN_ID: "p", RELAY_AUTH_TOKEN: "s3cret", RELAY_TAB_ID: "7" } }))
    );
    expect(checks.extension.status).toBe("pass");
    expect(checks["tab-binding"].status).toBe("pass");
  });

  it("reports a rejected auth token", async () => {
    const brokerUrl = await fakeRelay({ token: "right" });
    const checks = byId(await runDoctor(deps({ brokerUrl, env: { RELAY_RUN_ID: "p", RELAY_AUTH_TOKEN: "wrong" } })));
    expect(checks.extension.status).toBe("fail");
    expect(checks.extension.detail).toContain("rejected");
  });

  it("fails when the pinned tab is gone", async () => {
    const brokerUrl = await fakeRelay({ tabs: [1, 2] });
    const checks = byId(await runDoctor(deps({ brokerUrl, env: { RELAY_RUN_ID: "p", RELAY_TAB_ID: "99" } })));
    expect(checks["tab-binding"].status).toBe("fail");
    expect(checks["tab-binding"].hint).toContain("new-tab");
  });

  it("validates environment variables and nudges parallel pipelines toward RELAY_RUN_ID", async () => {
    const bad = byId(await runDoctor(deps({ env: { RELAY_TAB_ID: "abc", RELAY_JSONL_CONCURRENCY: "0", RELAY_ISOLATE_TAB: "maybe" } })));
    expect(bad.config.status).toBe("fail");
    expect(bad.config.detail).toContain("RELAY_TAB_ID");
    expect(bad.config.detail).toContain("RELAY_JSONL_CONCURRENCY");
    expect(bad.config.detail).toContain("RELAY_ISOLATE_TAB");

    const shared = byId(await runDoctor(deps({ env: {} })));
    expect(shared.config.status).toBe("warn");
    expect(shared.config.hint).toContain("RELAY_RUN_ID");

    const badUrl = byId(await runDoctor(deps({ brokerUrl: "http://localhost:4098" })));
    expect(badUrl.config.detail).toContain("ws:// or wss://");
  });

  it("grades the Node runtime", async () => {
    expect(byId(await runDoctor(deps({ nodeVersion: "v18.19.0" }))).node.status).toBe("fail");
    expect(byId(await runDoctor(deps({ nodeVersion: "v22.3.0" }))).node.status).toBe("warn");
    expect(byId(await runDoctor(deps({ nodeVersion: "v24.1.0" }))).node.status).toBe("pass");
  });

  it("checks install artifacts per platform", async () => {
    const bare = byId(await runDoctor(deps({ fileExists: () => false })));
    expect(bare["broker-binary"].status).toBe("warn");
    expect(bare["extension-build"].status).toBe("skip");
    expect(bare["native-host"].status).toBe("warn");

    const partial = byId(
      await runDoctor(deps({ fileExists: (f) => f.endsWith("manifest.json") && f.includes("chrome-extension") }))
    );
    expect(partial["extension-build"].status).toBe("fail");
    expect(partial["extension-build"].hint).toContain("npm run build");

    const win = byId(await runDoctor(deps({ platform: "win32", registryHasKey: () => true })));
    expect(win["native-host"].status).toBe("pass");
    expect(byId(await runDoctor(deps({ platform: "win32", registryHasKey: () => null })))["native-host"].status).toBe("skip");
  });

  it("warns about stale pending journal entries", async () => {
    const checks = byId(
      await runDoctor(deps({ readJournal: async () => ({ path: "/j", runs: 1, actions: 3, stale_pending: 2 }) }))
    );
    expect(checks.journal.status).toBe("warn");
    expect(checks.journal.detail).toContain("2 action(s) pending");
  });

  it("turns an exception inside a check into a failure instead of crashing", async () => {
    const checks = byId(await runDoctor(deps({ readJournal: async () => { throw new Error("database is locked"); } })));
    expect(checks.journal).toMatchObject({ status: "fail", detail: "database is locked" });
  });
});
