import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import {
  VisionTaskExecutor,
  SessionContextManager,
  browserTools,
  RelayBrokerClient,
} from "../../packages/opencode-plugin/src/index.js";

describe("Vision Model Tasks & Immediate Screenshot Deletion", () => {
  const dummy1x1PngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("selects the configured vision model or defaults to a vision-capable model", () => {
    const sessionManager = new SessionContextManager();
    expect(sessionManager.getVisionModel()).toBe("gpt-4o");

    // Setting explicit vision model
    sessionManager.setVisionModel("claude-3-5-sonnet");
    expect(sessionManager.getVisionModel()).toBe("claude-3-5-sonnet");

    // Binding a session with vision model
    sessionManager.bindSession({
      sessionId: "sess_1",
      runId: "run_1",
      model: "gemini-1.5-pro",
    });
    expect(sessionManager.getVisionModel()).toBe("gemini-1.5-pro");
  });

  it("executes vision task with designated vision model and deletes screenshot immediately after use", async () => {
    let capturedTempPath = "";

    const { result, deleted } = await VisionTaskExecutor.executeWithTemporaryScreenshot(
      dummy1x1PngBase64,
      "claude-3-5-sonnet",
      async (tempPath, model) => {
        capturedTempPath = tempPath;
        // Verify file exists during execution
        expect(fs.existsSync(tempPath)).toBe(true);
        expect(model).toBe("claude-3-5-sonnet");
        return "success";
      }
    );

    expect(result).toBe("success");
    expect(deleted).toBe(true);
    // Verify file is deleted immediately right after use
    expect(capturedTempPath).not.toBe("");
    expect(fs.existsSync(capturedTempPath)).toBe(false);
  });

  it("guarantees screenshot deletion even if the vision task throws an error", async () => {
    let capturedTempPath = "";

    await expect(
      VisionTaskExecutor.executeWithTemporaryScreenshot(
        dummy1x1PngBase64,
        "gpt-4o",
        async (tempPath) => {
          capturedTempPath = tempPath;
          expect(fs.existsSync(tempPath)).toBe(true);
          throw new Error("Simulated model processing failure");
        }
      )
    ).rejects.toThrow("Simulated model processing failure");

    // File MUST be deleted immediately despite the error
    expect(capturedTempPath).not.toBe("");
    expect(fs.existsSync(capturedTempPath)).toBe(false);
  });

  it("browser_screenshot tool uses vision model and purges raw screenshot from response", async () => {
    const mockClient = {
      sendAction: vi.fn().mockResolvedValue({
        screenshot_base64: dummy1x1PngBase64,
      }),
    } as unknown as RelayBrokerClient;

    const sessionManager = new SessionContextManager();
    sessionManager.setVisionModel("gemini-1.5-flash");

    const result = await browserTools["browser_screenshot"].execute(
      { prompt: "Find login button location" },
      mockClient,
      sessionManager
    );

    expect(result.success).toBe(true);
    expect(result.vision_model_used).toBe("gemini-1.5-flash");
    expect(result.analysis).toContain("gemini-1.5-flash");
    expect(result.screenshot_deleted).toBe(true);
    // Raw base64 image data is purged from returned response
    expect((result as any).screenshot_base64).toBeUndefined();
  });
});
