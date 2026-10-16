# OpenCode Chrome Relay — Material 3 Expressive UI/UX Redesign Specification

**Date:** 2026-10-15  
**Status:** Approved  
**Aesthetic:** Material 3 Expressive (Deep Cyan & Electric Sapphire Tonal Palette)

---

## 1. Overview & Goals
Elevate OpenCode Chrome Relay's visual identity, usability, and feedback fidelity by transitioning from raw terminal styling to the official **Google Material 3 Expressive Design System**. This encompasses the Extension Sidepanel Cockpit, the in-page HUD Action Overlay, and the floating in-page control Dock.

### Key Objectives
1. **Material 3 Token Architecture:** Standardize on `--md-sys-color-*` and `--md-sys-elevation-*` variables with dynamic tonal relationships.
2. **Deep Cyan & Electric Sapphire Palette:** Primary electric cyan (`#80d5e8`), secondary steel slate (`#b1cbd1`), tertiary magenta/coral (`#ffb0ca`) for steering, and obsidian surface containers.
3. **M3 Component Refinement:**
   * **Sidepanel:** Segmented pill tabs with active sliding pills, elevated rounded timeline cards (16px radii), pill status badges, and M3 FAB-style primary controls.
   * **In-Page Dock:** Glassmorphic extended Floating Action Bar (`backdrop-filter: blur(16px)`), tonal buttons, dismiss affordance.
   * **In-Page HUD:** Elevation-3 pill action badges with Material 3 vector icons, localized radial click ripples, directional edge scroll indicators, and laser inspection sweep.
4. **Motion & Feedback:** Spring-based transitions (`cubic-bezier(0.05, 0.7, 0.1, 1)` and `cubic-bezier(0.2, 0, 0, 1)`), subtle pulsing state indicators for NVIDIA NIM models, and zero visual clutter.

---

## 2. Design System & Tokens

### 2.1 Color Tokens (Dark Theme Base)
```css
:root {
  /* Primary (Electric Cyan) */
  --md-sys-color-primary: #80d5e8;
  --md-sys-color-on-primary: #00363f;
  --md-sys-color-primary-container: #004e5b;
  --md-sys-color-on-primary-container: #9eeffd;

  /* Secondary (Steel Sapphire / Slate) */
  --md-sys-color-secondary: #b1cbd1;
  --md-sys-color-on-secondary: #1c3439;
  --md-sys-color-secondary-container: #334a50;
  --md-sys-color-on-secondary-container: #cde7ee;

  /* Tertiary (Steering / Human Action) */
  --md-sys-color-tertiary: #ffb0ca;
  --md-sys-color-on-tertiary: #541d32;
  --md-sys-color-tertiary-container: #6f3349;
  --md-sys-color-on-tertiary-container: #ffd9e3;

  /* Surfaces & Containers */
  --md-sys-color-surface: #0f1416;
  --md-sys-color-surface-dim: #0a0e0f;
  --md-sys-color-surface-bright: #353b3d;
  --md-sys-color-surface-container-lowest: #0b0f10;
  --md-sys-color-surface-container-low: #171d20;
  --md-sys-color-surface-container: #1b2225;
  --md-sys-color-surface-container-high: #21292c;
  --md-sys-color-surface-container-highest: #2b3438;

  /* Typography & Text */
  --md-sys-color-on-surface: #deeaed;
  --md-sys-color-on-surface-variant: #bfc8cb;
  --md-sys-color-outline: #899396;
  --md-sys-color-outline-variant: rgba(137, 147, 150, 0.22);

  /* Status Tokens */
  --md-sys-color-error: #ffb4ab;
  --md-sys-color-error-container: #93000a;
  --md-sys-color-on-error: #690005;
  --md-sys-color-success: #7cd992;
  --md-sys-color-success-container: #005322;
  --md-sys-color-on-success: #003915;
}
```

### 2.2 Elevations & Shadows
* **Level 1 (Cards):** `box-shadow: 0 1px 3px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.25)`
* **Level 2 (Active elements, headers, dialogs):** `box-shadow: 0 4px 14px rgba(0,0,0,0.45), 0 0 1px rgba(128,213,232,0.2)`
* **Level 3 (Floating HUD, In-page Dock):** `box-shadow: 0 8px 28px rgba(0,0,0,0.6), 0 0 16px rgba(128,213,232,0.25)`

### 2.3 Typography & Shapes
* **Font Family:** `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
* **Monospace Stack (code, telemetry):** `"Fira Code", "SFMono-Regular", Consolas, monospace`
* **Shapes:**
  * Pill / Circular: `border-radius: 9999px`
  * Large Card: `border-radius: 16px`
  * Medium Element: `border-radius: 12px`
  * Small Chip: `border-radius: 8px`

---

## 3. Sidepanel Cockpit UI Architecture

### 3.1 Header Bar
* Elevated `surface-container-low` with subtle bottom outline.
* **Logo Title:** Refined typography with cyan terminal bolt glyph.
* **Bridge Status Chip:** M3 Tonal Assist chip with pulsing indicator (`● Connected`).
* **Model Badge:** M3 Filter chip displaying `NVIDIA NIM (llama-3.3-70b-instruct)` with subtle green cooldown readiness dot.

### 3.2 Session Tabs Bar
* Replaces plain text buttons with an M3 **Segmented Pill Container**.
* **Active Tab:** Filled with `primary-container` and `on-primary-container` color, pill rounded.
* **Inactive Tabs:** Subtle `surface-container-high` hover transitions.
* **Pin Badge:** Compact Material 3 `push_pin` icon inline with tab title.
* **Add Session Button:** M3 circular / rounded chip `+ New`.

### 3.3 Active Session Meta Bar
* **Session Details:** Tab status pill chip, pin status tag (`Pinned` / `Unpinned`), verified action count chip.
* **Quick Actions:** M3 Outlined / Tonal micro-buttons for Pin, Delete, and Attach Tab.

### 3.4 Timeline & Action Stream
* **User Entry:** M3 Surface card with subtle right alignment accent.
* **Agent Entry:** Tonal `surface-container` card with role badge and clean typography.
* **Live Action Card:** Elevated `surface-container-high` card with glowing cyan accent edge, live action telemetry text, and Material 3 vector status indicators.

### 3.5 Primary Control Deck
* **PAUSE:** M3 Tonal Button with yellow/amber tint and `pause` icon.
* **STOP:** M3 Outlined Danger Button with red tint and `stop` icon.
* **RESTART:** M3 Outlined Button with `refresh` icon.
* **STEER Input Bar:** Integrated pill container with text input and filled M3 FAB-style **SEND** button in tertiary magenta/coral (`--md-sys-color-tertiary-container`).

---

## 4. In-Page HUD Overlay & Floating Dock

### 4.1 In-Page Action Overlay (`overlay.ts`)
* **Highlight Box:** Smooth bounding box with `--md-sys-color-primary` glow, 6px border radius, and verified/failed transition pulses.
* **Caption Badge:** Material 3 pill chip (`border-radius: 9999px`) with drop shadow, containing icon + text (e.g., `touch_app Click #submit-btn`, `edit Type: ••••••••`).
* **Laser Sweep Line:** Soft horizontal gradient line traversing the element during vision / inspection.
* **Click Ripple:** Radial gradient shockwave with M3 easing.
* **Scroll Indicator:** Floating pill marker at the window edge with directional arrow and pixel distance.

### 4.2 In-Page Floating Dock (`dock.ts`)
* **Container:** Floating bottom center dock styled as an **Extended Floating Action Bar** with `backdrop-filter: blur(16px)` and tonal border.
* **Buttons:** Tonal M3 pill buttons with Material 3 SVG vector icons (`pause`, `stop`, `send`, `close`).

---

## 5. Verification & Testing
* **Playwright E2E Tests:**
  * `tests/e2e/playwright/sidepanel.spec.ts`: Verify all M3 tokens, classes, controls, tabs, and steering.
  * `tests/e2e/playwright/overlay_and_dock.spec.ts`: Verify M3 pill styling, ripple, typing mask, and dock interaction.
  * `tests/e2e/playwright/extension_browser.spec.ts`: Verify full extension load and interactive page behavior.
* **Linting & Typecheck:**
  * `npm run lint` (TypeScript strict check, cargo clippy, cargo fmt).
  * `npm test` (vitest unit and contract suites).
