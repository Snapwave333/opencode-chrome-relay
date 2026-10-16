import { execSync } from "child_process";
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

function resolveNvidiaApiKey() {
  if (process.env.NVIDIA_API_KEY) {
    return process.env.NVIDIA_API_KEY.trim();
  }
  const envPaths = [
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(os.homedir(), ".env"),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      const match = content.match(/^NVIDIA_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  }
  return "";
}

const apiKey = resolveNvidiaApiKey();

execSync("npx tsc", { stdio: "inherit" });

await esbuild.build({
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  outfile: "dist/content/index.js",
});

await esbuild.build({
  entryPoints: ["src/background/index.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/background/index.js",
  define: {
    __NVIDIA_API_KEY__: JSON.stringify(apiKey),
  },
});

await esbuild.build({
  entryPoints: ["src/sidepanel/sidepanel.ts"],
  bundle: true,
  outfile: "dist/sidepanel/sidepanel.js",
});

fs.mkdirSync("dist/sidepanel", { recursive: true });
fs.copyFileSync("src/sidepanel/index.html", "dist/sidepanel/index.html");
fs.copyFileSync("src/sidepanel/sidepanel.css", "dist/sidepanel/sidepanel.css");
