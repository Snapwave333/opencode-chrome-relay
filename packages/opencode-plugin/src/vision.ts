import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { NvidiaNimClient } from "./nim.js";
import { NVIDIA_NIM_FREE_MODELS } from "@opencode/chrome-relay-protocol";

export interface VisionTaskResult {
  visionModelUsed: string;
  analysis: string;
  screenshotDeleted: boolean;
  temporaryFilePath?: string;
  retries?: number;
}

export class VisionTaskExecutor {
  private static nimClient = new NvidiaNimClient();

  /**
   * Saves a base64 screenshot to a temporary file, executes the vision task
   * with the designated vision model, and guarantees immediate deletion
   * of the screenshot file right after use.
   */
  public static async executeWithTemporaryScreenshot<T>(
    imageBase64: string,
    visionModel: string,
    taskFn: (tempPath: string, model: string) => Promise<T>
  ): Promise<{ result: T; deleted: boolean }> {
    const filename = `opencode_relay_shot_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.png`;
    const tempPath = path.join(os.tmpdir(), filename);
    let result: T;

    try {
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      await fs.promises.writeFile(tempPath, Buffer.from(cleanBase64, "base64"));
      result = await taskFn(tempPath, visionModel);
    } finally {
      await VisionTaskExecutor.removeTemporaryFile(tempPath);
    }

    return { result, deleted: !fs.existsSync(tempPath) };
  }

  private static async removeTemporaryFile(tempPath: string): Promise<void> {
    try {
      await fs.promises.unlink(tempPath);
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        console.error(`Failed to delete temporary screenshot at ${tempPath}:`, e);
      }
    }
  }

  /**
   * High-level vision analysis using free NVIDIA NIM vision models with retries and cooldowns.
   */
  public static async analyzeScreenshot(
    imageBase64: string,
    prompt: string,
    visionModel: string = NVIDIA_NIM_FREE_MODELS.vision
  ): Promise<VisionTaskResult> {
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const { result } = await this.executeWithTemporaryScreenshot(
      imageBase64,
      visionModel,
      async (tempPath, model) => {
        // Query NVIDIA NIM vision model with retries and cooldown handling
        const completion = await this.nimClient.complete(
          [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${cleanBase64}` },
                },
              ],
            },
          ],
          { model }
        );

        return {
          analysis: completion.text,
          modelUsed: completion.modelUsed,
          retries: completion.retries,
          temporaryFilePath: tempPath,
        };
      }
    );

    return {
      visionModelUsed: result.modelUsed,
      analysis: result.analysis,
      screenshotDeleted: true,
      temporaryFilePath: result.temporaryFilePath,
      retries: result.retries,
    };
  }
}
