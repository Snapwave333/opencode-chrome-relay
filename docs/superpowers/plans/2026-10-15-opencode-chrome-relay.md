# OpenCode Chrome Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and thoroughly test the complete OpenCode Chrome Relay system according to the Master Design Record (MDR): Rust native messaging host & broker with SQLite journal, Manifest V3 Chrome extension with side panel & Shadow DOM overlay, OpenCode plugin adapter, Windows installer, and complete unit/contract/e2e/security test suite.

**Architecture:** Monorepo with Cargo workspace (`crates/relay-broker`, `crates/relay-native-host`) and npm workspace (`packages/protocol`, `packages/opencode-plugin`, `apps/chrome-extension`). Rust broker enforces durable state, cancellation fencing, tab leases, and policy gates over loopback IPC. Extension connects via Chrome Native Messaging to drive `chrome.debugger` (CDP) and in-page overlays without launching a secondary automation browser. OpenCode plugin exposes 16 semantic browser tools to the agent.

**Tech Stack:** Rust (1.97, tokio, rusqlite, serde, tungstenite/ipc), Node.js (TypeScript, Vite/esbuild/tsx, vitest), Chrome Extensions Manifest V3 (CDP, Side Panel, Shadow DOM), Windows Registry (HKCU NativeMessagingHosts).

---

## File Structure

```text
opencode-chrome-relay/
├── Cargo.toml                              # Rust workspace
├── package.json                            # Root npm workspaces config & scripts
├── tsconfig.base.json                      # Shared TypeScript config
├── .gitignore
├── packages/
│   ├── protocol/                           # Shared schemas, TS types, error codes
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── events.ts
│   │       ├── actions.ts
│   │       ├── controls.ts
│   │       ├── policy.ts
│   │       └── state.ts
│   └── opencode-plugin/                    # OpenCode agent tools adapter
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── client.ts                   # Loopback client to Rust broker
│           ├── tools.ts                    # 16 browser_* tools implementation
│           └── session.ts                  # Session & model binding
├── crates/
│   ├── relay-broker/                       # Local scheduler, SQLite journal, IPC
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── lib.rs
│   │       ├── protocol.rs
│   │       ├── db.rs                       # SQLite durable state & action journal
│   │       ├── state_machine.rs            # Execution states & cancellation fencing
│   │       ├── scheduler.rs                # Action queue, leases & execution
│   │       ├── policy.rs                   # Authorization modes & sensitive ops
│   │       └── server.rs                   # Authenticated loopback WebSocket/IPC
│   └── relay-native-host/                  # Chrome Native Messaging stdio host
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs
│           └── framing.rs                  # 32-bit LE length-prefixed stdio IO
├── apps/
│   └── chrome-extension/                   # Manifest V3 extension
│       ├── package.json
│       ├── tsconfig.json
│       ├── manifest.json
│       ├── icons/                          # Extension icons (SVG/PNG)
│       ├── src/
│       │   ├── background/
│       │   │   ├── index.ts                # MV3 background worker
│       │   │   ├── native_port.ts          # Native messaging bridge
│       │   │   ├── tab_manager.ts          # Tab leases & attach/detach
│       │   │   └── cdp_controller.ts       # chrome.debugger command dispatcher
│       │   ├── browser/
│       │   │   ├── locators.ts             # Semantic locators & coordinate fallback
│       │   │   └── actions.ts              # CDP input synthesis (click, type, etc.)
│       │   ├── content/
│       │   │   ├── index.ts                # Content script entrypoint
│       │   │   ├── overlay.ts              # Isolated Shadow DOM visual overlay
│       │   │   └── dock.ts                 # Floating in-page Pause/Stop/Steer dock
│       │   ├── sidepanel/
│       │   │   ├── index.html
│       │   │   ├── sidepanel.ts            # UI logic, state display, timeline
│       │   │   └── sidepanel.css           # Developer-tool aesthetic (dark/light)
│       │   └── shared/
│       │       └── constants.ts
├── installer/
│   └── windows/
│       ├── com.opencode.chrome_relay.json  # Native host manifest template
│       ├── install-host.ps1                # Per-user HKCU registration script
│       └── uninstall-host.ps1              # Clean uninstaller script
├── tests/
│   ├── contract/
│   │   └── protocol_contract.test.ts       # Protocol envelope & schema validations
│   ├── unit/
│   │   ├── broker_state.rs (in crate)
│   │   ├── broker_db.rs (in crate)
│   │   ├── extension_locators.test.ts
│   │   └── plugin_tools.test.ts
│   ├── e2e/
│   │   └── execution_lifecycle.test.ts     # Pause/Stop/Restart/Steer/TakeOver E2E
│   └── security/
│       ├── prompt_injection.test.ts        # Untrusted page text boundary check
│       └── cancellation_fencing.test.ts    # Stale epoch/lease replay prevention
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   └── permissions.md
└── README.md
```

---

## Tasks

### Task 1: Root Workspaces & Shared Protocol Definition
- [ ] Initialize Cargo workspace and npm workspace root configs.
- [ ] Implement `packages/protocol` with complete TypeScript interfaces, Zod runtime schemas, action types, event envelopes, error codes, and control command schemas.
- [ ] Add contract unit tests for protocol serialization and validation.

### Task 2: Rust Broker Core - DB, State Machine, Policy, and Scheduler
- [ ] Create `crates/relay-broker` with `rusqlite` schema for runs, checkpoints, action journal, tab leases, and audit logs.
- [ ] Implement finite state machine (`DISCONNECTED`, `READY`, `RUNNING`, `PAUSING`, `PAUSED`, `STOPPING`, `STOPPED`, `RESTARTING`, `STEERING`, `MANUAL_TAKEOVER`, `RECOVERY_REQUIRED`).
- [ ] Implement cancellation fencing with monotonic `epoch`, `sequence`, and `idempotency_key`.
- [ ] Implement policy engine (Inspect, Assist, Autopilot, sensitive operation confirmation gate).
- [ ] Implement action scheduler with lease tracking and verification callbacks.
- [ ] Write Rust unit tests covering state transitions, epoch fencing, idempotency, and SQLite journaling.

### Task 3: Rust Broker Loopback IPC & Native Messaging Host
- [ ] Implement authenticated loopback WebSocket/IPC server in `crates/relay-broker` with bearer token auth.
- [ ] Implement `crates/relay-native-host` with 32-bit length-prefixed Chrome Native Messaging stdio framing.
- [ ] Bridge native host stdio to local broker IPC.
- [ ] Add unit tests for stdio framing and IPC message relay.

### Task 4: OpenCode TypeScript Plugin Adapter
- [ ] Implement `packages/opencode-plugin` with `@opencode-ai/plugin` compatible tool registration.
- [ ] Implement client connection to the Rust broker loopback service.
- [ ] Implement the 16 required browser tools (`browser_list_tabs`, `browser_attach`, `browser_snapshot`, `browser_screenshot`, `browser_navigate`, `browser_click`, `browser_type`, `browser_keypress`, `browser_scroll`, `browser_select`, `browser_wait`, `browser_extract`, `browser_download`, `browser_verify`, `browser_detach`, `browser_status`).
- [ ] Add unit tests for tool dispatching and error handling.

### Task 5: Chrome Extension MV3 - Background, CDP, Overlay, and Side Panel
- [ ] Configure `apps/chrome-extension/manifest.json` for MV3 (side panel, debugger, scripting, nativeMessaging, activeTab).
- [ ] Implement `background/index.ts` and `cdp_controller.ts` for Chrome debugger attachment and native port relay.
- [ ] Implement `browser/locators.ts` for accessible role + name, stable attribute locators, and coordinate fallback.
- [ ] Implement `content/overlay.ts` using isolated Shadow DOM for inspecting outlines, click pulse, typing borders, and action captions.
- [ ] Implement `content/dock.ts` for the optional in-page floating control dock.
- [ ] Implement `sidepanel/` HTML/TS/CSS with the quiet developer-tool aesthetic (cyan accent, magenta steer, session binding, live action timeline, [PAUSE], [STOP], [RESTART], [STEER], [TAKE OVER] buttons).
- [ ] Add unit tests for locator resolution and overlay event dispatch.

### Task 6: Windows Native Host Installer Scripts
- [ ] Create `installer/windows/com.opencode.chrome_relay.json` host manifest template.
- [ ] Implement PowerShell `install-host.ps1` registering `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome_relay` and setting `allowed_origins`.
- [ ] Implement PowerShell `uninstall-host.ps1` to cleanly remove registry keys and manifests.

### Task 7: Comprehensive Test Suite & Verification
- [ ] Protocol contract tests (`tests/contract/protocol_contract.test.ts`).
- [ ] End-to-end execution lifecycle test (`tests/e2e/execution_lifecycle.test.ts`) validating Pause -> Resume, Stop -> Abort, Steer, Restart with re-verification, Take Over -> Return Control.
- [ ] Adversarial and security test (`tests/security/cancellation_fencing.test.ts` & `tests/security/prompt_injection.test.ts`) validating untrusted page prompt injection containment and stale epoch rejection.
- [ ] Execute `cargo test --all` and `npm test` across all crates and packages. Verify 100% passing tests.

### Task 8: Documentation & Quality Review
- [ ] Create `docs/architecture.md`, `docs/threat-model.md`, and `docs/permissions.md`.
- [ ] Create comprehensive `README.md` with Windows installation instructions, architecture overview, and usage guide.
