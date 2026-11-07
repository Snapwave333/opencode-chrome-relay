# 🌐 OpenCode Chrome Relay

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.85+-black.svg?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-green.svg?style=for-the-badge&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-purple.svg?style=for-the-badge)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/Platform-Windows_11-0078D4.svg?style=for-the-badge&logo=windows)](installer/windows/)

<p align="center">
  <strong>Let AI agents drive the Chrome you already use: your profile, your tabs, your logins.</strong>
</p>

<p align="center">
  <em>No second Playwright browser. No throwaway profile. No model keys inside the browser.</em>
</p>

[Why](#-why-opencode-chrome-relay) • [Architecture](#%EF%B8%8F-architecture) • [Quickstart](#-quickstart) • [Agent Integration](#-agent-integration) • [Tools](#%EF%B8%8F-browser-tools) • [Security](#%EF%B8%8F-security--privacy) • [Troubleshooting](#-troubleshooting)

---

</div>

## 💡 Why OpenCode Chrome Relay?

Puppeteer, Playwright and Selenium start a fresh, logged-out browser. That suits test suites, not a personal assistant:

* ❌ **Logged out:** every site needs a fresh login, and automated browsers draw more CAPTCHAs and 2FA prompts.
* ❌ **Credential handling:** cookies and keys have to be exported or passed into the automation context.
* ❌ **No brakes:** if an agent loops, the only stop is killing the process.
* ❌ **Blind runs:** you can't see what the agent is looking at until it acts.

The relay works the other way round:

| | Playwright / Puppeteer | OpenCode Chrome Relay |
| :--- | :--- | :--- |
| **Browser** | Separate, disposable, logged out | **Your real Chrome profile, already logged in** |
| **Sessions & cookies** | Export them or log in again | **Reused in place: cookies, passkeys, SSO** |
| **Model keys** | Often passed into the browser context | **Stay in the agent; the extension never sees them** |
| **Stopping a run** | Kill the process | **PAUSE, STOP, RESTART, TAKE OVER, backed by epoch fencing** |
| **Visibility** | Headless, or a debug window | **In-page overlay: outlines, click ripples, typing captions** |
| **Audit trail** | Console logs | **SQLite journal with tab leases and idempotency keys** |
| **Agent support** | Library API | **MCP server, JSONL stdio, CLI, OpenCode plugin** |

---

## ⚡ Key Features

* 🔐 **Your profile, your tabs:** works in your signed-in Chrome window, on Gmail, GitHub, cloud consoles, internal tools and so on.
* 🛡️ **Model keys stay put:** your OpenCode / Anthropic / OpenAI / local model credentials stay in the agent's runtime. The extension and web pages never receive them.
* 🛑 **Real stop controls:** **PAUSE**, **STOP**, **RESTART**, **TAKE OVER** and **RETURN CONTROL**. STOP and RESTART bump a monotonic epoch in the Rust broker, and any queued or late action carrying the old epoch is rejected.
* 🎯 **In-page overlay:** a Shadow DOM layer with target outlines, click ripples and typing captions. It uses `pointer-events: none`, so it never blocks your own clicks.
* 📜 **Durable journal:** every run, tab lease and action is written to SQLite. Idempotency keys stop non-idempotent actions from replaying after a reconnect.
* 🔌 **Works with any agent:** MCP for Claude Desktop, Cursor, Antigravity and similar; JSONL stdio for everything else; plus a shell CLI and an OpenCode plugin.
* 🚀 **Pipelines:** `browser_run_pipeline` runs an ordered list of steps (up to 1000) in one call, with per-step results and optional fail-fast.
* 📁 **Real files:** downloads use your Chrome session and wait until the file is saved; uploads attach local files without opening the OS dialog.
* 🦊 **Firefox port:** a WebExtension build lives in [`apps/firefox-extension`](apps/firefox-extension).

---

## 🏗️ Architecture

```
                       YOUR EVERYDAY CHROME
+-------------------------------------------------------------------+
| Side Panel Cockpit          | In-Page Action Overlay (Shadow DOM) |
| - session & timeline        | - target outlines / click ripples   |
| - PAUSE / STOP / RESTART    | - live typing captions              |
| - TAKE OVER / RETURN        | - pointer-events: none (passive)    |
+-------------------------------------------------------------------+
                   | chrome.runtime messaging
                   v
+-------------------------------------------------------------------+
| Manifest V3 service worker: tabs, DOM locators, CDP, downloads,   |
| uploads, overlay coordination, native messaging port              |
+-------------------------------------------------------------------+
                   | chrome.runtime.connectNative()  (stdio)
                   v
+-------------------------------------------------------------------+
| Rust native messaging host (`relay-native-host`)                  |
+-------------------------------------------------------------------+
                   | WebSocket, loopback, token-authenticated
                   v
+-------------------------------------------------------------------+
| Rust broker daemon (`relay-broker`)  ws://127.0.0.1:4098          |
| - SQLite journal, runs, tab leases, approvals                     |
| - Approval policy and epoch cancellation fencing                  |
+-------------------------------------------------------------------+
                   | WebSocket, loopback, token-authenticated
                   v
+-------------------------------------------------------------------+
| TypeScript clients                                                |
| - MCP / JSONL gateway (`@opencode/relay-agent-gateway`)           |
| - `browser-relay` / `oc-relay` CLI and OpenCode plugin            |
+-------------------------------------------------------------------+
                   |
                   v
+-------------------------------------------------------------------+
| ANY AI AGENT: OpenCode | Claude Desktop | Cursor | your scripts   |
+-------------------------------------------------------------------+
```

More detail: [docs/architecture.md](docs/architecture.md) and the [Master Design Record](OpenCode_Chrome_Relay_Master_Design_Record.md).

---

## 🚀 Quickstart

About 10 minutes on a machine that already has Node and Rust. The first Rust build alone can take 3–5 minutes.

### Prerequisites

* **OS:** Windows 10 / 11 (the installer scripts are PowerShell)
* **Browser:** Google Chrome 120+ (or Firefox 115+ for the port)
* **Runtimes:** [Node.js](https://nodejs.org/) 20+ and [Rust](https://rustup.rs/) 1.85+

### 1. Clone and build

```powershell
git clone https://github.com/Snapwave333/opencode-chrome-relay.git
cd opencode-chrome-relay
npm install
npm run build
cargo build --workspace
```

### 2. Start the broker

The broker must be running before anything can connect. Leave this window open:

```powershell
.\target\debug\relay-broker.exe
```

On its first run it generates an auth token and saves it to `%APPDATA%\opencode-relay\auth-token`. The native host, CLI and gateway all read that file, so you don't need to copy the token anywhere.

Optional environment variables: `RELAY_HOST` (default `127.0.0.1`), `RELAY_PORT` (default `4098`), `RELAY_DB_PATH` (default `opencode_relay.sqlite` in the current folder), `RELAY_AUTH_TOKEN` (overrides the token file).

### 3. Load the Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick `apps/chrome-extension`.
3. Check that the ID is `pogdiiiklddnjkdmnhkdbcelighmkjgb`. It is fixed by the `key` in the manifest.
4. Pin **OpenCode Chrome Relay** and open the side panel.

### 4. Register the native messaging host

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\windows\install-host.ps1 -ExtensionId pogdiiiklddnjkdmnhkdbcelighmkjgb
```

This writes the host manifest and the `HKCU` registry key that point Chrome at `target\debug\relay-native-host.exe`. Add `-TargetConfig release` if you built with `--release`. Then reload the extension on `chrome://extensions`.

To remove it later: `installer\windows\uninstall-host.ps1`.

### 5. Check it works

```powershell
node packages/opencode-plugin/dist/cli.js status
node packages/opencode-plugin/dist/cli.js tabs
```

`tabs` should list your open Chrome tabs. If not, see [Troubleshooting](#-troubleshooting).

<details>
<summary><strong>🦊 Firefox</strong></summary>

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `apps/firefox-extension/manifest.json`.
2. Register the host for Firefox:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\installer\windows\install-host-firefox.ps1
   ```

The add-on ID is `opencode-relay@example.com`, which is the installer's default.

</details>

---

## 🤖 Agent Integration

### Option A: MCP (Claude Desktop, Cursor, Antigravity…)

Add the gateway to your agent's MCP config, e.g. `claude_desktop_config.json`. Use the absolute path to your clone:

```json
{
  "mcpServers": {
    "relay-browser": {
      "command": "node",
      "args": ["C:\\path\\to\\opencode-chrome-relay\\packages\\agent-gateway\\dist\\index.js"]
    }
  }
}
```

The gateway reads the token from `%APPDATA%\opencode-relay\auth-token`. Add an `env` block only to override it, using `RELAY_BROKER_URL` or `RELAY_AUTH_TOKEN`. Never commit a real token to a config file.

### Option B: OpenCode plugin

Copy (or link) `packages/opencode-plugin` into `~/.config/opencode/plugins/opencode-chrome-relay`. OpenCode loads plugins from that folder on startup.

### Option C: CLI (`browser-relay` / `oc-relay`)

For shell scripts and quick checks. Run `node packages/opencode-plugin/dist/cli.js --help` for the full list. Common commands:

```powershell
# Tabs and navigation
node packages/opencode-plugin/dist/cli.js tabs
node packages/opencode-plugin/dist/cli.js nav https://github.com --new-tab

# Look at the page: snapshot gives numbered elements you can click by index
node packages/opencode-plugin/dist/cli.js snapshot
node packages/opencode-plugin/dist/cli.js find "Sign in"

# Act on it
node packages/opencode-plugin/dist/cli.js click "Save preferences"
node packages/opencode-plugin/dist/cli.js type "#search" "epoch fencing"
node packages/opencode-plugin/dist/cli.js press Enter

# Files
node packages/opencode-plugin/dist/cli.js screenshot page.png
node packages/opencode-plugin/dist/cli.js download https://example.com/report.pdf C:\Reports
node packages/opencode-plugin/dist/cli.js upload "Select file" C:\photos\cat.jpg
```

Useful options: `--tab <id>`, `--json` (machine-readable output), `--timeout <ms>`, and `--yes`, which approves an action the policy flags as sensitive.

`agent "<goal>"` runs the built-in autonomous agent on NVIDIA NIM. It needs `NVIDIA_API_KEY`, and optionally `NVIDIA_BASE_URL`.

### Option D: JSONL over stdio

For agents without MCP, send one JSON request per line:

```powershell
'{"id":1,"method":"tools/list"}' | npm run gateway:jsonl
'{"id":2,"method":"tools/call","params":{"name":"browser_snapshot","arguments":{}}}' | npm run gateway:jsonl

# Full capability manifest
npm run gateway:manifest
```

---

## 🛠️ Browser Tools

The gateway exposes 31 tools. Run `npm run gateway:manifest` for the full schemas. Interaction tools locate elements by role, accessible name, label, text or CSS selector.

| Group | Tools |
| :--- | :--- |
| **Tabs** | `browser_list_tabs`, `browser_new_tab`, `browser_close_tab`, `browser_switch_tab` |
| **Lease** | `browser_attach`, `browser_detach`, `browser_status` |
| **Look** | `browser_snapshot`, `browser_screenshot`, `browser_extract`, `browser_verify` |
| **Navigate** | `browser_navigate` |
| **Interact** | `browser_click`, `browser_dblclick`, `browser_rightclick`, `browser_type`, `browser_keypress`, `browser_scroll`, `browser_select`, `browser_wait` |
| **Files** | `browser_download`, `browser_upload`, `browser_pdf` |
| **Batch** | `browser_run_pipeline` |
| **Run control** | `relay_pause`, `relay_resume`, `relay_stop`, `relay_restart`, `relay_take_over`, `relay_return_control`, `relay_status` |

---

## 🛡️ Security & Privacy

1. **Loopback only:** the broker listens on `127.0.0.1` and rejects any connection without the token. No cloud relay, no telemetry.
2. **Approval policy:** the broker checks every action before it runs. These need approval (`--yes` on the CLI): actions marked irreversible or sensitive, actions whose target text matches sensitive words (checkout, delete and similar), and actions outside the run's allowed origins.
3. **Forbidden URLs:** the broker refuses `chrome://`, `chrome-extension://`, `edge://`, `about:`, `devtools://`, `view-source:` and `javascript:` targets outright.
4. **Page content is untrusted:** DOM text and attributes are returned as data. They are never treated as instructions for the relay.
5. **No credential access:** the extension doesn't read saved passwords, passkeys, cards or OS credentials. 2FA and CAPTCHA prompts are left to you.

Heads-up: the extension requests `<all_urls>` and `debugger` permissions. That is what lets it act on any site you open. See [docs/permissions.md](docs/permissions.md) and [docs/threat-model.md](docs/threat-model.md).

---

## 🩺 Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| `Could not connect to … broker` | Broker not running | Start `target\debug\relay-broker.exe` |
| `rejected the auth token` | Token file and `RELAY_AUTH_TOKEN` disagree | Unset `RELAY_AUTH_TOKEN`, or set it to the contents of `%APPDATA%\opencode-relay\auth-token` |
| `Specified native messaging host not found` | Host not registered, or registered for another extension ID | Re-run `install-host.ps1 -ExtensionId pogdiiiklddnjkdmnhkdbcelighmkjgb`, then reload the extension |
| `tabs` returns nothing | Extension service worker asleep or disconnected | Open the side panel, or click **Reload** on `chrome://extensions` |
| Upload fails with "Allow access to file URLs" | Chrome's file-access toggle is off | `chrome://extensions` → Details → turn on **Allow access to file URLs** |
| Download stalls | Chrome's "Ask where to save each file" is on | Answer the dialog, run `save-dialog`, or turn the setting off |

---

## 🧪 Tests

```powershell
npm test                 # Vitest: unit, security and contract suites
cargo test --workspace   # Rust broker and native host
npm run test:e2e         # Playwright end-to-end
npm run typecheck        # tsc on all packages
npm run lint             # build + clippy + rustfmt check
```

---

## 📂 Repository Structure

```
opencode-chrome-relay/
├── apps/
│   ├── chrome-extension/      # Manifest V3 extension (side panel, overlay, CDP)
│   └── firefox-extension/     # Firefox WebExtension port
├── crates/
│   ├── relay-broker/          # Rust broker (SQLite journal, policy, epoch fencing)
│   └── relay-native-host/     # Native messaging stdio host
├── packages/
│   ├── agent-gateway/         # MCP server and JSONL bridge
│   ├── opencode-plugin/       # OpenCode plugin and browser-relay CLI
│   └── protocol/              # Shared TypeScript types and Zod schemas
├── installer/windows/         # Native host install / uninstall scripts
├── docs/                      # Architecture, permissions, threat model
└── tests/                     # Unit, security, contract and e2e suites
```

---

## 📄 License

[MIT](LICENSE)
