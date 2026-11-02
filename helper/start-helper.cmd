@echo off
rem Starts the TubeTunes download helper. Keep this window open while downloading.
cd /d "%~dp0"
node server.mjs
pause
