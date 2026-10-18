import { execSync } from "child_process";
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

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
  // REMOVED: API key embedding - keys must never be in client-side code
});

await esbuild.build({
  entryPoints: ["src/sidepanel/sidepanel.ts"],
  bundle: true,
  outfile: "dist/sidepanel/sidepanel.js",
});

fs.mkdirSync("dist/sidepanel", { recursive: true });
fs.copyFileSync("src/sidepanel/index.html", "dist/sidepanel/index.html");
fs.copyFileSync("src/sidepanel/sidepanel.css", "dist/sidepanel/sidepanel.css");
