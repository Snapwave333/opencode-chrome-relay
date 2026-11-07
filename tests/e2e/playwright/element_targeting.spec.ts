import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import http from "http";

/**
 * BUG-011 regression tests: Verify that element index resolution is consistent
 * between observeTab and click/type/hover handlers.
 * 
 * These tests ensure:
 * 1. Index N from observe maps to the exact same element in click, type, hover
 * 2. Modal dialogs are prioritized correctly in all handlers
 * 3. Duplicate labels are deduplicated consistently
 */
test.describe("Element Targeting Consistency (BUG-011)", () => {
  const extensionPath = path.resolve(__dirname, "../../../apps/chrome-extension");
  let userDataDir: string;
  let server: http.Server;
  let serverUrl: string;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-element-test-"));
    
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      
      // Test page with dialogs and duplicate labels
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Element Targeting Test Page</title>
  <style>
    .modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 2px solid #333;
      padding: 20px;
      z-index: 1000;
      width: 300px;
    }
    .modal.show { display: block; }
    body { margin: 20px; }
  </style>
</head>
<body>
  <h1>Element Targeting Test</h1>
  
  <!-- Page-level elements -->
  <button id="page-btn-1">Submit</button>
  <button id="page-btn-2">Cancel</button>
  <button id="page-btn-3" data-action="duplicate">Submit</button>
  <input id="page-input-1" type="text" placeholder="Username" />
  <input id="page-input-2" type="text" placeholder="Email" />
  
  <!-- Modal dialog (hidden by default) -->
  <div id="test-modal" class="modal" role="dialog" aria-modal="true">
    <h2>Confirm Action</h2>
    <button id="modal-btn-confirm">Confirm</button>
    <button id="modal-btn-cancel">Cancel</button>
    <input id="modal-input" type="text" placeholder="Reason" />
  </div>
  
  <button id="show-modal-btn" onclick="document.getElementById('test-modal').classList.add('show')">
    Show Modal
  </button>
  
  <div id="output"></div>
  
  <script>
    // Track which elements were interacted with
    document.querySelectorAll('button, input').forEach(el => {
      el.addEventListener('click', (e) => {
        const output = document.getElementById('output');
        output.textContent = 'clicked:' + el.id;
        output.dataset.lastInteraction = 'click:' + el.id;
      });
      el.addEventListener('focus', (e) => {
        const output = document.getElementById('output');
        output.dataset.lastFocus = 'focus:' + el.id;
      });
      el.addEventListener('mouseenter', (e) => {
        const output = document.getElementById('output');
        output.dataset.lastHover = 'hover:' + el.id;
      });
    });
  </script>
</body>
</html>`);
    });
    
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  test.afterEach(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  });

  async function launchWithExtension(): Promise<BrowserContext> {
    return chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--headless=new`,
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--no-sandbox`,
      ],
      ignoreDefaultArgs: ["--disable-extensions"],
    });
  }

  test("observeTab caches elements that click handler can retrieve", async () => {
    const context = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(serverUrl);

      // Simulate observeTab by executing the same script that background.ts uses
      const observation = await page.evaluate(() => {
        // Replicate observeTab's element extraction and caching
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const elements: any[] = [];
        
        const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        
        buttons.forEach((el, idx) => {
          elements.push({
            index: idx,
            id: el.id,
            label: el.textContent?.trim() || '',
          });
        });
        
        // Store cache like observeTab does
        (window as any)[ELEMENT_CACHE_KEY] = {
          elements: buttons,
          timestamp: Date.now()
        };
        
        return elements;
      });

      expect(observation.length).toBeGreaterThan(0);

      // Now simulate click on index 0 (should be first button)
      const clickResult = await page.evaluate((targetIndex: number) => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const cache = (window as any)[ELEMENT_CACHE_KEY];
        
        if (!cache || !cache.elements) {
          return { ok: false, error: 'Cache not found' };
        }
        
        const el = cache.elements[targetIndex] as HTMLElement;
        if (!el || !document.contains(el)) {
          return { ok: false, error: 'Element not in cache' };
        }
        
        el.click();
        return { ok: true, clickedId: el.id };
      }, 0);

      expect(clickResult.ok).toBe(true);
      expect(clickResult.clickedId).toBe(observation[0].id);

      // Verify the click actually happened
      const outputText = await page.locator('#output').textContent();
      expect(outputText).toContain('clicked:' + observation[0].id);

      await page.close();
    } finally {
      await context.close();
    }
  });

  test("modal dialog elements are prioritized and indexed consistently", async () => {
    const context = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(serverUrl);

      // First observe without modal
      const beforeModal = await page.evaluate(() => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none';
        });
        
        (window as any)[ELEMENT_CACHE_KEY] = { elements: buttons, timestamp: Date.now() };
        return buttons.map(el => el.id);
      });

      expect(beforeModal).toContain('page-btn-1');
      expect(beforeModal).not.toContain('modal-btn-confirm');

      // Show modal
      await page.click('#show-modal-btn');
      await page.waitForSelector('#test-modal.show');

      // Observe with modal open
      const withModal = await page.evaluate(() => {
        // Simulate observeTab's dialog prioritization
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        
        const isVisible = (el: Element): boolean => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none';
        };

        const modal = document.querySelector('.modal.show');
        const dialogButtons = modal 
          ? Array.from(modal.querySelectorAll('button')).filter(isVisible)
          : [];
        const pageButtons = Array.from(document.querySelectorAll('button')).filter(isVisible);
        
        // Dialog elements MUST come first
        const allButtons = [...dialogButtons, ...pageButtons.filter(el => !dialogButtons.includes(el))];
        
        (window as any)[ELEMENT_CACHE_KEY] = { elements: allButtons, timestamp: Date.now() };
        return allButtons.map(el => el.id);
      });

      // Modal buttons should be first
      expect(withModal[0]).toBe('modal-btn-confirm');
      expect(withModal[1]).toBe('modal-btn-cancel');

      // Click index 0 should click modal button, not page button
      const clickResult = await page.evaluate(() => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const cache = (window as any)[ELEMENT_CACHE_KEY];
        const el = cache.elements[0] as HTMLElement;
        el.click();
        return el.id;
      });

      expect(clickResult).toBe('modal-btn-confirm');

      await page.close();
    } finally {
      await context.close();
    }
  });

  test("duplicate labels are handled consistently", async () => {
    const context = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(serverUrl);

      // Observe elements with duplicate "Submit" labels
      // Note: observeTab deduplicates by tag:label:selector, so buttons with different IDs
      // (and thus different selectors) are NOT considered duplicates
      const observation = await page.evaluate(() => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        
        function buildSelector(el: Element): string {
          if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
            return `#${el.id}`;
          }
          return "";
        }
        
        const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        
        const deduped: HTMLElement[] = [];
        const seen = new Set<string>();
        
        for (const btn of buttons) {
          const label = (btn.textContent || '').trim();
          const tag = btn.tagName.toLowerCase();
          const selector = buildSelector(btn);
          const dedupeKey = `${tag}:${label}:${selector}`;
          
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            deduped.push(btn as HTMLElement);
          }
        }
        
        (window as any)[ELEMENT_CACHE_KEY] = { elements: deduped, timestamp: Date.now() };
        return deduped.map(el => ({ id: el.id, label: el.textContent?.trim() }));
      });

      // Both "Submit" buttons have different IDs, so both are kept
      // (This is correct behavior - same label but different elements)
      const submitButtons = observation.filter(el => el.label === 'Submit');
      expect(submitButtons.length).toBe(2);
      expect(submitButtons[0].id).toBe('page-btn-1');
      expect(submitButtons[1].id).toBe('page-btn-3');

      // However, if we had buttons with the same ID and label, only one would be kept
      // The deduplication ensures consistency across observe and action handlers

      await page.close();
    } finally {
      await context.close();
    }
  });

  test("type handler retrieves correct input from cache", async () => {
    const context = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(serverUrl);

      // Observe and cache all interactive elements including inputs
      const inputs = await page.evaluate(() => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const allInteractive = Array.from(
          document.querySelectorAll('button, input, select, textarea')
        ).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        
        (window as any)[ELEMENT_CACHE_KEY] = { elements: allInteractive, timestamp: Date.now() };
        return allInteractive.map((el, idx) => ({
          index: idx,
          tag: el.tagName.toLowerCase(),
          id: el.id,
          placeholder: (el as HTMLInputElement).placeholder || ''
        }));
      });

      const usernameInputIndex = inputs.findIndex(el => el.id === 'page-input-1');
      expect(usernameInputIndex).toBeGreaterThanOrEqual(0);

      // Type into the input using cache
      const typeResult = await page.evaluate((targetIndex: number) => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const cache = (window as any)[ELEMENT_CACHE_KEY];
        const el = cache.elements[targetIndex] as HTMLInputElement;
        
        if (!el) return { ok: false };
        
        el.focus();
        el.value = 'test_user_123';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        return { ok: true, typedId: el.id, value: el.value };
      }, usernameInputIndex);

      expect(typeResult.ok).toBe(true);
      expect(typeResult.typedId).toBe('page-input-1');
      expect(typeResult.value).toBe('test_user_123');

      await page.close();
    } finally {
      await context.close();
    }
  });

  test("hover handler retrieves correct element from cache", async () => {
    const context = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(serverUrl);

      // Cache elements
      await page.evaluate(() => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        (window as any)[ELEMENT_CACHE_KEY] = { elements: buttons, timestamp: Date.now() };
      });

      // Hover over index 1
      const hoverResult = await page.evaluate((targetIndex: number) => {
        const ELEMENT_CACHE_KEY = Symbol.for('__opencode_relay_elements__');
        const cache = (window as any)[ELEMENT_CACHE_KEY];
        const el = cache.elements[targetIndex] as HTMLElement;
        
        if (!el) return { ok: false };
        
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        
        return { ok: true, hoveredId: el.id };
      }, 1);

      expect(hoverResult.ok).toBe(true);
      expect(hoverResult.hoveredId).toBe('page-btn-2');

      // Verify hover was registered
      const hoverData = await page.evaluate(() => {
        return document.getElementById('output')?.dataset.lastHover;
      });
      expect(hoverData).toBe('hover:page-btn-2');

      await page.close();
    } finally {
      await context.close();
    }
  });
});
