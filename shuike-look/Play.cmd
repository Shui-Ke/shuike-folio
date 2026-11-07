@echo off
cd /d "%~dp0"
start "shuike-look server" /min cmd /c "node serve.mjs . 4181"
timeout /t 2 >nul
start "" http://127.0.0.1:4181/
