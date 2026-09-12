@echo off
rem Double-clickable wrapper for run-dev.ps1. Windows opens .ps1 files in an editor rather than
rem running them, so a .cmd is what makes this a single click from Explorer.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-dev.ps1" %*
