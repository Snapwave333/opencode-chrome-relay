# Architecture Overview — OpenCode Chrome Relay

## 1. System Topology

```text
                       EXISTING PERSONAL CHROME
+---------------------------------------------------------------+
| Side Panel UI           | In-Page Action Overlay              |
| - session/chat          | - target outline / click indicator  |
| - timeline / approvals  | - action captions / state badge     |
| - PAUSE STOP RESTART    | - optional compact control dock     |
| - STEER / TAKE OVER     | - passive, pointer-events: none     |
+------------------------+--------------------------------------+
               | chrome.runtime messaging
               v
| Manifest V3 service worker: scoped tabs, actions, CDP/DOM,     |
| screenshot capture, overlay coordination, native host port    |
               | chrome.runtime.connectNative()
               v
+---------------------------------------------------------------+
| Rust Native Messaging Host -> Local Rust Broker/Run Scheduler |
| - secure per-user IPC / loopback with authorization           |
| - durable run state + action journal + cancellation gate      |
| - tab leases, approval policies, event routing, recovery      |
+---------------------------------------------------------------+
               | authenticated loopback channel
               v
+---------------------------------------------------------------+
| OpenCode TypeScript Plugin + OpenCode SDK / Server Adapter    |
| - browser tools available to the agent                        |
| - prompts from side panel, session binding, model reuse       |
| - session events, stream output, aborts, steering             |
+---------------------------------------------------------------+
               | existing OpenCode provider credentials
               v
                  USER'S CONFIGURED LLM
```

## 2. Component Directory

- **`packages/protocol`**: Protocol envelopes, execution states, 16 browser tool schemas, control command schemas, and policy evaluation rules.
- **`crates/relay-broker`**: Local Rust broker with SQLite durable state (`runs`, `action_journal`, `checkpoints`, `tab_leases`, `approvals`), state machine with cancellation fencing, tab lease manager, and authenticated WebSocket server.
- **`crates/relay-native-host`**: Chrome Native Messaging stdio host executable communicating with the browser via 32-bit length-prefixed framing and relaying to the broker over loopback.
- **`packages/opencode-plugin`**: OpenCode adapter exporting the 16 `browser_*` tools, binding session/model context, and dispatching tool requests to the broker.
- **`apps/chrome-extension`**: Manifest V3 extension featuring Side Panel cockpit, isolated Shadow DOM in-page overlay and control dock, CDP debugger controller, and semantic DOM locators.
- **`installer/windows`**: Manifest template and PowerShell install/uninstall scripts registering `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome_relay`.
