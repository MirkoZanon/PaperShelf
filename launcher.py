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


# --------------------------------------------------------------------------- installed app (PWA)
# Chrome, Edge and Brave can install PaperShelf as a real app ("Install PaperShelf"): it gets its own
# icon in the Dock / taskbar, a dot while it is open, focuses its window when clicked again, and has
# Quit in its menu. When installed, PaperShelf opens that app instead of a browser window.
def installed_app() -> str | None:
    home = Path.home()
    if sys.platform == "darwin":
        for d in sorted((home / "Applications").glob("*Apps*")):
            app = d / "PaperShelf.app"
            if app.exists():
                return str(app)
        return None
    if os.name == "nt":
        progs = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
        for sub in ("Chrome Apps", "Brave Apps", "Chromium Apps"):
            lnk = progs / sub / "PaperShelf.lnk"
            if lnk.exists():
                return str(lnk)
        return None
    for f in (home / ".local" / "share" / "applications").glob("*-Default.desktop"):
        try:
            if "Name=PaperShelf" in f.read_text(encoding="utf-8", errors="ignore"):
                return str(f)
        except OSError:
            continue
    return None


def open_installed(path: str) -> bool:
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-a", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif os.name == "nt":
            os.startfile(path)  # noqa: S606 - the app's own shortcut
        else:
            exec_line = next((l[5:] for l in Path(path).read_text(encoding="utf-8").splitlines() if l.startswith("Exec=")), "")
            if not exec_line:
                return False
            subprocess.Popen(exec_line.replace("%U", "").replace("%u", "").split(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


def open_in_browser_tab(url: str) -> str:
    """Open the page in a normal tab of a browser that can install apps (to install PaperShelf)."""
    b = app_browser()
    try:
        if b and sys.platform == "darwin":
            subprocess.Popen(["open", "-a", b, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return b
        if b:
            subprocess.Popen([b, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return Path(b).stem
    except OSError:
        pass
    webbrowser.open(url)
    return ""


def open_ui(url: str, own_window: bool = True) -> str:
    """Open the PaperShelf page. Returns 'app', 'window' or 'browser'."""
    inst = installed_app() if own_window else None
    if inst and open_installed(inst):
        return "app"
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


LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"


def _mac_bundle(dest: Path, port: int, log: Path, version: str) -> Path:
    """The launcher app. Written in place (an icon already in the Dock keeps working)."""
    app = dest / "PaperShelf.app"
    (app / "Contents" / "MacOS").mkdir(parents=True, exist_ok=True)
    (app / "Contents" / "Resources").mkdir(parents=True, exist_ok=True)
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
            # papershelf://start – the "Start PaperShelf" button shown by the installed app when PaperShelf isn't running
            "CFBundleURLTypes": [{"CFBundleURLName": "PaperShelf", "CFBundleURLSchemes": ["papershelf"]}],
        }, f)
    os.utime(app, None)  # Finder refreshes the icon
    if os.path.exists(LSREGISTER):
        subprocess.run([LSREGISTER, "-f", str(app)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    return app


def refresh_launchers(port: int, log: Path, version: str) -> list[str]:
    """After an update: give the launcher icons you already have the new look and features."""
    done = []
    if sys.platform == "darwin":
        for dest in (Path.home() / "Applications", Path.home() / "Desktop"):
            script = dest / "PaperShelf.app" / "Contents" / "MacOS" / "PaperShelf"
            try:
                if script.exists() and "PaperShelf launcher" in script.read_text(encoding="utf-8", errors="ignore"):
                    plist = dest / "PaperShelf.app" / "Contents" / "Info.plist"
                    with open(plist, "rb") as f:
                        old = plistlib.load(f)
                    icon_same = (ICONS / "PaperShelf.icns").read_bytes() == \
                        (dest / "PaperShelf.app" / "Contents" / "Resources" / "PaperShelf.icns").read_bytes()
                    if old.get("CFBundleShortVersionString") != version or not icon_same:
                        _mac_bundle(dest, port, log, version)
                        done.append(str(dest / "PaperShelf.app"))
            except (OSError, ValueError, plistlib.InvalidFileException):
                continue
    elif os.name == "nt":
        try:
            _win_url_scheme(port)
        except OSError:
            pass
    return done


def _win_url_scheme(port: int):
    """papershelf://start starts PaperShelf (used by the installed app when PaperShelf isn't running)."""
    import winreg  # noqa: PLC0415 - Windows only
    pyw = APP_DIR / ".venv" / "Scripts" / "pythonw.exe"
    target = pyw if pyw.exists() else Path(sys.executable).with_name("pythonw.exe")
    cmd = f'"{target}" "{APP_DIR / "app.py"}" --port {int(port)}'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\papershelf") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:PaperShelf")
        winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\papershelf\shell\open\command") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, cmd)


# --------------------------------------------------------------------------- start at login
AGENT = Path.home() / "Library" / "LaunchAgents" / "io.github.mirkozanon.papershelf.plist"


def _autostart_paths():
    if sys.platform == "darwin":
        return AGENT
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "PaperShelf.lnk"
    return Path.home() / ".config" / "autostart" / "papershelf.desktop"


def autostart_enabled() -> bool:
    return _autostart_paths().exists()


def set_autostart(on: bool, port: int, log: Path) -> bool:
    """Start PaperShelf quietly in the background when you log in (no window)."""
    path = _autostart_paths()
    if not on:
        if path.exists():
            path.unlink()
        return False
    py = APP_DIR / ".venv" / "bin" / "python"
    if sys.platform == "darwin":
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            plistlib.dump({"Label": "io.github.mirkozanon.papershelf",
                           "ProgramArguments": [str(py if py.exists() else sys.executable), str(APP_DIR / "app.py"),
                                                "--port", str(int(port)), "--no-browser"],
                           "WorkingDirectory": str(APP_DIR), "RunAtLoad": True,
                           "StandardOutPath": str(log), "StandardErrorPath": str(log)}, f)
        return True
    if os.name == "nt":
        pyw = APP_DIR / ".venv" / "Scripts" / "pythonw.exe"
        target = pyw if pyw.exists() else Path(sys.executable).with_name("pythonw.exe")
        ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);$s.TargetPath=%s;$s.Arguments=%s;"
              "$s.WorkingDirectory=%s;$s.WindowStyle=7;$s.Save()") % (
            _psq(path), _psq(target), _psq(f'"{APP_DIR / "app.py"}" --port {int(port)} --no-browser'), _psq(APP_DIR))
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, timeout=60, check=True)
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("[Desktop Entry]\nType=Application\nName=PaperShelf (background)\n"
                    f"Exec=\"{py if py.exists() else sys.executable}\" \"{APP_DIR / 'app.py'}\" --port {int(port)} --no-browser\n"
                    f"Path={APP_DIR}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n", encoding="utf-8")
    return True


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
    try:
        _win_url_scheme(port)
    except OSError:
        pass
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
                     f"Path={APP_DIR}\nIcon={ICONS / 'icon-512.png'}\nTerminal=false\nCategories=Office;Education;\n"
                     "MimeType=x-scheme-handler/papershelf;\n",
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
