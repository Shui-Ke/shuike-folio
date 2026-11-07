@echo off
setlocal
cd /d "%~dp0"
call node node_modules\vite\bin\vite.js preview --host 127.0.0.1 --open "/?level=camp&time=0.1"
if errorlevel 1 pause
