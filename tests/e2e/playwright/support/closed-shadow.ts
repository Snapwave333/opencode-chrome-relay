import type { CDPSession, Page } from "@playwright/test";

export interface ShadowElementState {
  text: string;
  classes: string[];
  display: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

interface DomNode {
  nodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: Array<DomNode & { shadowRootType?: string }>;
}

const READ_STATE = `function () {
  const style = getComputedStyle(this);
  const r = this.getBoundingClientRect();
  return {
    text: (this.textContent || "").replace(/\\s+/g, " ").trim(),
    classes: Array.from(this.classList),
    display: style.display,
    visible: style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.height > 0,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
}`;

export class ClosedShadowInspector {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession
  ) {}

  static async attach(page: Page): Promise<ClosedShadowInspector> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    return new ClosedShadowInspector(page, cdp);
  }

  async detach(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }

  private async findHost(hostId: string): Promise<DomNode | null> {
    const { root } = (await this.cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: DomNode };
    const stack: DomNode[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      const attrs = node.attributes ?? [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === "id" && attrs[i + 1] === hostId) return node;
      }
      stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
    }
    return null;
  }

  async shadowMode(hostId: string): Promise<string | null> {
    const host = await this.findHost(hostId);
    return host?.shadowRoots?.[0]?.shadowRootType ?? null;
  }

  private async queryNode(hostId: string, selector: string): Promise<number | null> {
    const host = await this.findHost(hostId);
    const shadowRoot = host?.shadowRoots?.[0];
    if (!shadowRoot) return null;
    const { nodeId } = await this.cdp.send("DOM.querySelector", { nodeId: shadowRoot.nodeId, selector });
    return nodeId || null;
  }

  async state(hostId: string, selector: string): Promise<ShadowElementState | null> {
    const nodeId = await this.queryNode(hostId, selector);
    if (!nodeId) return null;
    const { object } = await this.cdp.send("DOM.resolveNode", { nodeId });
    const { result } = await this.cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId!,
      functionDeclaration: READ_STATE,
      returnByValue: true,
    });
    await this.cdp.send("Runtime.releaseObject", { objectId: object.objectId! });
    return result.value as ShadowElementState;
  }

  async click(hostId: string, selector: string): Promise<void> {
    const current = await this.state(hostId, selector);
    if (!current?.visible) throw new Error(`${selector} inside #${hostId} is not visible`);
    const { x, y, width, height } = current.rect;
    await this.page.mouse.click(x + width / 2, y + height / 2);
  }
}
