"""labcal.py - the lab calendar: .ics files (for Apple Calendar, Google Calendar, Outlook), reminder times and
desktop notifications. Pure functions where possible; nothing here talks to the internet.

An "item" is a dict: {key, group, group_name, type: event|task|plan, id, title, kind, date, start, end, place, desc,
remind (minutes or -1), mine, status}."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta

DAY_REMINDER_HOUR = 9        # all-day items remind at 09:00 (minus the chosen lead time)
FIRE_WINDOW = timedelta(minutes=30)   # a reminder missed by less than this (computer asleep, app closed) is still shown


def _dt(date: str, hm: str = "") -> datetime | None:
    try:
        return datetime.strptime(f"{date} {hm or '00:00'}", "%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return None


def starts_at(it: dict) -> datetime | None:
    d = _dt(it.get("date") or "", it.get("start") or "")
    return d


def fire_time(it: dict) -> datetime | None:
    """When the reminder of an item goes off (local time), or None if it has none."""
    d = _dt(it.get("date") or "")
    if not d:
        return None
    if it["type"] == "event":
        n = it.get("remind", -1)
        if n is None or n < 0:
            return None
        base = _dt(it["date"], it.get("start") or f"{DAY_REMINDER_HOUR:02d}:00")
        return base - timedelta(minutes=n) if base else None
    # tasks and plans: the morning of the deadline
    return d.replace(hour=DAY_REMINDER_HOUR)


def due_now(items: list, now: datetime, done: dict) -> list:
    """Items whose reminder time has come (and not longer ago than FIRE_WINDOW) and that were not shown yet."""
    out = []
    for it in items:
        if not it.get("mine"):
            continue
        if it["type"] != "event" and it.get("status") == "done":
            continue
        f = fire_time(it)
        win = FIRE_WINDOW if it["type"] == "event" else timedelta(hours=14)    # a deadline reminder is still shown later that day
        if f and f <= now < f + win and (it["key"] + "@" + f.isoformat()) not in done:
            out.append({**it, "fire": f.isoformat(), "nkey": it["key"] + "@" + f.isoformat()})
    return out


def describe(it: dict) -> tuple[str, str]:
    """(title, text) of the notification."""
    when = ""
    if it["type"] == "event":
        when = (f"{it.get('start')}" + (f"–{it['end']}" if it.get("end") else "")) if it.get("start") else "today"
        title = {"experiment": "Experiment", "meeting": "Meeting", "deadline": "Deadline"}.get(it.get("kind"), "Event") + ": " + (it.get("title") or "")
        text = f"{when} · {it['group_name']}" + (f" · {it['place']}" if it.get("place") else "")
    else:
        title = {"plan": "Plan due today: ", "note": "Document task due today: ", "step": "Step due today: "}.get(it["type"], "Task due today: ") + (it.get("title") or "")
        text = it["group_name"]
    return title[:120], text[:200]


# --------------------------------------------------------------------------- .ics
def _esc(t) -> str:
    return str(t or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\n").replace("\n", "\\n")


def _fold(line: str) -> str:
    raw, out = line.encode("utf-8"), []
    while len(raw) > 74:
        cut = 74
        while cut > 0 and (raw[cut] & 0xC0) == 0x80:     # never cut inside a UTF-8 character
            cut -= 1
        out.append(raw[:cut].decode("utf-8"))
        raw = b" " + raw[cut:]
    out.append(raw.decode("utf-8"))
    return "\r\n".join(out)


def ics(items: list, name: str = "PaperShelf lab") -> str:
    """A calendar file. Times are 'floating' (the same wall-clock time wherever it is opened)."""
    L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PaperShelf//Lab calendar//EN", "CALSCALE:GREGORIAN",
         "X-WR-CALNAME:" + _esc(name)]
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    for it in items:
        d = _dt(it.get("date") or "")
        if not d:
            continue
        L += ["BEGIN:VEVENT", f"UID:{it['key'].replace('|', '-')}@papershelf", f"DTSTAMP:{stamp}"]
        st = starts_at(it) if it.get("start") else None
        if st:
            en = _dt(it["date"], it.get("end") or "") if it.get("end") else None
            if not en or en <= st:
                en = st + timedelta(hours=1)
            L += [f"DTSTART:{st:%Y%m%dT%H%M%S}", f"DTEND:{en:%Y%m%dT%H%M%S}"]
        else:
            L += [f"DTSTART;VALUE=DATE:{d:%Y%m%d}", f"DTEND;VALUE=DATE:{(d + timedelta(days=1)):%Y%m%d}"]
        title = it.get("title") or "Event"
        if it["type"] in ("task", "note", "step"):
            title = "Due: " + title
        elif it["type"] == "plan":
            title = "Plan due: " + title
        L.append("SUMMARY:" + _esc(title))
        desc = (it.get("desc") or "") + (("\n" if it.get("desc") else "") + "Group: " + it["group_name"] if it.get("group_name") else "")
        if desc:
            L.append("DESCRIPTION:" + _esc(desc))
        if it.get("place"):
            L.append("LOCATION:" + _esc(it["place"]))
        L.append("CATEGORIES:" + _esc((it.get("kind") or it["type"]).title()))
        f = fire_time(it) if it["type"] == "event" else None
        if f and it["type"] == "event":
            n = it.get("remind", -1)
            L += ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + _esc(title), f"TRIGGER:-PT{int(n)}M", "END:VALARM"]
        L.append("END:VEVENT")
    L.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in L) + "\r\n"


# --------------------------------------------------------------------------- desktop notification (no browser open)
def os_notify(title: str, text: str) -> bool:
    """A notification of the operating system, for when PaperShelf runs in the background without a window."""
    try:
        if sys.platform == "darwin":
            q = lambda t: str(t).replace("\\", "\\\\").replace('"', '\\"')
            subprocess.run(["osascript", "-e", f'display notification "{q(text)}" with title "{q(title)}"'], capture_output=True, timeout=15)
            return True
        if os.name == "nt":
            x = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "''")
            ps = ("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;"
                  "$x = New-Object Windows.Data.Xml.Dom.XmlDocument;"
                  f"$x.LoadXml('<toast><visual><binding template=\"ToastText02\"><text id=\"1\">{x(title)}</text><text id=\"2\">{x(text)}</text></binding></visual></toast>');"
                  "$id='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
                  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))")
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, timeout=30)
            return True
        if shutil.which("notify-send"):
            subprocess.run(["notify-send", "PaperShelf: " + title, text], capture_output=True, timeout=15)
            return True
    except (OSError, subprocess.SubprocessError):
        pass
    return False
