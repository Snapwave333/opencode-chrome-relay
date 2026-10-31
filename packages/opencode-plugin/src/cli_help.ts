export type CommandGroupId = "setup" | "tabs" | "inspect" | "interact" | "capture" | "automation";

export interface CommandSpec {
  name: string;
  aliases: string[];
  usage: string;
  summary: string;
  group: CommandGroupId;
  details?: string;
  options?: Array<{ flags: string; description: string }>;
  examples: string[];
}

export const COMMAND_GROUPS: Array<{ id: CommandGroupId; title: string }> = [
  { id: "setup", title: "SETUP & DIAGNOSTICS" },
  { id: "tabs", title: "TABS & NAVIGATION" },
  { id: "inspect", title: "READ THE PAGE" },
  { id: "interact", title: "INTERACT" },
  { id: "capture", title: "CAPTURE & FILES" },
  { id: "automation", title: "AUTOMATION & AGENTS" },
];

const TARGET_HINT =
  "Targets accept an element index from `snapshot` (3 or [3]), visible text or accessible name, a CSS selector, or x,y coordinates.";

export const COMMANDS: CommandSpec[] = [
  {
    name: "doctor",
    aliases: ["diagnose", "check"],
    usage: "doctor [--fix] [--json]",
    summary: "Diagnose broker, extension, tab binding, config and install health",
    group: "setup",
    details:
      "Runs every health check in parallel where possible and prints a pass/warn/fail report with a fix hint per problem. Exits 1 when any check fails, so it can gate CI or pipeline start-up.",
    options: [
      { flags: "--fix", description: "Try safe automatic fixes (start the local broker binary if it is not running)" },
      { flags: "--json", description: "Emit the report as JSON" },
    ],
    examples: ["browser-relay doctor", "browser-relay doctor --fix", "browser-relay doctor --json | jq '.checks[] | select(.status==\"fail\")'"],
  },
  {
    name: "status",
    aliases: [],
    usage: "status [--json]",
    summary: "Show broker health, active sessions and recent journaled actions",
    group: "setup",
    examples: ["browser-relay status", "browser-relay status --json"],
  },
  {
    name: "help",
    aliases: [],
    usage: "help [command] [--json]",
    summary: "Show this overview, detailed help for one command, or a JSON manifest",
    group: "setup",
    examples: ["browser-relay help click", "browser-relay click --help", "browser-relay help --json"],
  },
  {
    name: "version",
    aliases: [],
    usage: "version",
    summary: "Print the CLI version",
    group: "setup",
    examples: ["browser-relay --version"],
  },
  {
    name: "tabs",
    aliases: ["list-tabs"],
    usage: "tabs",
    summary: "List all open Chrome tabs across all windows",
    group: "tabs",
    examples: ["browser-relay tabs", "browser-relay tabs --json"],
  },
  {
    name: "new-tab",
    aliases: [],
    usage: "new-tab [url] [--background]",
    summary: "Open a new tab (default https://www.google.com)",
    group: "tabs",
    details: "Prints the new tab id. Combine with --background so an automation tab never steals focus.",
    examples: ["browser-relay new-tab https://example.com --background --json"],
  },
  {
    name: "close-tab",
    aliases: [],
    usage: "close-tab [--tab <id>]",
    summary: "Close the specified or active tab",
    group: "tabs",
    examples: ["browser-relay close-tab --tab 42"],
  },
  {
    name: "switch-tab",
    aliases: ["focus", "tab"],
    usage: "switch-tab <id|query>",
    summary: "Focus a tab by numeric id or by title/URL search",
    group: "tabs",
    examples: ["browser-relay switch-tab 42", "browser-relay switch-tab github"],
  },
  {
    name: "nav",
    aliases: ["navigate", "open", "goto"],
    usage: "nav <url-or-site> [--new-tab] [--background]",
    summary: "Navigate to a URL, domain or known site name",
    group: "tabs",
    details: 'Bare names and phrases resolve to sites ("youtube", "google cloud credentials"); anything else becomes a search.',
    examples: ["browser-relay nav example.com", "browser-relay nav https://example.com --new-tab --background"],
  },
  { name: "reload", aliases: ["refresh"], usage: "reload", summary: "Reload the tab", group: "tabs", examples: ["browser-relay reload"] },
  { name: "back", aliases: [], usage: "back", summary: "Go back in tab history", group: "tabs", examples: ["browser-relay back"] },
  { name: "forward", aliases: [], usage: "forward", summary: "Go forward in tab history", group: "tabs", examples: ["browser-relay forward"] },
  { name: "url", aliases: [], usage: "url", summary: "Print the current tab URL", group: "inspect", examples: ["browser-relay url"] },
  { name: "title", aliases: [], usage: "title", summary: "Print the current tab title", group: "inspect", examples: ["browser-relay title"] },
  {
    name: "snapshot",
    aliases: ["observe", "dom"],
    usage: "snapshot",
    summary: "URL, title, headings and indexed interactive elements with selectors",
    group: "inspect",
    details: "Element indices printed here can be passed to click, type, hover and friends.",
    examples: ["browser-relay snapshot", "browser-relay snapshot --json"],
  },
  {
    name: "find",
    aliases: ["search"],
    usage: "find <query>",
    summary: "Find text and interactive elements matching a query, with click indices",
    group: "inspect",
    examples: ['browser-relay find "sign in"'],
  },
  {
    name: "extract",
    aliases: ["text", "read"],
    usage: "extract [selector]",
    summary: "Extract visible text and links from the page or a selector",
    group: "inspect",
    examples: ["browser-relay extract", "browser-relay extract main"],
  },
  {
    name: "eval",
    aliases: ["js", "exec"],
    usage: "eval <js-expression>",
    summary: "Evaluate JavaScript in the tab and print the result",
    group: "inspect",
    examples: ['browser-relay eval "document.querySelectorAll(\'a\').length"'],
  },
  {
    name: "verify",
    aliases: [],
    usage: "verify <selector|text>",
    summary: "Check whether a selector or text exists on the page",
    group: "inspect",
    examples: ['browser-relay verify "#checkout"', 'browser-relay verify "Order confirmed"'],
  },
  { name: "cookies", aliases: [], usage: "cookies [domain]", summary: "Inspect cookies for the tab", group: "inspect", examples: ["browser-relay cookies"] },
  { name: "storage", aliases: [], usage: "storage [key]", summary: "Inspect localStorage and sessionStorage", group: "inspect", examples: ["browser-relay storage token"] },
  {
    name: "click",
    aliases: [],
    usage: "click <index|name|selector|x,y>",
    summary: "Click an element",
    group: "interact",
    details: TARGET_HINT,
    examples: ["browser-relay click 3", 'browser-relay click "Sign in"', "browser-relay click '#submit'", "browser-relay click 640,360"],
  },
  { name: "dblclick", aliases: ["double-click"], usage: "dblclick <target>", summary: "Double-click an element", group: "interact", details: TARGET_HINT, examples: ["browser-relay dblclick 7"] },
  { name: "rightclick", aliases: ["contextmenu"], usage: "rightclick <target>", summary: "Right-click / open a context menu", group: "interact", details: TARGET_HINT, examples: ["browser-relay rightclick 7"] },
  { name: "hover", aliases: [], usage: "hover <target>", summary: "Hover to reveal menus or tooltips", group: "interact", details: TARGET_HINT, examples: ['browser-relay hover "Account"'] },
  {
    name: "type",
    aliases: ["fill"],
    usage: "type [target] <text>",
    summary: "Type into an input or textarea (focused one if no target)",
    group: "interact",
    details: TARGET_HINT,
    examples: ['browser-relay type 4 "hello@example.com"', 'browser-relay type "#q" "relay"'],
  },
  { name: "clear", aliases: [], usage: "clear [target]", summary: "Clear an input or textarea", group: "interact", details: TARGET_HINT, examples: ["browser-relay clear 4"] },
  {
    name: "press",
    aliases: ["key", "keypress"],
    usage: "press <key>",
    summary: "Press a key via CDP (Enter, Tab, Escape, ArrowDown, ...)",
    group: "interact",
    examples: ["browser-relay press Enter"],
  },
  { name: "select", aliases: [], usage: "select <selector> <value>", summary: "Choose an option in a <select>", group: "interact", examples: ["browser-relay select '#plan' Team"] },
  { name: "scroll", aliases: [], usage: "scroll <down|up|left|right> [px]", summary: "Scroll the viewport (default 450px)", group: "interact", examples: ["browser-relay scroll down 800"] },
  { name: "zoom", aliases: [], usage: "zoom <level>", summary: "Set page zoom (125%, 1.5, reset)", group: "interact", examples: ["browser-relay zoom 125%"] },
  {
    name: "wait",
    aliases: [],
    usage: "wait <selector|text|ms>",
    summary: "Wait for a selector or text to appear, or sleep N ms",
    group: "interact",
    examples: ["browser-relay wait '#results'", "browser-relay wait 1500"],
  },
  { name: "screenshot", aliases: [], usage: "screenshot [output.png]", summary: "Save a PNG screenshot via CDP", group: "capture", examples: ["browser-relay screenshot page.png"] },
  { name: "pdf", aliases: ["print"], usage: "pdf [output.pdf]", summary: "Save the page as PDF via CDP", group: "capture", examples: ["browser-relay pdf report.pdf"] },
  {
    name: "download",
    aliases: [],
    usage: "download <url> [filename]",
    summary: "Download a URL with your logged-in Chrome cookies",
    group: "capture",
    examples: ["browser-relay download https://example.com/report.csv report.csv"],
  },
  {
    name: "upload",
    aliases: [],
    usage: "upload <selector> <files...>",
    summary: "Attach local files to a file input",
    group: "capture",
    examples: ["browser-relay upload 'input[type=file]' ./a.png ./b.png"],
  },
  {
    name: "save-dialog",
    aliases: ["confirm-dialog", "accept-dialog"],
    usage: "save-dialog [filename] [--cancel]",
    summary: "Confirm or cancel a native OS Save As dialog",
    group: "capture",
    options: [{ flags: "--cancel, -c", description: "Cancel instead of saving" }],
    examples: ["browser-relay save-dialog report.pdf", "browser-relay save-dialog --cancel"],
  },
  {
    name: "repl",
    aliases: ["interactive", "shell"],
    usage: "repl",
    summary: "Interactive shell sharing one broker connection",
    group: "automation",
    examples: ["browser-relay repl"],
  },
  {
    name: "batch",
    aliases: [],
    usage: "batch <file>",
    summary: "Run commands from a file in order (# lines are skipped)",
    group: "automation",
    examples: ["browser-relay batch checkout.relay --tab 42"],
  },
  {
    name: "agent",
    aliases: ["ask", "run"],
    usage: 'agent "<goal>"',
    summary: "Run the autonomous NVIDIA NIM browser agent and stream progress",
    group: "automation",
    examples: ['browser-relay agent "find the cheapest flight to Lisbon next Friday"'],
  },
  {
    name: "control",
    aliases: [],
    usage: "control <pause|resume|stop|restart|take_over|return_control> [instruction]",
    summary: "Control a run (defaults to $RELAY_RUN_ID / run_1)",
    group: "automation",
    examples: ["browser-relay control pause --run pipeline_7"],
  },
  {
    name: "monitor",
    aliases: [],
    usage: "monitor [--follow]",
    summary: "Show the action journal and optionally stream live broker events",
    group: "automation",
    options: [{ flags: "--follow, -f", description: "Keep streaming events until Ctrl+C" }],
    examples: ["browser-relay monitor --follow"],
  },
  { name: "reload-ext", aliases: [], usage: "reload-ext", summary: "Hot-reload the extension service worker", group: "automation", examples: ["browser-relay reload-ext"] },
];

export const GLOBAL_OPTIONS: Array<{ flags: string; description: string }> = [
  { flags: "--tab, -t <id>", description: "Target tab id (default $RELAY_TAB_ID, else the active tab)" },
  { flags: "--run, -r <id>", description: "Run/session id (default $RELAY_RUN_ID, else run_1)" },
  { flags: "--new-tab, -n", description: "Open the navigation target in a new tab" },
  { flags: "--background, -b", description: "Open/navigate tabs without stealing focus" },
  { flags: "--timeout, -T <ms>", description: "Action timeout (default 18000)" },
  { flags: "--broker <url>", description: "Broker WebSocket URL (default $RELAY_BROKER_URL, else ws://127.0.0.1:4098)" },
  { flags: "--json, -j", description: "Machine-readable output; errors print {\"ok\":false,\"error\":...}" },
  { flags: "--verbose, -v", description: "Verbose logging" },
  { flags: "--help, -h", description: "Help for the current command" },
  { flags: "--version, -V", description: "Print the CLI version" },
];

export const ENVIRONMENT: Array<{ name: string; description: string }> = [
  { name: "RELAY_BROKER_URL", description: "Broker WebSocket URL" },
  { name: "RELAY_AUTH_TOKEN", description: "Broker auth token, when the broker requires one" },
  { name: "RELAY_RUN_ID", description: "Stable run id for a pipeline (isolates sessions and leases)" },
  { name: "RELAY_TAB_ID", description: "Default tab for every command (pin a pipeline to its own tab)" },
  { name: "RELAY_BACKGROUND", description: "1 = never steal focus when opening/navigating tabs" },
  { name: "RELAY_ISOLATE_TAB", description: "1 = gateway/client opens its own background tab per agent" },
  { name: "RELAY_JSONL_CONCURRENCY", description: "Max in-flight requests per JSONL gateway (default 8)" },
];

const MULTI_AGENT_RECIPE = [
  "browser-relay new-tab https://example.com --background --json   # note tab_id",
  "export RELAY_RUN_ID=pipeline_a RELAY_TAB_ID=<tab_id>",
  "browser-relay snapshot && browser-relay click 3",
];

const EXIT_CODES = [
  { code: "0", description: "Success" },
  { code: "1", description: "Command failed, action failed, or doctor found a failing check" },
];

const byName = new Map<string, CommandSpec>();
for (const spec of COMMANDS) {
  byName.set(spec.name, spec);
  for (const alias of spec.aliases) byName.set(alias, spec);
}

export function resolveCommand(nameOrAlias: string): CommandSpec | undefined {
  return byName.get(nameOrAlias.toLowerCase());
}

export function allCommandNames(): string[] {
  return [...byName.keys()];
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

export function suggestCommands(input: string, limit = 3): string[] {
  const needle = input.toLowerCase();
  const threshold = Math.max(2, Math.floor(needle.length / 3));
  const scored = new Map<string, number>();
  for (const [name, spec] of byName) {
    const distance = name.startsWith(needle) && needle.length >= 2 ? 0 : editDistance(needle, name);
    if (distance > threshold) continue;
    const current = scored.get(spec.name);
    if (current === undefined || distance < current) scored.set(spec.name, distance);
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

export function unknownCommandMessage(command: string): string {
  const suggestions = suggestCommands(command);
  const hint = suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : "";
  return `Unknown command "${command}".${hint} Run "browser-relay help" for all commands.`;
}

function columns(rows: Array<[string, string]>, indent = 2, fixedWidth?: number): string {
  const width = fixedWidth ?? Math.min(40, Math.max(...rows.map(([left]) => left.length)) + 2);
  return rows
    .map(([left, right]) => {
      const pad = left.length >= width ? `\n${" ".repeat(indent + width)}` : " ".repeat(width - left.length);
      return `${" ".repeat(indent)}${left}${pad}${right}`;
    })
    .join("\n");
}

const OVERVIEW_WIDTH = 34;

export function renderOverview(version: string): string {
  const sections = COMMAND_GROUPS.map((group) => {
    const rows = COMMANDS.filter((c) => c.group === group.id).map(
      (c) => [c.usage, c.summary] as [string, string]
    );
    return `${group.title}\n${columns(rows, 2, OVERVIEW_WIDTH)}`;
  });

  return [
    `browser-relay ${version} — drive your real Chrome from the terminal, scripts and AI agents`,
    "",
    "USAGE",
    "  browser-relay <command> [args...] [options]      (alias: oc-relay)",
    "  browser-relay help <command>                     detailed help and examples",
    "",
    ...sections.flatMap((s) => [s, ""]),
    "GLOBAL OPTIONS",
    columns(GLOBAL_OPTIONS.map((o) => [o.flags, o.description]), 2, OVERVIEW_WIDTH),
    "",
    "ENVIRONMENT",
    columns(ENVIRONMENT.map((e) => [e.name, e.description]), 2, OVERVIEW_WIDTH),
    "",
    "PARALLEL PIPELINES (one tab per pipeline)",
    ...MULTI_AGENT_RECIPE.map((line) => `  ${line}`),
    "",
    "EXIT CODES",
    columns(EXIT_CODES.map((e) => [e.code, e.description]), 2, OVERVIEW_WIDTH),
    "",
    "First run? Start with: browser-relay doctor",
    "",
  ].join("\n");
}

export function renderCommandHelp(spec: CommandSpec): string {
  const lines = [`browser-relay ${spec.usage}`, "", `  ${spec.summary}`];
  if (spec.details) lines.push("", ...wrap(spec.details, 76).map((l) => `  ${l}`));
  if (spec.aliases.length) lines.push("", `ALIASES\n  ${spec.aliases.join(", ")}`);
  if (spec.options?.length) lines.push("", "OPTIONS", columns(spec.options.map((o) => [o.flags, o.description])));
  if (spec.examples.length) lines.push("", "EXAMPLES", ...spec.examples.map((e) => `  ${e}`));
  lines.push("", 'Global options (--tab, --run, --json, ...) apply too: see "browser-relay help".', "");
  return lines.join("\n");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

export function helpManifest(version: string) {
  return {
    name: "browser-relay",
    version,
    commands: COMMANDS.map(({ name, aliases, usage, summary, group, options, examples }) => ({
      name,
      aliases,
      usage,
      summary,
      group,
      options: options ?? [],
      examples,
    })),
    global_options: GLOBAL_OPTIONS,
    environment: ENVIRONMENT,
    exit_codes: EXIT_CODES,
  };
}
