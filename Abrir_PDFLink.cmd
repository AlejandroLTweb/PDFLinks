@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Para abrir PDFLink necesitas Node.js 22.13 o posterior.
  echo Despues ejecuta npm start desde esta carpeta.
  pause
  exit /b 1
)
node serve.mjs --open
if errorlevel 1 pause
