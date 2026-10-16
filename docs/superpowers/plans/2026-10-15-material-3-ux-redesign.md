# Material 3 Expressive UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the visual identity and user interface of OpenCode Chrome Relay into a premier Google Material 3 Expressive experience across the Sidepanel Cockpit, in-page HUD Action Overlay, and in-page Floating Dock.

**Architecture:** Implement official Material 3 tonal color tokens and elevation levels across all extension UI surfaces. Restyle the sidepanel with M3 segmented pill session tabs, elevated surface container cards, and FAB-style primary controls. Modernize in-page action feedback with elevation-3 pill badges, smooth spring transitions, and a glassmorphic extended floating action bar.

**Tech Stack:** TypeScript, CSS3 custom properties (`--md-sys-color-*`), Material Design 3 SVG vector icons, Playwright E2E, Vitest.

---

### Task 1: Update Shared Constants & M3 Design Tokens

**Files:**
- Modify: `apps/chrome-extension/src/shared/constants.ts`
- Test: `tests/unit/extension_locators.test.ts`

- [ ] **Step 1: Update `constants.ts` with M3 Tonal Palette**
Add `--md-sys-color-*` tokens and `M3_COLORS` mapping in `apps/chrome-extension/src/shared/constants.ts`:
```typescript
export const M3_COLORS = {
  primary: "#80d5e8",
  onPrimary: "#00363f",
  primaryContainer: "#004e5b",
  onPrimaryContainer: "#9eeffd",
  secondary: "#b1cbd1",
  onSecondary: "#1c3439",
  secondaryContainer: "#334a50",
  onSecondaryContainer: "#cde7ee",
  tertiary: "#ffb0ca",
  onTertiary: "#541d32",
  tertiaryContainer: "#6f3349",
  onTertiaryContainer: "#ffd9e3",
  surface: "#0f1416",
  surfaceContainerLowest: "#0b0f10",
  surfaceContainerLow: "#171d20",
  surfaceContainer: "#1b2225",
  surfaceContainerHigh: "#21292c",
  surfaceContainerHighest: "#2b3438",
  onSurface: "#deeaed",
  onSurfaceVariant: "#bfc8cb",
  outline: "#899396",
  outlineVariant: "rgba(137, 147, 150, 0.22)",
  error: "#ffb4ab",
  errorContainer: "#93000a",
  onError: "#690005",
  success: "#7cd992",
  successContainer: "#005322",
  onSuccess: "#003915",
} as const;
```

- [ ] **Step 2: Run unit tests to verify no regressions**
Run: `npm test`
Expected: 29 passed

- [ ] **Step 3: Commit**
```bash
git add apps/chrome-extension/src/shared/constants.ts
git commit -m "feat(ui): add Material 3 tonal design tokens to shared constants"
```

---

### Task 2: Overhaul Sidepanel Cockpit with Material 3 Expressive CSS

**Files:**
- Modify: `apps/chrome-extension/src/sidepanel/sidepanel.css`
- Modify: `apps/chrome-extension/src/sidepanel/index.html`
- Modify: `apps/chrome-extension/src/sidepanel/sidepanel.ts`
- Test: `tests/e2e/playwright/sidepanel.spec.ts`

- [ ] **Step 1: Write updated M3 styles in `sidepanel.css`**
Implement full M3 Expressive styling:
- Root variables (`--md-sys-color-*`, `--md-sys-elevation-*`, `--md-sys-shape-*`)
- Elevated `surface-container-low` header with Assist chip status badge
- M3 Segmented Pill container for Session Tabs with sliding indicator
- Tonal metadata bar with rounded pill chips
- 16px radius elevated `surface-container` cards for timeline chat entries
- Live action card with glowing cyan accent edge and rich telemetry
- M3 Filled, Tonal, and Outlined buttons with FAB-style Steer Send button

- [ ] **Step 2: Update `sidepanel.ts` to output M3 chip markup and active pill state**
Ensure dynamic tab buttons render with `.m3-tab-chip` and Material 3 vector pin icons.

- [ ] **Step 3: Build extension and run Playwright sidepanel tests**
Run: `npm run build && npx playwright test tests/e2e/playwright/sidepanel.spec.ts`
Expected: 5 passed

- [ ] **Step 4: Commit**
```bash
git add apps/chrome-extension/src/sidepanel/
git commit -m "feat(ui): restyle sidepanel cockpit with Material 3 Expressive theme"
```

---

### Task 3: Elevate In-Page Action Overlay with M3 Pill Badges & Spring Physics

**Files:**
- Modify: `apps/chrome-extension/src/content/overlay.ts`
- Test: `tests/e2e/playwright/overlay_and_dock.spec.ts`

- [ ] **Step 1: Update `overlay.ts` shadow styles to Material 3 Expressive**
- Replace box caption with an M3 Pill Chip (`border-radius: 9999px`, Level-3 drop shadow)
- Update highlight box border with `--md-sys-color-primary` glow
- Refine localized radial click ripple animation with M3 spring easing
- Modernize directional edge scroll marker as an M3 floating pill badge

- [ ] **Step 2: Build extension and run Playwright overlay tests**
Run: `npm run build && npx playwright test tests/e2e/playwright/overlay_and_dock.spec.ts`
Expected: 5 passed

- [ ] **Step 3: Commit**
```bash
git add apps/chrome-extension/src/content/overlay.ts
git commit -m "feat(ui): elevate in-page action overlay with Material 3 pill badges"
```

---

### Task 4: Modernize In-Page Floating Dock as an M3 Extended FAB Bar

**Files:**
- Modify: `apps/chrome-extension/src/content/dock.ts`
- Test: `tests/e2e/playwright/overlay_and_dock.spec.ts`

- [ ] **Step 1: Update `dock.ts` shadow styles to M3 Extended FAB Bar**
- Style the dock container with `backdrop-filter: blur(16px)`, `border-radius: 9999px`, and Level-3 elevation shadow.
- Restyle control buttons as M3 tonal pill buttons with Material 3 vector icons.
- Add smooth hover spring scaling (`transform: translateY(-2px) scale(1.02)`).

- [ ] **Step 2: Build extension and run Playwright tests**
Run: `npm run build && npm run test:e2e`
Expected: 12 passed

- [ ] **Step 3: Commit**
```bash
git add apps/chrome-extension/src/content/dock.ts
git commit -m "feat(ui): modernize in-page floating dock as an M3 Extended FAB"
```

---

### Task 5: Full Verification & Lint Suite

**Files:**
- Check: All workspaces
- Test: `npm test && npm run test:e2e && npm run lint && npm run typecheck`

- [ ] **Step 1: Run complete verification suite**
Run: `npm test && npm run test:e2e && npm run lint && npm run typecheck`
Expected: 100% green pass across all tests, zero warnings, clean formatting.

- [ ] **Step 2: Final Git Commit**
```bash
git commit --allow-empty -m "chore: complete Material 3 Expressive UI/UX overhaul"
```
