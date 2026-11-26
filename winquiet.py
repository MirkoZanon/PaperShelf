"""winquiet.py - on Windows, programs PaperShelf starts in the background (git, PowerShell, pip...) must not open a
black console window that flashes on screen. Importing this module makes every subprocess hidden. Does nothing on macOS/Linux."""
from __future__ import annotations

import os
import subprocess

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_CONSOLE = 0x00000010


def install(popen=subprocess.Popen, nt: bool | None = None):
    """Wrap Popen.__init__ so children start without a window. Safe to call twice."""
    if not (os.name == "nt" if nt is None else nt) or getattr(popen, "_papershelf_quiet", False):
        return False
    orig = popen.__init__

    def init(self, *args, **kw):
        flags = kw.get("creationflags") or 0
        if not flags & (DETACHED_PROCESS | CREATE_NEW_CONSOLE):      # (a detached start-up already has no window)
            kw["creationflags"] = flags | CREATE_NO_WINDOW
        orig(self, *args, **kw)

    popen.__init__ = init
    popen._papershelf_quiet = True
    return True
