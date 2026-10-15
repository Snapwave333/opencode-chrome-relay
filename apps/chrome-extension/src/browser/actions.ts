export interface ClickOptions {
  button?: "left" | "middle" | "right";
  clickCount?: number;
}

export function keyToCDPKeyEvent(key: string): { type: string; key: string; code: string; text?: string } {
  switch (key.toLowerCase()) {
    case "enter":
      return { type: "rawKeyDown", key: "Enter", code: "Enter", text: "\r" };
    case "tab":
      return { type: "rawKeyDown", key: "Tab", code: "Tab" };
    case "escape":
    case "esc":
      return { type: "rawKeyDown", key: "Escape", code: "Escape" };
    case "backspace":
      return { type: "rawKeyDown", key: "Backspace", code: "Backspace" };
    case "arrowdown":
      return { type: "rawKeyDown", key: "ArrowDown", code: "ArrowDown" };
    case "arrowup":
      return { type: "rawKeyDown", key: "ArrowUp", code: "ArrowUp" };
    default:
      return { type: "keyDown", key, code: key, text: key };
  }
}
