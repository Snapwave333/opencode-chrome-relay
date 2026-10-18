# 🌐 OpenCode Chrome Relay

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75+-black.svg?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-green.svg?style=for-the-badge&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-purple.svg?style=for-the-badge)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/Platform-Windows_11-0078D4.svg?style=for-the-badge&logo=windows)](installer/windows/)

<p align="center">
  <strong>Browser-native agent cockpit and provider-neutral gateway for controlling your personal Chrome profile with AI agents.</strong>
</p>

<p align="center">
  <em>No secondary Playwright browsers. No throwaway sandboxed profiles. No duplicate API keys. No bot-detection lockouts.</em>
</p>

[Key Features](#-key-features) • [Architecture](#-architecture) • [Quickstart](#-quickstart) • [Agent Integration](#-agent-integration) • [Tools Reference](#-19-browser-tools) • [Security](#-security--privacy)

---

</div>

## 💡 Why OpenCode Chrome Relay?

Traditional browser automation frameworks (Puppeteer, Playwright, Selenium) launch isolated, freshly minted browser instances. While great for integration testing, they fail for real-world personal assistant workflows:

* ❌ **Login Lockout:** Websites immediately detect headless automation, forcing CAPTCHAs and 2FA challenges.
* ❌ **Credential Exposure:** API keys and credentials are leaked into the browser sandbox or web scripts.
* ❌ **Lack of Control:** If an agent gets stuck in a loop, you can only terminate the process abruptly.
* ❌ **Blind Execution:** You cannot see which element the agent is examining or interacting with until it is too late.

**OpenCode Chrome Relay changes the paradigm:**

| Capability | Traditional Automation (Playwright / Puppeteer) | OpenCode Chrome Relay |
| :--- | :--- | :--- |
| **Browser Identity** | Separate disposable profile; logged-out | **Your actual, active, logged-in Chrome profile** |
| **Authentication & Cookies** | Requires exporting session cookies or logging in | **Seamless reuse of active sessions, passkeys & tokens** |
| **Credential Security** | Keys embedded or passed to browser context | **Zero LLM key leakage; model keys isolated in agent** |
| **Execution Control** | Abrupt process SIGKILL | **Monotonic epoch cancellation: PAUSE, STOP, RESTART, STEER** |
| **Visual Feedback** | Invisible headless runs or clunky debug windows | **Shadow DOM in-page HUD: soft outlines, ripples & captions** |
| **Auditability** | Ephemeral console logs | **Durable SQLite journal with lease locking & idempotency** |
| **Agent Interoperability** | Vendor-locked proprietary drivers | **Standard MCP Server, JSONL stdio, & OpenCode Plugin** |

---

## ⚡ Key Features

* 🔐 **Personal Profile Binding**  
  Directly operates tabs within your authenticated browser window. Works seamlessly with Gmail, GitHub, AWS Console, Figma, internal enterprise portals, and social media platforms without triggering bot detections.

* 🛡️ **Model Key Isolation**  
  Reuses your configured OpenCode / Anthropic / OpenAI / local model credentials within your agent's runtime. The Chrome extension and browser pages *never* see, receive, or store your provider keys.

* 🛑 **Enforced Execution Controls**  
  Guaranteed **PAUSE**, **STOP**, **RESTART**, **STEER**, and **MANUAL TAKEOVER** semantics backed by Rust monotonic epoch fencing. When you pause or cancel, any in-flight actions are immediately discarded.

* 🎯 **In-Page Visual Overlays**  
  Zero-dependency, non-invasive Shadow DOM action overlay:
  * Soft element target outlines
  * Ripple click indicators
  * Real-time typing captions
  * Passive pointer-events isolation ensuring zero interference with normal browsing

* 📜 **Durable Action Journal & Leases**  
  A local SQLite-backed audit log keeps track of every tab lease, run state, and element interaction, enforcing strict idempotency so non-idempotent actions are never replayed upon network reconnection.

* 🔌 **Universal Agent Gateway**  
  First-class support for the **Model Context Protocol (MCP)** and newline-delimited JSON (JSONL). Connect Claude Desktop, Antigravity, Cursor, OpenCode, or your own custom agent scripts instantly.

* 🚀 **Correlated Multi-Step Pipelines**  
  Execute up to 25 ordered browser steps in a single atomic payload using `browser_run_pipeline` with configurable fail-fast behavior and correlated per-step telemetry.

---

## 🏗️ Architecture

```
                       EXISTING PERSONAL CHROME
+-------------------------------------------------------------------+
| Side Panel Cockpit          | In-Page Action Overlay (Shadow DOM) |
| - session & timeline        | - target outlines / click pulses    |
| - PAUSE / STOP / RESTART    | - live typing captions / badges     |
| - STEER / MANUAL TAKE OVER  | - pointer-events: none (passive)    |
+-------------------------------------------------------------------+
                   | chrome.runtime messaging
                   v
| Manifest V3 Service Worker: scoped tabs, DOM locators, CDP        |
| screenshot capture, overlay coordination, native host port        |
+-------------------------------------------------------------------+
                   | chrome.runtime.connectNative()
                   v
+-------------------------------------------------------------------+
| Rust Native Messaging Host (`relay-native-host`)                  |
+-------------------------------------------------------------------+
                   | Named Pipes / Loopback IPC
                   v
+-------------------------------------------------------------------+
| Rust Local Broker Daemon (`relay-broker`)                         |
| - SQLite action journal & tab lease manager                       |
| - Monotonic epoch cancellation fencing                            |
| - WebSocket / IPC loopback server (ws://127.0.0.1:4098)           |
+-------------------------------------------------------------------+
                   | Authenticated Loopback
                   v
+-------------------------------------------------------------------+
| OpenCode TypeScript Plugin & Universal Agent Gateway              |
| - MCP Server (`@opencode/relay-agent-gateway`)                    |
| - JSONL stdio bridge & `browser-relay` CLI                        |
| - 19 Semantic browser automation tools                            |
+-------------------------------------------------------------------+
                   |
                   v
+-------------------------------------------------------------------+
| ANY AI AGENT: OpenCode | Claude Desktop | Antigravity | Cursor    |
+-------------------------------------------------------------------+
```

---

## 🚀 Quickstart

### Prerequisites

* **OS:** Windows 11 / 10
* **Browser:** Google Chrome (v120+)
* **Runtimes:** [Node.js](https://nodejs.org/) (v20+) & [Rust](https://rustup.rs/) (v1.75+)

### 1. Clone & Build

```powershell
# Clone the repository
git clone https://github.com/Snapwave333/opencode-chrome-relay.git
cd opencode-chrome-relay

# Build TypeScript packages & Extension
npm install
npm run build

# Build Rust crates
cargo build --workspace --release
```

### 2. Register Chrome Native Messaging Host

Register the native host with Chrome using the automated setup script:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_icons_and_registration.ps1
```

*(Alternatively, run `powershell -ExecutionPolicy Bypass -File .\installer\windows\install-host.ps1 -ExtensionId "<YOUR_EXTENSION_ID>"`).*

### 3. Load the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the folder:
   `apps/chrome-extension`
4. Pin the **OpenCode Chrome Relay** icon to your toolbar and open the Chrome Side Panel.

---

## 🤖 Agent Integration

### Option A: Model Context Protocol (MCP)

Add the relay gateway to your agent's MCP configuration (e.g. `claude_desktop_config.json` or Antigravity / Cursor settings):

```json
{
  "mcpServers": {
    "relay-browser": {
      "command": "node",
      "args": [
        "C:\\Users\\chrom\\Desktop\\opencoderealy\\packages\\agent-gateway\\dist\\index.js"
      ],
      "env": {
        "RELAY_BROKER_URL": "ws://127.0.0.1:4098",
        "RELAY_AUTH_TOKEN": "local-dev-token"
      }
    }
  }
}
```

### Option B: OpenCode CLI Plugin

Run OpenCode with the relay plugin loaded directly:

```bash
opencode --plugin ./packages/opencode-plugin
```

### Option C: Universal CLI (`browser-relay` / `oc-relay`)

Use the built-in CLI for ad-hoc browser inspections or shell scripting:

```powershell
# List all active browser tabs
node packages/opencode-plugin/dist/cli.js list-tabs

# Take an accessibility & DOM snapshot
node packages/opencode-plugin/dist/cli.js snapshot --tab-id 123456

# Click an element using semantic accessibility locators
node packages/opencode-plugin/dist/cli.js click --role "button" --name "Save preferences"

# Type into a labeled field
node packages/opencode-plugin/dist/cli.js type --label "Search documentation" --text "Monotonic epoch fencing"
```

### Option D: JSONL Stdio Transport

For agents without native MCP support, stream newline-delimited JSON commands:

```powershell
# List available tools
'{"id":1,"method":"tools/list"}' | npm run gateway:jsonl

# Capture snapshot
'{"id":2,"method":"tools/call","params":{"name":"browser_snapshot","arguments":{}}}' | npm run gateway:jsonl

# Inspect full capability manifest
npm run gateway:manifest
```

---

## 🛠️ 19 Browser Tools

Every tool operates with semantic locators (accessible role, name, label, text) before falling back to re-validated viewport coordinates:

| Tool | Category | Description |
| :--- | :--- | :--- |
| `browser_list_tabs` | Session | List open tabs with titles, URLs, active status, and lease state. |
| `browser_attach` | Lease | Attach agent lease to a specific tab and origin scope. |
| `browser_detach` | Lease | Release tab lease and restore neutral status. |
| `browser_snapshot` | Perception | Capture semantic accessibility tree and interactive DOM map. |
| `browser_screenshot` | Perception | Capture full-page or viewport CDP screenshot. |
| `browser_navigate` | Navigation | Navigate tab to a given URL with history verification. |
| `browser_click` | Interaction | Click elements using role, name, label, or verified coordinates. |
| `browser_type` | Interaction | Type text into input fields, textareas, or contenteditables. |
| `browser_keypress` | Interaction | Send keyboard keypresses (`Enter`, `Escape`, `Tab`, shortcuts). |
| `browser_scroll` | Interaction | Scroll vertically or horizontally by pixels or to elements. |
| `browser_select` | Interaction | Select options in native dropdowns or custom select menus. |
| `browser_wait` | Synchronization | Wait for selector presence, URL change, or network idle. |
| `browser_extract` | Extraction | Extract structured table data, text, or HTML attributes. |
| `browser_download` | Filesystem | Trigger user-approved file download with integrity checks. |
| `browser_dialog_dismiss` | OS Native | Inspect and dismiss native browser/OS save dialogs. |
| `browser_verify` | Verification | Assert element text, state, or presence on page. |
| `browser_status` | Telemetry | Retrieve current tab lease, broker epoch, and execution state. |
| `browser_run_pipeline` | Batch Execution | Run up to 25 ordered steps with correlated telemetry & fail-fast. |
| `browser_control` | Governance | Issue runtime control signals (`pause`, `resume`, `stop`, `takeover`). |

---

## 🛡️ Security & Privacy

OpenCode Chrome Relay is engineered from the ground up around strict local-first security boundaries:

1. **Untrusted Page Content:** Page DOM, attributes, and text are treated as strictly untrusted inputs. They cannot alter the agent's governing system prompt or escalate privileges.
2. **Origin Fencing:** Explicitly refuses attachment to `chrome://`, `chrome-extension://`, and protected internal browser spaces.
3. **Sensitive Data Protection:** The extension never inspects or exports stored passwords, passkeys, credit cards, or OS credentials. Authentication challenges (2FA, CAPTCHA) are delegated to the user.
4. **Zero Cloud Brokerage:** All broker IPC occurs strictly over loopback (`127.0.0.1` / named pipes) authenticated via local tokens. No third-party relays or telemetry servers.

---

## 🧪 Testing & Verification

The test suite covers unit logic, security fences, protocol contracts, and end-to-end execution:

```powershell
# Run Vitest test suite (12 test suites, 43+ tests)
npm test

# Run Rust broker & host tests
cargo test --workspace

# Run Playwright end-to-end tests
npm run test:e2e
```

---

## 📂 Repository Structure

```
opencode-chrome-relay/
├── apps/
│   └── chrome-extension/      # Manifest V3 extension (Side Panel, Content Overlay, CDP)
├── crates/
│   ├── relay-broker/          # Rust broker daemon (SQLite journal, epoch cancellation)
│   └── relay-native-host/     # Chrome Native Messaging stdio host executable
├── packages/
│   ├── agent-gateway/         # Provider-neutral MCP Server & JSONL bridge
│   ├── opencode-plugin/       # OpenCode CLI plugin & browser-relay CLI
│   └── protocol/              # Shared TypeScript interfaces & Zod schemas
├── installer/
│   └── windows/               # Windows native messaging host manifests & registry scripts
├── docs/                      # Master Design Record & detailed architecture specs
└── tests/                     # Unit, security, and contract test suites
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
