"""ghlogin.py - "Sign in with GitHub" (the device flow), so nobody has to create or copy a token.

PaperShelf shows a short code, you approve it on github.com (with your normal login and 2-step check),
and GitHub hands this computer a token. The token is kept only on this computer. Nothing about you is
sent anywhere except to GitHub itself.

The only thing needed is the public "Client ID" of a free GitHub OAuth App (device flow turned on),
read from github.json or set in Settings. It is not a secret.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

APP_DIR = Path(__file__).resolve().parent
API = "https://api.github.com"
LIBRARY_REPO = "papershelf-library"
SCOPE = "gist repo"      # gist: your groups; repo: your private library repository
_PENDING: dict = {}      # device_code kept here, never sent to the page


class LoginError(Exception):
    pass


def client_id(settings: dict | None = None) -> str:
    cid = ((settings or {}).get("github_client_id") or "").strip()
    if not cid:
        try:
            cid = str(json.loads((APP_DIR / "github.json").read_text("utf-8")).get("client_id") or "").strip()
        except (OSError, ValueError):
            cid = ""
    return cid if cid.replace("_", "").replace("-", "").isalnum() else ""


def _post(url, data):
    try:
        r = requests.post(url, data=data, headers={"Accept": "application/json", "User-Agent": "PaperShelf-login"}, timeout=20)
    except requests.exceptions.RequestException as exc:
        raise LoginError(f"Could not reach GitHub ({exc.__class__.__name__}). Check your internet connection.") from exc
    try:
        return r.json()
    except ValueError:
        raise LoginError(f"GitHub answered {r.status_code}.")


def start(cid: str) -> dict:
    d = _post("https://github.com/login/device/code", {"client_id": cid, "scope": SCOPE})
    if d.get("error") or not d.get("device_code"):
        msg = d.get("error_description") or d.get("error") or "unknown problem"
        raise LoginError(f"GitHub refused the sign-in: {msg} (check the Client ID, and that “Enable Device Flow” is ticked in the OAuth app).")
    key = d["user_code"]
    _PENDING.clear()
    _PENDING[key] = {"device": d["device_code"], "cid": cid, "interval": int(d.get("interval") or 5),
                     "until": time.time() + int(d.get("expires_in") or 900)}
    return {"code": key, "url": d.get("verification_uri") or "https://github.com/login/device",
            "interval": _PENDING[key]["interval"], "expires": int(d.get("expires_in") or 900)}


def poll(code: str) -> dict:
    """{'status': 'wait'|'slow'|'ok'|'denied'|'expired', 'token': ...}"""
    p = _PENDING.get(code)
    if not p or time.time() > p["until"]:
        _PENDING.pop(code, None)
        return {"status": "expired"}
    d = _post("https://github.com/login/oauth/access_token", {
        "client_id": p["cid"], "device_code": p["device"], "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})
    if d.get("access_token"):
        _PENDING.pop(code, None)
        return {"status": "ok", "token": d["access_token"]}
    err = d.get("error")
    if err == "authorization_pending":
        return {"status": "wait"}
    if err == "slow_down":
        p["interval"] += 5
        return {"status": "slow", "interval": p["interval"]}
    _PENDING.pop(code, None)
    return {"status": "denied" if err == "access_denied" else "expired", "error": d.get("error_description") or err or ""}


def ensure_library_repo(token: str, user: str) -> str:
    """Your private papershelf-library repository: found, or created. Returns its https address."""
    h = {"Accept": "application/vnd.github+json", "User-Agent": "PaperShelf-login", "Authorization": f"Bearer {token}"}
    try:
        r = requests.get(f"{API}/repos/{user}/{LIBRARY_REPO}", headers=h, timeout=20)
        if r.status_code == 404:
            r = requests.post(f"{API}/user/repos", headers=h, timeout=30, json={
                "name": LIBRARY_REPO, "private": True, "auto_init": False,
                "description": "My PaperShelf library (private, managed by PaperShelf)"})
    except requests.exceptions.RequestException as exc:
        raise LoginError(f"Could not reach GitHub ({exc.__class__.__name__}).") from exc
    if r.status_code not in (200, 201):
        raise LoginError(f"GitHub did not let PaperShelf create the private repository (answer {r.status_code}).")
    return f"https://github.com/{user}/{LIBRARY_REPO}.git"
