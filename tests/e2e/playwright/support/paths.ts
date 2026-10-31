import path from "path";

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const EXTENSION_DIR = path.join(REPO_ROOT, "apps/chrome-extension");
export const EXTENSION_DIST = path.join(EXTENSION_DIR, "dist");
export const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

export const CONTENT_SCRIPT = path.join(EXTENSION_DIST, "content/index.js");
export const BACKGROUND_SCRIPT = path.join(EXTENSION_DIST, "background/index.js");
export const SIDEPANEL_HTML = path.join(EXTENSION_DIST, "sidepanel/index.html");
export const TEST_PAGE = path.join(FIXTURES_DIR, "test_page.html");

export const OVERLAY_HOST_ID = "opencode-relay-overlay-root";
export const DOCK_HOST_ID = "opencode-relay-dock-root";

export const BUILD_OUTPUTS = [CONTENT_SCRIPT, BACKGROUND_SCRIPT, SIDEPANEL_HTML];
export const BUILD_INPUTS = [
  path.join(EXTENSION_DIR, "src"),
  path.join(EXTENSION_DIR, "build.mjs"),
  path.join(REPO_ROOT, "packages/protocol/src"),
];
