import { execFileSync } from "node:child_process";

export interface NativeDialogOptions {
  // Full path (or bare name) to type into the dialog's file name box before saving
  filename?: string;
  // With no filename: save under this folder using the name Chrome suggested, made unique
  targetDir?: string;
  action?: "save" | "cancel";
  timeoutMs?: number;
}

export interface NativeDialogResult {
  dismissed: boolean;
  dialogFound: boolean;
  windowTitle?: string;
  className?: string;
  actionTaken?: "saved" | "cancelled" | "filename_set" | "none";
  savedPath?: string;
  error?: string;
}

/**
 * Executes a PowerShell script via UTF-16LE Base64 EncodedCommand.
 * This completely avoids shell escaping, quoting, and variable interpolation bugs.
 */
function runPowerShellScript(script: string, timeoutMs = 4000): string {
  const b64 = Buffer.from(script, "utf16le").toString("base64");
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64], {
      encoding: "utf-8",
      timeout: timeoutMs,
      windowsHide: true,
    });
    return out.trim();
  } catch (err: any) {
    return JSON.stringify({ dismissed: false, dialogFound: false, actionTaken: "none", error: err?.message || String(err) });
  }
}

// Values reach PowerShell base64-encoded, so no path or name can break out of its string
function psString(value: string): string {
  return `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value, "utf8").toString("base64")}')))`;
}

// Works on Chrome's Save As dialog through its stable Win32 controls: the file name Edit (control
// 1001) and the Save (IDOK) and Cancel (IDCANCEL) buttons. Only a visible standard dialog owned by
// chrome.exe and titled Save As qualifies; nothing is ever sent to another window. (UI Automation
// is not used: it doesn't expose these buttons, and its first "Edit" is a rename box in the file list.)
const DIALOG_HELPER = `
$ProgressPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class RelaySaveDialog {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  const uint WM_SETTEXT = 0x000C, WM_GETTEXT = 0x000D, WM_COMMAND = 0x0111;

  static string Cls(IntPtr h) { var s = new StringBuilder(64); GetClassName(h, s, 64); return s.ToString(); }
  static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }

  public static IntPtr Find(uint[] pids, string titleRegex) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Cls(h) == "#32770" && IsWindowVisible(h) && Array.IndexOf(pids, pid) >= 0 &&
          System.Text.RegularExpressions.Regex.IsMatch(Title(h), titleRegex)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static IntPtr Child(IntPtr dlg, string cls, int id) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dlg, (h, l) => {
      if (Cls(h) == cls && GetDlgCtrlID(h) == id && IsWindowVisible(h)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Title2(IntPtr dlg) { return Title(dlg); }

  public static string GetName(IntPtr dlg) {
    IntPtr edit = Child(dlg, "Edit", 1001);
    if (edit == IntPtr.Zero) return null;
    var s = new StringBuilder(1024); SendMessage(edit, WM_GETTEXT, (IntPtr)1024, s); return s.ToString();
  }

  public static bool SetName(IntPtr dlg, string name) {
    IntPtr edit = Child(dlg, "Edit", 1001);
    if (edit == IntPtr.Zero) return false;
    SendMessage(edit, WM_SETTEXT, IntPtr.Zero, name);
    return true;
  }

  public static bool Press(IntPtr dlg, int id) {
    IntPtr button = Child(dlg, "Button", id);
    if (button == IntPtr.Zero) return false;
    return PostMessage(dlg, WM_COMMAND, (IntPtr)id, button);
  }
}
"@
$chromePids = [uint32[]]@(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$dlg = [RelaySaveDialog]::Find($chromePids, '^(Save As|Save as|Speichern unter|Enregistrer sous|Guardar como|Salva con nome)$')
`;

export function isNativeDialogActive(): boolean {
  if (process.platform !== "win32") return false;
  // Compiling the Win32 helper takes a few seconds on a cold PowerShell
  const res = runPowerShellScript(`${DIALOG_HELPER}\nif ($dlg -ne [IntPtr]::Zero) { 'YES' } else { 'NO' }`, 12000);
  return res === "YES";
}

/**
 * Answers Chrome's Save As dialog: sets the file name if asked, then presses Save or Cancel.
 */
export function dismissNativeSaveDialog(options: NativeDialogOptions = {}): NativeDialogResult {
  const action = options.action || "save";

  if (process.platform === "win32") {
    const script = `${DIALOG_HELPER}
function Out($o) { $o | ConvertTo-Json -Compress; exit 0 }
if ($dlg -eq [IntPtr]::Zero) { Out @{ dismissed = $false; dialogFound = $false; actionTaken = 'none' } }
$title = [RelaySaveDialog]::Title2($dlg)
$wanted = ${psString(options.filename || "")}
$dir = ${psString(options.targetDir || "")}

if (${action === "save" ? "$true" : "$false"}) {
  if (-not $wanted -and $dir) {
    $suggested = [RelaySaveDialog]::GetName($dlg)
    $name = if ($suggested) { [IO.Path]::GetFileName($suggested) } else { 'download' }
    $base = [IO.Path]::GetFileNameWithoutExtension($name)
    $ext = [IO.Path]::GetExtension($name)
    $wanted = Join-Path $dir $name
    $n = 1
    while (Test-Path -LiteralPath $wanted) { $wanted = Join-Path $dir ('{0} ({1}){2}' -f $base, $n, $ext); $n++ }
  }
  if ($wanted -and -not [RelaySaveDialog]::SetName($dlg, $wanted)) {
    Out @{ dismissed = $false; dialogFound = $true; windowTitle = $title; actionTaken = 'none'; error = 'File name box not found' }
  }
  if ([RelaySaveDialog]::Press($dlg, 1)) {
    Out @{ dismissed = $true; dialogFound = $true; windowTitle = $title; className = '#32770'; actionTaken = 'saved'; savedPath = $wanted }
  }
} elseif ([RelaySaveDialog]::Press($dlg, 2)) {
  Out @{ dismissed = $true; dialogFound = $true; windowTitle = $title; className = '#32770'; actionTaken = 'cancelled' }
}
Out @{ dismissed = $false; dialogFound = $true; windowTitle = $title; actionTaken = 'none'; error = 'Save/Cancel button not found' }
`;
    const res = runPowerShellScript(script, options.timeoutMs || 15000);
    try {
      return JSON.parse(res);
    } catch {
      return { dismissed: false, dialogFound: false, actionTaken: "none", error: res || "No output from PowerShell" };
    }
  }

  // Explicit `save-dialog` command only: these send one keystroke to the frontmost app
  if (process.platform === "darwin") {
    try {
      const key = action === "cancel" ? "key code 53" : "keystroke return";
      execFileSync("osascript", ["-e", `tell application "System Events" to ${key}`], { timeout: 2500 });
      return { dismissed: true, dialogFound: true, actionTaken: action === "cancel" ? "cancelled" : "saved" };
    } catch {
      return { dismissed: false, dialogFound: false, actionTaken: "none" };
    }
  }

  if (process.platform === "linux") {
    try {
      const key = action === "cancel" ? "Escape" : "Return";
      execFileSync("xdotool", ["key", key], { timeout: 2500 });
      return { dismissed: true, dialogFound: true, actionTaken: action === "cancel" ? "cancelled" : "saved" };
    } catch {
      return { dismissed: false, dialogFound: false, actionTaken: "none" };
    }
  }

  return { dismissed: false, dialogFound: false, actionTaken: "none" };
}
