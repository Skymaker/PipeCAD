@echo off
rem PipeCAD: arranca el servidor local y abre el programa en el navegador
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js: instalalo desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b 1)
start "" http://localhost:8080/
node servidor.mjs %*
pause
