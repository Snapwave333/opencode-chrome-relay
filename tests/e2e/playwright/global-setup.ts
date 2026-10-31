import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { BUILD_INPUTS, BUILD_OUTPUTS, REPO_ROOT } from "./support/paths";

function newestMtime(target: string): number {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(target)
    .reduce((max, entry) => Math.max(max, newestMtime(path.join(target, entry))), stat.mtimeMs);
}

function buildIsStale(): string | null {
  const missing = BUILD_OUTPUTS.find((file) => !fs.existsSync(file));
  if (missing) return `missing ${path.relative(REPO_ROOT, missing)}`;
  const oldestOutput = Math.min(...BUILD_OUTPUTS.map((file) => fs.statSync(file).mtimeMs));
  const newestInput = Math.max(...BUILD_INPUTS.map(newestMtime));
  if (newestInput > oldestOutput) return "sources changed since last build";
  return null;
}

export default function globalSetup(): void {
  if (process.env.E2E_SKIP_BUILD === "1") return;
  const reason = process.env.E2E_FORCE_BUILD === "1" ? "forced rebuild" : buildIsStale();
  if (!reason) return;
  process.stdout.write(`[e2e] building extension (${reason})\n`);
  execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });
}
