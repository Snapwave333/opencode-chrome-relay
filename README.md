# OpenCode Chrome Relay

Browser-native agent cockpit and provider-neutral agent gateway for controlling your personal Chrome profile. No secondary Playwright browser, no separate profile, and no duplicate provider keys.

## Features

- **Personal Profile Binding**: Operates the existing authenticated tabs and visible browser window.
- **Model Key Isolation**: Reuses your configured OpenCode provider credentials without exposing them to Chrome.
- **Enforced Execution Controls**: Guaranteed **PAUSE**, **STOP**, **RESTART**, **STEER**, and **MANUAL TAKE OVER** semantics with monotonic epoch cancellation fencing.
- **In-Page Action Overlay**: Target soft-outlines, click pulses, typing captions, and state badges in an isolated Shadow DOM.
- **Durable Action Journal**: SQLite-backed audit log, tab lease management, and idempotency protection against duplicate replays.
- **17 Browser Tools**: Full suite of semantic locator tools (`browser_click`, `browser_type`, `browser_snapshot`, `browser_navigate`, `browser_wait`, etc.).
- **Global Agent Gateway**: MCP and JSONL transports let any compatible AI agent use the same authorized browser-control pipeline.
- **Pipeline Execution**: Run up to 25 ordered browser operations with correlated results and configurable fail-fast behavior.

---

## Architecture

- **`apps/chrome-extension`**: Manifest V3 extension with Side Panel cockpit and Shadow DOM overlays.
- **`crates/relay-broker`**: Rust scheduler, SQLite journal, cancellation gate, and authenticated loopback IPC.
- **`crates/relay-native-host`**: Native Messaging stdio host connecting Chrome to the broker.
- **`packages/opencode-plugin`**: OpenCode plugin exporting the 17 browser tools.
- **`packages/agent-gateway`**: Provider-neutral MCP server, JSONL bridge, capability manifest, execution controls, and pipeline runner.
- **`packages/protocol`**: Shared TypeScript types and Zod schemas.
- **`installer/windows`**: Windows installer scripts for Native Messaging registration.

---

## Build & Test Instructions

### Prerequisites
- Node.js (v20+) & npm
- Rust (v1.75+) & Cargo
- Windows 11 with Google Chrome

### 1. Build Rust Crates
```powershell
cargo build --workspace
cargo test --workspace
```

### 2. Build TypeScript Packages & Extension
```powershell
npm install
npm run build
npm test
```

### 3. Register Chrome Native Messaging Host (Windows)
```powershell
powershell -ExecutionPolicy Bypass -File .\installer\windows\install-host.ps1 -ExtensionId "<YOUR_EXTENSION_ID>"
```

### 4. Load Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `apps/chrome-extension` directory.
4. Open the Side Panel to view the OpenCode Relay cockpit.

### 5. Run OpenCode with Plugin
In your OpenCode environment or project:
```bash
opencode --plugin ./packages/opencode-plugin
```

## Global agent gateway

Build the repository, start the broker and extension, then point any MCP-capable agent at the gateway:

```json
{
  "mcpServers": {
    "relay-browser": {
      "command": "node",
      "args": ["C:\\Users\\chrom\\Desktop\\opencoderealy\\packages\\agent-gateway\\dist\\index.js"],
      "env": {
        "RELAY_BROKER_URL": "ws://127.0.0.1:4098",
        "RELAY_AUTH_TOKEN": "<your-local-relay-token>"
      }
    }
  }
}
```

Agents without MCP can use newline-delimited JSON:

```powershell
'{"id":1,"method":"tools/list"}' | npm run gateway:jsonl
'{"id":2,"method":"tools/call","params":{"name":"browser_snapshot","arguments":{}}}' | npm run gateway:jsonl
```

Print the complete machine-readable capability manifest:

```powershell
npm run gateway:manifest
```

`browser_run_pipeline` accepts up to 25 ordered steps and returns a correlated result for each step. The gateway retains the relay's tab authorization, approval, cancellation, idempotency, and audit boundaries.
