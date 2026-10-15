# OpenCode Chrome Relay

Browser-native agent cockpit pairing your personal Chrome profile with OpenCode. No secondary Playwright browser, no separate profile, no duplicate provider keys.

## Features

- **Personal Profile Binding**: Operates the existing authenticated tabs and visible browser window.
- **Model Key Isolation**: Reuses your configured OpenCode provider credentials without exposing them to Chrome.
- **Enforced Execution Controls**: Guaranteed **PAUSE**, **STOP**, **RESTART**, **STEER**, and **MANUAL TAKE OVER** semantics with monotonic epoch cancellation fencing.
- **In-Page Action Overlay**: Target soft-outlines, click pulses, typing captions, and state badges in an isolated Shadow DOM.
- **Durable Action Journal**: SQLite-backed audit log, tab lease management, and idempotency protection against duplicate replays.
- **16 Browser Tools**: Full suite of semantic locator tools (`browser_click`, `browser_type`, `browser_snapshot`, `browser_navigate`, `browser_wait`, etc.).

---

## Architecture

- **`apps/chrome-extension`**: Manifest V3 extension with Side Panel cockpit and Shadow DOM overlays.
- **`crates/relay-broker`**: Rust scheduler, SQLite journal, cancellation gate, and authenticated loopback IPC.
- **`crates/relay-native-host`**: Native Messaging stdio host connecting Chrome to the broker.
- **`packages/opencode-plugin`**: OpenCode plugin exporting the 16 browser tools.
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
