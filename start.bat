@echo off
rem OpenDMR CPS: serves the pages on this computer and opens them (the serial port needs http://127.0.0.1, not a file)
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:8000"
py -3 serve.py 8000 || python serve.py 8000
pause
