export interface ClickOptions {
  button?: "left" | "middle" | "right";
  clickCount?: number;
}

const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
};

// CDP modifier bits: Alt=1, Ctrl=2, Meta=4, Shift=8
const MODIFIER_BITS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

export interface CDPKeyEvent {
  type: string;
  key: string;
  code: string;
  text?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
}

// Accepts "Enter", "a", "F5", "ctrl+a", "Shift+Tab". Only printable keys carry text, so a named
// key is never typed into the page as its own name.
export function keyToCDPKeyEvent(key: string): CDPKeyEvent {
  const parts = key.split("+").map((p) => p.trim()).filter(Boolean);
  const main = parts.length > 1 ? parts[parts.length - 1] : key;
  const modifiers = parts.slice(0, -1).reduce((bits, p) => bits | (MODIFIER_BITS[p.toLowerCase()] || 0), 0);

  const named = NAMED_KEYS[main.toLowerCase()];
  if (named) {
    return {
      type: named.text && !modifiers ? "keyDown" : "rawKeyDown",
      key: named.key,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      ...(named.text && !modifiers ? { text: named.text } : {}),
      ...(modifiers ? { modifiers } : {}),
    };
  }
  const fn = main.match(/^f([1-9]|1[0-2])$/i);
  if (fn) {
    const n = Number(fn[1]);
    return { type: "rawKeyDown", key: `F${n}`, code: `F${n}`, windowsVirtualKeyCode: 111 + n, ...(modifiers ? { modifiers } : {}) };
  }
  if (main.length === 1) {
    const upper = main.toUpperCase();
    const code = /[a-z]/i.test(main) ? `Key${upper}` : /[0-9]/.test(main) ? `Digit${main}` : main;
    const keyCode = /[a-z0-9]/i.test(main) ? upper.charCodeAt(0) : undefined;
    // With Ctrl/Alt/Meta held the key is a shortcut, not text
    const typesText = !(modifiers & 7);
    return {
      type: typesText ? "keyDown" : "rawKeyDown",
      key: main,
      code,
      ...(keyCode ? { windowsVirtualKeyCode: keyCode } : {}),
      ...(typesText ? { text: main } : {}),
      ...(modifiers ? { modifiers } : {}),
    };
  }
  return { type: "rawKeyDown", key: main, code: main, ...(modifiers ? { modifiers } : {}) };
}

