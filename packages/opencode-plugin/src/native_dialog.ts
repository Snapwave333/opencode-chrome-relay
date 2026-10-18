import { execFileSync } from "node:child_process";

export interface NativeDialogOptions {
  filename?: string;
  action?: "save" | "cancel";
  timeoutMs?: number;
}

export interface NativeDialogResult {
  dismissed: boolean;
  dialogFound: boolean;
  windowTitle?: string;
  className?: string;
  actionTaken?: "saved" | "cancelled" | "filename_set" | "none";
  error?: string;
}

/**
 * Executes a PowerShell script via UTF-16LE Base64 EncodedCommand.
 * This completely avoids shell escaping, quoting, and variable interpolation bugs.
 */
function runPowerShellScript(script: string, timeoutMs = 4000): string {
  const b64 = Buffer.from(script, "utf16le").toString("base64");
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64],
      {
        encoding: "utf-8",
        timeout: timeoutMs,
        windowsHide: true,
      }
    );
    return out.trim();
  } catch (err: any) {
    return "";
  }
}

/**
 * Checks if a native OS Save As / Open / Download dialog is currently active.
 */
export function isNativeDialogActive(): boolean {
  if (process.platform === "win32") {
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$cond = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window
)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  $cond
)

foreach ($w in $windows) {
  try {
    $name = $w.Current.Name
    $cls = $w.Current.ClassName
    if ($cls -eq '#32770' -or $name -match 'Save|Speichern|Enregistrer|Guardar|Salva|Download|Open') {
      Write-Output "YES"
      exit 0
    }
  } catch {}
}

# Fallback check with WScript
$wsh = New-Object -ComObject WScript.Shell
if ($wsh.AppActivate('Save As') -or $wsh.AppActivate('Save') -or $wsh.AppActivate('Open')) {
  Write-Output "YES"
} else {
  Write-Output "NO"
}
`;
    const res = runPowerShellScript(script, 2500);
    return res.includes("YES");
  }
  return false;
}

/**
 * Dismisses or confirms a native OS Save As / Download dialogue box.
 * Automatically finds the dialog, sets filename if supplied, and clicks Save/OK or presses Enter.
 */
export function dismissNativeSaveDialog(options: NativeDialogOptions = {}): NativeDialogResult {
  const action = options.action || "save";

  if (process.platform === "win32") {
    const escapedFilename = (options.filename || "").replace(/["'\\]/g, "");
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$cond = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window
)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  $cond
)

$target = $null
foreach ($w in $windows) {
  try {
    $name = $w.Current.Name
    $cls = $w.Current.ClassName
    if ($cls -eq '#32770' -or $name -match 'Save|Speichern|Enregistrer|Guardar|Salva|Download|Open') {
      $target = $w
      break
    }
  } catch {}
}

if (-not $target) {
  # Fallback via WScript.Shell
  $wsh = New-Object -ComObject WScript.Shell
  if ($wsh.AppActivate('Save As') -or $wsh.AppActivate('Save') -or $wsh.AppActivate('Confirm Save As') -or $wsh.AppActivate('Open')) {
    Start-Sleep -Milliseconds 150
    if ('${action}' -eq 'cancel') {
      $wsh.SendKeys('{ESC}')
      Write-Output '{"dismissed":true,"dialogFound":true,"windowTitle":"Save As","actionTaken":"cancelled"}'
    } else {
      $wsh.SendKeys('{ENTER}')
      Write-Output '{"dismissed":true,"dialogFound":true,"windowTitle":"Save As","actionTaken":"saved"}'
    }
    exit 0
  }
  Write-Output '{"dismissed":false,"dialogFound":false,"actionTaken":"none"}'
  exit 0
}

$winTitle = $target.Current.Name
$winClass = $target.Current.ClassName

# If filename is provided, find the Edit box and set the filename
if ('${escapedFilename}' -ne '') {
  try {
    $editCond = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $edit = $target.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
    if ($edit) {
      $valuePattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]
      if ($valuePattern) {
        $valuePattern.SetValue('${escapedFilename}')
      }
    }
  } catch {}
}

# Find action button (Save/Open or Cancel)
$btnCond = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = $target.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)

$chosenBtn = $null
$btnRegex = if ('${action}' -eq 'cancel') { 'Cancel|Abbrechen|Annuler|Cancelar|Annulla' } else { 'Save|Speichern|Enregistrer|Guardar|Salva|Open|OK|Ja|Yes' }

foreach ($b in $buttons) {
  try {
    if ($b.Current.Name -match $btnRegex) {
      $chosenBtn = $b
      break
    }
  } catch {}
}

$actionTakenStr = if ('${action}' -eq 'cancel') { 'cancelled' } else { 'saved' }

if ($chosenBtn) {
  try {
    $inv = $chosenBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
    if ($inv) {
      $inv.Invoke()
      Write-Output ('{"dismissed":true,"dialogFound":true,"windowTitle":"' + $winTitle + '","className":"' + $winClass + '","actionTaken":"' + $actionTakenStr + '"}')
      exit 0
    }
  } catch {}
}

# Fallback: Focus window and send keystroke
try {
  $target.SetFocus()
  Start-Sleep -Milliseconds 120
  if ('${action}' -eq 'cancel') {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  } else {
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  Write-Output ('{"dismissed":true,"dialogFound":true,"windowTitle":"' + $winTitle + '","className":"' + $winClass + '","actionTaken":"' + $actionTakenStr + '"}')
} catch {
  Write-Output '{"dismissed":false,"dialogFound":true,"actionTaken":"none","error":"Failed to send key to dialog"}'
}
`;
    const res = runPowerShellScript(script, options.timeoutMs || 4500);
    try {
      const parsed = JSON.parse(res);
      return parsed;
    } catch {
      return {
        dismissed: res.includes('"dismissed":true'),
        dialogFound: res.includes('"dialogFound":true'),
        actionTaken: action === "cancel" ? "cancelled" : "saved",
      };
    }
  }

  if (process.platform === "darwin") {
    try {
      const key = action === "cancel" ? "key code 53" : "keystroke return";
      execFileSync("osascript", ["-e", `tell application "System Events" to ${key}`], {
        timeout: 2500,
      });
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
