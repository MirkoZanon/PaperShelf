"""Opening PaperShelf in its own window, and creating a PaperShelf icon (Desktop / Applications / Dock).

* open_ui(url): if Chrome, Edge, Brave or Chromium is installed, PaperShelf opens in an "app window"
  (its own window with the PaperShelf name, no address bar); otherwise in the default browser.
* create_shortcut(): makes a clickable PaperShelf icon that starts PaperShelf in the background
  (no Terminal window) and opens its window:
    - Mac: ~/Applications/PaperShelf.app (and a copy on the Desktop) – drag it to the Dock to keep it there;
    - Windows: shortcuts on the Desktop and in the Start menu – right-click → Pin to taskbar;
    - Linux: an entry in the applications menu.
  While running in the background, PaperShelf is stopped with ⚙︎ Settings → Quit PaperShelf.
"""
from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
ICONS = APP_DIR / "static" / "icons"

MAC_BROWSERS = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium", "Vivaldi", "Arc"]
WIN_BROWSERS = [
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe",
]
LINUX_BROWSERS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]


# --------------------------------------------------------------------------- window
def app_browser() -> str | None:
    """A browser that can show PaperShelf in its own window (Chromium-based), if installed."""
    if sys.platform == "darwin":
        for name in MAC_BROWSERS:
            for base in (Path("/Applications"), Path.home() / "Applications"):
                if (base / f"{name}.app").exists():
                    return name
        return None
    if os.name == "nt":
        for p in WIN_BROWSERS:
            path = os.path.expandvars(p)
            if os.path.exists(path):
                return path
        return None
    for name in LINUX_BROWSERS:
        if shutil.which(name):
            return shutil.which(name)
    return None


def open_ui(url: str, own_window: bool = True) -> str:
    """Open the PaperShelf page. Returns 'window' or 'browser'."""
    b = app_browser() if own_window else None
    if b:
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", "-na", b, "--args", f"--app={url}"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.Popen([b, f"--app={url}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return "window"
        except OSError:
            pass
    webbrowser.open(url)
    return "browser"


# --------------------------------------------------------------------------- icon / shortcut
MAC_SCRIPT = r"""#!/bin/bash
# PaperShelf launcher – created by PaperShelf (Settings → App icon).
# Starts PaperShelf in the background (or just opens its window if it is already running).
APP_DIR={app_dir}
PORT={port}
LOG={log}
if [ ! -f "$APP_DIR/app.py" ]; then
  osascript -e 'display alert "PaperShelf" message "The PaperShelf folder was moved or deleted. Start it once with start.command in its new place, then create the icon again (Settings → App icon)."'
  exit 1
fi
cd "$APP_DIR" || exit 1
# first start, or new libraries to install: do it in a Terminal window so you can see it
if [ ! -x .venv/bin/python ] || ! cmp -s requirements.txt .venv/requirements.installed; then
  open -a Terminal "$APP_DIR/start.command"
  exit 0
fi
# a git copy fetches the latest version, like start.command does
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet >/dev/null 2>&1
  if ! cmp -s requirements.txt .venv/requirements.installed; then open -a Terminal "$APP_DIR/start.command"; exit 0; fi
fi
mkdir -p "$(dirname "$LOG")"
nohup ./.venv/bin/python app.py --port "$PORT" >> "$LOG" 2>&1 &
exit 0
"""


def _q(s) -> str:
    return "'" + str(s).replace("'", "'\"'\"'") + "'"


def _mac_bundle(dest: Path, port: int, log: Path, version: str) -> Path:
    app = dest / "PaperShelf.app"
    if app.exists():
        shutil.rmtree(app)
    (app / "Contents" / "MacOS").mkdir(parents=True)
    (app / "Contents" / "Resources").mkdir(parents=True)
    script = app / "Contents" / "MacOS" / "PaperShelf"
    script.write_text(MAC_SCRIPT.format(app_dir=_q(APP_DIR), port=int(port), log=_q(log)), encoding="utf-8")
    script.chmod(0o755)
    shutil.copyfile(ICONS / "PaperShelf.icns", app / "Contents" / "Resources" / "PaperShelf.icns")
    with open(app / "Contents" / "Info.plist", "wb") as f:
        plistlib.dump({
            "CFBundleName": "PaperShelf", "CFBundleDisplayName": "PaperShelf",
            "CFBundleIdentifier": "io.github.mirkozanon.papershelf.launcher",
            "CFBundleExecutable": "PaperShelf", "CFBundleIconFile": "PaperShelf",
            "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version, "CFBundleVersion": version,
            "LSMinimumSystemVersion": "10.13", "NSHighResolutionCapable": True,
        }, f)
    os.utime(app, None)  # Finder refreshes the icon
    return app


def _win_shortcuts(port: int) -> list[str]:
    pyw = APP_DIR / ".venv" / "Scripts" / "pythonw.exe"
    target = pyw if pyw.exists() else Path(sys.executable).with_name("pythonw.exe")
    if not target.exists():
        target = Path(sys.executable)
    made = []
    for folder in ("Desktop", "Programs"):
        ps = (
            "$f=[Environment]::GetFolderPath('%s');"
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $f 'PaperShelf.lnk'));"
            "$s.TargetPath=%s;$s.Arguments=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;"
            "$s.Description='PaperShelf – your library of scientific papers';$s.Save();Write-Output (Join-Path $f 'PaperShelf.lnk')"
        ) % (folder, _psq(target), _psq(f'"{APP_DIR / "app.py"}" --port {int(port)}'), _psq(APP_DIR),
             _psq(ICONS / "PaperShelf.ico"))
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and r.stdout.strip():
            made.append(r.stdout.strip().splitlines()[-1])
    if not made:
        raise OSError("Windows did not allow creating the shortcuts.")
    return made


def _psq(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def _linux_entry(port: int) -> list[str]:
    d = Path.home() / ".local" / "share" / "applications"
    d.mkdir(parents=True, exist_ok=True)
    py = APP_DIR / ".venv" / "bin" / "python"
    entry = d / "papershelf.desktop"
    entry.write_text("[Desktop Entry]\nType=Application\nName=PaperShelf\nComment=Your library of scientific papers\n"
                     f"Exec=\"{py if py.exists() else sys.executable}\" \"{APP_DIR / 'app.py'}\" --port {int(port)}\n"
                     f"Path={APP_DIR}\nIcon={ICONS / 'icon-512.png'}\nTerminal=false\nCategories=Office;Education;\n",
                     encoding="utf-8")
    entry.chmod(0o755)
    return [str(entry)]


def create_shortcut(port: int, log: Path, version: str, desktop: bool = True) -> dict:
    """Create the PaperShelf icon for this computer. Returns {"made": [paths], "hint": text}."""
    if sys.platform == "darwin":
        apps = Path.home() / "Applications"
        apps.mkdir(exist_ok=True)
        made = [str(_mac_bundle(apps, port, log, version))]
        warn = ""
        if desktop:
            try:
                made.append(str(_mac_bundle(Path.home() / "Desktop", port, log, version)))
            except OSError as exc:
                warn = f" (The Desktop copy could not be created: {exc.strerror or exc}.)"
        try:
            subprocess.Popen(["open", "-R", made[0]])
        except OSError:
            pass
        return {"made": made, "hint": "A Finder window shows PaperShelf in your Applications folder: drag it onto the "
                                      "Dock to keep it there. You can also find it with Spotlight (⌘ Space → PaperShelf)." + warn}
    if os.name == "nt":
        return {"made": _win_shortcuts(port),
                "hint": "PaperShelf is on your Desktop and in the Start menu. To keep it in the taskbar: open the Start "
                        "menu, right-click PaperShelf → Pin to taskbar."}
    return {"made": _linux_entry(port), "hint": "PaperShelf is now in your applications menu."}
