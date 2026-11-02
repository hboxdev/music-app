@echo off
rem Makes the TubeTunes download helper start (minimized) when you log in to Windows.
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TubeTunes helper.cmd"
> "%TARGET%" echo @echo off
>> "%TARGET%" echo cd /d "%~dp0"
>> "%TARGET%" echo start "TubeTunes helper" /min node server.mjs
echo Added: %TARGET%
echo The helper now starts every time you log in. Delete that file to stop it.
pause
