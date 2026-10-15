#!/usr/bin/env python3
"""
OpenCode Chrome Relay — Installer & Runner
Builds, installs, registers Windows Chrome Native Messaging Host,
configures the OpenCode plugin, and launches the Relay Broker.
"""

import os
import sys
import json
import time
import socket
import shutil
import subprocess
import winreg
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
TARGET_CONFIG = "debug"  # or "release"
HOST_NAME = "com.opencode.chrome_relay"
DEFAULT_EXTENSION_ID = "opencodechromerelayextensionid"
BROKER_PORT = int(os.environ.get("RELAY_PORT", "4098"))
BROKER_HOST = os.environ.get("RELAY_HOST", "127.0.0.1")

def log(msg, color="36"):
    # ANSI color output
    print(f"\033[{color}m[OpenCode Relay]\033[0m {msg}")

def run_command(cmd, cwd=ROOT_DIR, check=True):
    log(f"Executing: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    res = subprocess.run(cmd, cwd=str(cwd), shell=True)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {res.returncode}")
    return res.returncode

def check_port_open(host, port, timeout=2.0):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        try:
            s.connect((host, port))
            return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False

def build_components():
    log("Building Rust crates (relay-broker, relay-native-host)...", "33")
    run_command(["cargo", "build", "--workspace"])

    log("Building TypeScript packages & Chrome extension...", "33")
    run_command(["npm", "run", "build"])

def register_windows_native_host(extension_id=DEFAULT_EXTENSION_ID):
    log("Registering Chrome Native Messaging Host in Windows Registry...", "33")
    
    exe_path = ROOT_DIR / "target" / TARGET_CONFIG / "relay-native-host.exe"
    if not exe_path.exists():
        raise FileNotFoundError(f"Native host executable not found at {exe_path}")

    # Create destination directory in %LOCALAPPDATA%\OpenCode\Relay
    local_app_data = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    relay_install_dir = Path(local_app_data) / "OpenCode" / "Relay"
    relay_install_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = relay_install_dir / f"{HOST_NAME}.json"

    manifest_data = {
        "name": HOST_NAME,
        "description": "OpenCode Chrome Relay Native Messaging Host",
        "path": str(exe_path),
        "type": "stdio",
        "allowed_origins": [
            f"chrome-extension://{extension_id}/",
            # Include development unpacked origins
            "chrome-extension://*/"
        ]
    }

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    log(f"Wrote host manifest to: {manifest_path}", "32")

    # Register in HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome_relay
    reg_key_path = rf"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, reg_key_path, 0, winreg.KEY_WRITE) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
        log(f"Registered registry key HKCU\\{reg_key_path} -> {manifest_path}", "32")
    except Exception as e:
        log(f"Warning: Failed to set registry key via winreg: {e}. Falling back to powershell...", "31")
        ps_cmd = f'Set-ItemProperty -Path "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\{HOST_NAME}" -Name "(Default)" -Value "{manifest_path}" -Force'
        run_command(["powershell", "-Command", ps_cmd])

def install_opencode_plugin():
    log("Installing OpenCode plugin...", "33")
    plugin_dist = ROOT_DIR / "packages" / "opencode-plugin"

    # OpenCode plugin destination directory
    config_dir = Path.home() / ".config" / "opencode" / "plugins" / "opencode-chrome-relay"
    config_dir.mkdir(parents=True, exist_ok=True)

    # Copy built package files
    for item in ["package.json", "dist"]:
        src = plugin_dist / item
        dst = config_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    log(f"Plugin installed to: {config_dir}", "32")

def start_relay_broker():
    log("Checking Relay Broker status...", "33")
    if check_port_open(BROKER_HOST, BROKER_PORT):
        log(f"Relay Broker is already running on {BROKER_HOST}:{BROKER_PORT}!", "32")
        return None

    broker_exe = ROOT_DIR / "target" / TARGET_CONFIG / "relay-broker.exe"
    if not broker_exe.exists():
        raise FileNotFoundError(f"Broker executable not found at {broker_exe}")

    log(f"Launching Relay Broker: {broker_exe} ...", "33")
    env = os.environ.copy()
    env["RELAY_HOST"] = BROKER_HOST
    env["RELAY_PORT"] = str(BROKER_PORT)

    # Start detached background process on Windows
    DETACHED_PROCESS = 0x00000008
    proc = subprocess.Popen(
        [str(broker_exe)],
        cwd=str(ROOT_DIR),
        env=env,
        creationflags=DETACHED_PROCESS,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait up to 5 seconds for socket to open
    started = False
    for _ in range(25):
        time.sleep(0.2)
        if check_port_open(BROKER_HOST, BROKER_PORT):
            started = True
            break

    if started:
        log(f"Relay Broker successfully listening on ws://{BROKER_HOST}:{BROKER_PORT}", "32")
    else:
        log(f"Broker process launched (PID {proc.pid}), port verification pending.", "33")

    return proc

def main():
    log("=== OpenCode Chrome Relay: Install & Run ===", "35")
    try:
        # 1. Build components
        build_components()

        # 2. Register Windows Native Messaging Host
        register_windows_native_host()

        # 3. Install OpenCode Plugin
        install_opencode_plugin()

        # 4. Start Relay Broker
        start_relay_broker()

        log("Installation & launch complete!", "32")
        print("\n" + "=" * 60)
        print("  OPENCODE CHROME RELAY IS READY FOR OPERATION")
        print("=" * 60)
        print("1. Chrome Extension:")
        print(f"   - Open Chrome -> chrome://extensions")
        print("   - Enable 'Developer mode'")
        print(f"   - Click 'Load unpacked' and choose:")
        print(f"     {ROOT_DIR / 'apps' / 'chrome-extension'}")
        print("\n2. OpenCode CLI:")
        print(f"   - Run: opencode --plugin {ROOT_DIR / 'packages' / 'opencode-plugin'}")
        print("=" * 60 + "\n")

    except Exception as e:
        log(f"Error during installation/run: {e}", "31")
        sys.exit(1)

if __name__ == "__main__":
    main()
