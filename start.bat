@echo off
rem Double-click this file to start PaperShelf on Windows.
rem The first run sets things up (about a minute); afterwards it starts instantly.
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
%PY% --version >nul 2>nul || (
  echo Python 3 is not installed. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during the installation. Then try again.
  pause
  exit /b 1
)
rem If this folder is a copy of a git repository, fetch the latest version of the app first
if exist ".git" ( set GIT_TERMINAL_PROMPT=0& git pull --ff-only --quiet 2>nul )
if not exist ".venv\Scripts\python.exe" (
  echo First start: setting up PaperShelf...
  %PY% -m venv .venv || (echo Setup failed. & pause & exit /b 1)
)
rem (re)install the libraries when requirements.txt is new or changed
fc /b requirements.txt .venv\requirements.installed >nul 2>nul || (
  ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
  ".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt || (echo Setup failed. & pause & exit /b 1)
  copy /y requirements.txt .venv\requirements.installed >nul
)
".venv\Scripts\python.exe" app.py
pause
