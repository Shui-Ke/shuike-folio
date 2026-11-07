@echo off
setlocal
cd /d "%~dp0"
call node scripts\start-scene-editor.mjs
if errorlevel 1 pause
