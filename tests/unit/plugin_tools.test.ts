import { describe, it, expect, vi } from "vitest";
import { browserTools } from "../../packages/opencode-plugin/src/tools.js";
import { RelayBrokerClient } from "../../packages/opencode-plugin/src/client.js";

describe("OpenCode Plugin Browser Tools", () => {
  it("defines all 16 required browser tools", () => {
    const requiredTools = [
      "browser_list_tabs",
      "browser_attach",
      "browser_snapshot",
      "browser_screenshot",
      "browser_navigate",
      "browser_click",
      "browser_type",
      "browser_keypress",
      "browser_scroll",
      "browser_select",
      "browser_wait",
      "browser_extract",
      "browser_download",
      "browser_verify",
      "browser_detach",
      "browser_status",
    ];

    expect(Object.keys(browserTools).sort()).toEqual(requiredTools.sort());
  });

  it("browser_click sends an action with external_effect risk and locator", async () => {
    const mockClient = {
      sendAction: vi.fn().mockResolvedValue({ success: true, verified: true }),
      setTabBinding: vi.fn(),
    } as unknown as RelayBrokerClient;

    const clickTool = browserTools["browser_click"];
    const result = await clickTool.execute(
      { role: "button", name: "Submit" },
      mockClient
    );

    expect(result).toEqual({ success: true, verified: true });
    expect(mockClient.sendAction).toHaveBeenCalledWith({
      type: "browser_click",
      locator: { role: "button", name: "Submit" },
      risk: "external_effect",
      is_irreversible: false,
    });
  });

  it("browser_navigate sends an action with URL", async () => {
    const mockClient = {
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      setTabBinding: vi.fn(),
    } as unknown as RelayBrokerClient;

    const navTool = browserTools["browser_navigate"];
    await navTool.execute({ url: "https://example.com/settings" }, mockClient);

    expect(mockClient.sendAction).toHaveBeenCalledWith({
      type: "browser_navigate",
      url: "https://example.com/settings",
      risk: "non_sensitive_mutation",
      is_irreversible: false,
    });
  });

  it("browser_attach updates client tab lease binding", async () => {
    const mockClient = {
      sendAction: vi.fn().mockResolvedValue({ attached: true }),
      setTabBinding: vi.fn(),
    } as unknown as RelayBrokerClient;

    const attachTool = browserTools["browser_attach"];
    await attachTool.execute({ tab_id: 101 }, mockClient);

    expect(mockClient.sendAction).toHaveBeenCalledWith(
      {
        type: "browser_attach",
        risk: "read_only",
        is_irreversible: false,
      },
      101
    );
    expect(mockClient.setTabBinding).toHaveBeenCalledWith(101, "lease_101");
  });
});
