# Permissions Policy — OpenCode Chrome Relay

## 1. Extension Permissions

- **`sidePanel`**: Renders the agent cockpit beside the active browser tab.
- **`debugger`**: Attaches to authorized user tabs via Chrome DevTools Protocol (CDP) for input synthesis (mouse click, keyboard events, navigation, screenshots) without creating a separate automation browser.
- **`nativeMessaging`**: Communicates with the local Rust native host executable (`com.opencode.chrome_relay`).
- **`storage`**: Persists local user UI preferences (theme, dock visibility, recent sessions).
- **`activeTab` / `tabs`**: Scopes actions to user-attached tabs only.
- **`scripting`**: Manages the isolated in-page Shadow DOM overlay.

## 2. Authorization Modes

| Mode | Allowed Actions | Approval Requirements |
| :--- | :--- | :--- |
| **Inspect** | Read-only DOM snapshots, element search, accessibility trees, opt-in screenshot. | All mutations (clicks, navigation, typing) require user confirmation. |
| **Assist** | Navigation, drafting text, scrolling, non-sensitive form fields. | External effects (form submission, payment buttons, deleting items) require confirmation. |
| **Autopilot** | Permitted low-risk tasks within designated origin scope. | Sensitive actions (purchases, destructive deletions, public posts, security settings) always require confirmation. |

## 3. Restricted Targets

The following targets are strictly denied:
- `chrome://*`
- `chrome-extension://*` (of other extensions)
- `edge://*`
- `about:*`
- Protected browser internal dialogs
