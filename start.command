#!/bin/bash
# Double-click this file in Finder to start PaperShelf.
# The first run sets things up (about a minute); afterwards it starts instantly.
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Install it from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close..."
  exit 1
fi

# If this folder is a copy of a git repository, fetch the latest version of the app first
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  # never stop to ask for a password: if GitHub needs one, just skip the update
  GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet 2>/dev/null && echo "PaperShelf is up to date."
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "First start: setting up PaperShelf..."
  python3 -m venv .venv || { read -r -p "Setup failed. Press Enter to close..."; exit 1; }
fi
# (re)install the libraries when requirements.txt is new or changed
if ! cmp -s requirements.txt .venv/requirements.installed; then
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt || { read -r -p "Setup failed. Press Enter to close..."; exit 1; }
  cp requirements.txt .venv/requirements.installed
fi

./.venv/bin/python app.py
