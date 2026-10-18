# Element Targeting Architecture

## Overview

The OpenCode Chrome Relay extension maps interactive DOM elements to stable indices that AI agents can reference across observation and action requests. This document describes how element targeting works after the BUG-011 correctness fix.

## Problem Statement

AI agents observe a page to get a list of interactive elements (buttons, inputs, etc.), then reference those elements by index in subsequent click/type/hover actions. The challenge is:

1. **No DOM Pollution:** Cannot add `data-*` attributes to page elements (violates isolation principle)
2. **Consistency:** Index N from observation MUST resolve to the exact same element in actions
3. **Dialog Priority:** Modal dialogs overlay page content, so dialog elements must be indexed first
4. **Deduplication:** Multiple elements with same label must be deduplicated consistently
5. **Stale Detection:** Elements can disappear or move; must detect and report staleness gracefully

## Solution Architecture

### Phase 1: Observation (`observeTab`)

When an agent calls `browser_snapshot`, the extension:

1. **Queries all interactive elements** using deep shadow DOM traversal:
   ```typescript
   const selectorQuery = 
     'button, a[href], input:not([type="hidden"]), select, textarea, ' +
     '[role="button"], [role="menuitem"], [role="option"], [role="tab"], ' +
     '[role="checkbox"], mat-select, mat-option, summary, [tabindex="0"]';
   ```

2. **Prioritizes dialog elements:**
   - Finds all visible modal dialogs (`[role="dialog"]`, `[aria-modal="true"]`, `.modal.show`, etc.)
   - Extracts interactive elements from dialogs first
   - Then extracts page-level elements
   - Deduplicates: `[...dialogElements, ...pageElements]`

3. **Builds element labels:**
   - Prioritizes `aria-label` > `innerText` > `placeholder` > `title`
   - Truncates to 80 characters
   - Normalizes whitespace

4. **Deduplicates consistently:**
   ```typescript
   const dedupeKey = `${tag}:${label}:${selector}`;
   if (!seenLabels.has(dedupeKey)) {
     seenLabels.add(dedupeKey);
     elements.push(element);
   }
   ```

5. **Caches element references in isolated world:**
   ```typescript
   const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
   (window as any)[ELEMENT_CACHE_KEY] = {
     elements: [el1, el2, el3, ...], // Actual DOM element references
     timestamp: Date.now()
   };
   ```

6. **Returns observation to agent:**
   ```json
   {
     "elements": [
       {"index": 0, "tag": "button", "label": "Confirm", "selector": "#modal-confirm"},
       {"index": 1, "tag": "button", "label": "Cancel", "selector": "#modal-cancel"},
       {"index": 2, "tag": "button", "label": "Submit", "selector": "#page-submit"}
     ]
   }
   ```

### Phase 2: Action (click/type/hover)

When an agent calls `browser_click` with `{"index": 0}`:

1. **Retrieve from cache:**
   ```typescript
   const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
   const cache = (window as any)[ELEMENT_CACHE_KEY];
   
   if (cache && Date.now() - cache.timestamp < 10000) {
     const el = cache.elements[targetIndex];
     if (el && document.contains(el) && isVisible(el)) {
       return triggerClick(el);
     }
   }
   ```

2. **Staleness detection:**
   - Cache missing: Never observed, or cleared by navigation
   - Cache expired: > 10 seconds old (agent should re-observe)
   - Element detached: Not in DOM anymore
   - Element hidden: No longer visible

3. **Graceful error:**
   ```json
   {
     "ok": false,
     "error": "Element index 0 not found. The page may have changed - please run 'browser_snapshot' again."
   }
   ```

## Why Symbol Keys?

```typescript
const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
(window as any)[ELEMENT_CACHE_KEY] = { ... };
```

**Benefits:**
- **Invisible to page scripts:** `Object.keys(window)` does not include Symbols
- **No enumeration:** `for...in` loops skip Symbol properties
- **Cross-script sharing:** `Symbol.for()` creates a global registry, so observe and action scripts access the same cache
- **No DOM pollution:** Cache lives in JavaScript memory, not DOM attributes

**Security:**
- Pages can access it if they know the exact Symbol: `window[Symbol.for('__opencode_relay_elements__')]`
- But pages have no reason to know this internal extension key
- Even if accessed, it only exposes a list of their own DOM elements

## Test Coverage

### 1. Cache Retrieval Test
**Validates:** Index from observe maps to same element in click

```typescript
observeTab();           // Returns [{index: 0, id: "btn-1"}, ...]
click({index: 0});      // Clicks btn-1
assert(clicked.id === observed[0].id);
```

### 2. Modal Priority Test
**Validates:** Dialog elements are indexed first consistently

```typescript
observeBefore();        // Modal hidden: [page-btn-1, page-btn-2, ...]
showModal();
observeAfter();         // Modal shown: [modal-confirm, modal-cancel, page-btn-1, ...]
click({index: 0});      // Clicks modal-confirm, not page-btn-1
```

### 3. Duplicate Labels Test
**Validates:** Same deduplication logic in observe and actions

```typescript
// Two buttons with label "Submit" but different IDs
observe();              // Returns both (different selectors)
click({index: 0});      // Clicks first Submit
click({index: 1});      // Clicks second Submit
```

### 4. Type Handler Test
**Validates:** Inputs retrieved correctly from cache

```typescript
observe();              // Caches buttons + inputs
type({index: N});       // Types into input at index N
assert(typedElement.id === observedInputs[N].id);
```

### 5. Hover Handler Test
**Validates:** Hover uses same cache as click

```typescript
observe();
hover({index: 1});      // Hovers element at index 1
assert(hoveredElement.id === observed[1].id);
```

## Comparison: Before vs After

### Before BUG-011 Fix (Broken)

```typescript
// observeTab stamped DOM attributes
el.setAttribute('data-relay-index', index.toString());

// Click handler rebuilt element list with different logic
const elements = Array.from(document.querySelectorAll(selectors));
const filtered = elements.filter(isVisible);  // Different filter than observe!
const el = filtered[index];  // WRONG ELEMENT!
```

**Problems:**
- DOM pollution visible to page scripts
- Index drift from inconsistent rebuild logic
- Type handler skipped dialogs (different ordering)
- Deduplication keys mismatched (`tag:label` vs `tag:label:selector`)

### After BUG-011 Fix (Correct)

```typescript
// observeTab caches live references
const cache = { elements: [el1, el2, el3], timestamp: Date.now() };
window[Symbol.for('__opencode_relay_elements__')] = cache;

// Click handler retrieves directly
const el = cache.elements[index];  // EXACT SAME ELEMENT!
if (el && document.contains(el)) {
  el.click();
}
```

**Benefits:**
- Zero DOM pollution
- Perfect index consistency
- All handlers use identical cache
- Clear staleness errors

## Cache Lifecycle

```
┌─────────────────┐
│  Page Load      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     observeTab      ┌──────────────────┐
│  No Cache       │ ──────────────────▶ │ Cache Created    │
└─────────────────┘                     │ timestamp: T0    │
                                        └────────┬─────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────┐
                    │                            │                        │
                    ▼ (< 10s)                   ▼ (< 10s)               ▼ (> 10s)
            ┌──────────────┐            ┌──────────────┐        ┌─────────────┐
            │ click({i:0}) │            │ type({i:2})  │        │ Cache Stale │
            │ ✅ Success   │            │ ✅ Success   │        │ ❌ Error    │
            └──────────────┘            └──────────────┘        └─────────────┘
                    │                            │                        │
                    └────────────────────────────┼────────────────────────┘
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │ Agent observes   │
                                        │ again (refreshes │
                                        │ cache)           │
                                        └──────────────────┘
```

## Performance

- **Memory:** ~120 element references × ~100 bytes = ~12 KB per tab
- **Lookup:** O(1) array index access
- **Cache TTL:** 10 seconds (typical agent workflow: observe → action within 1-2s)
- **Overhead:** Symbol property access is ~10ns (negligible)

## Edge Cases

### 1. Rapid DOM Mutations
**Scenario:** Element disappears between observe and click

**Handling:**
```typescript
const el = cache.elements[index];
if (!el || !document.contains(el)) {
  return { ok: false, error: "Element no longer exists" };
}
```

### 2. Navigation
**Scenario:** Page navigates, clearing all JavaScript state

**Handling:** Cache is lost; agent must observe again (expected behavior)

### 3. Shadow DOM
**Scenario:** Interactive elements inside closed shadow roots

**Handling:** `findNodesDeep()` traverses open shadow roots; closed roots are inaccessible by design

### 4. Duplicate Cache Keys
**Scenario:** Two buttons: same tag, label, and ID

**Handling:** First one wins (deduplication); second is ignored (correct - they're truly identical to the agent)

## Future Improvements

1. **WeakRef Cache:** Use `WeakRef<Element>[]` to allow GC of detached elements
2. **Per-Tab Caching:** Store in background script Map<tabId, cache> for longer TTL
3. **Incremental Updates:** Diff-based element list updates instead of full rebuild
4. **Visual Annotations:** Optional dev mode to highlight cached elements with transient overlays

## Related Files

- **Implementation:** `apps/chrome-extension/src/background/index.ts`
  - `observeTab()` lines 1576-1750
  - Click handler lines 670-695
  - Type handler lines 859-880
  - Hover handler lines 1119-1135

- **Tests:** `tests/e2e/playwright/element_targeting.spec.ts`
  - 5 comprehensive E2E tests validating correctness

- **Documentation:**
  - `BUG_REPORT.md` - Original bug discovery
  - `ELEMENT_TARGETING.md` - This architecture doc
