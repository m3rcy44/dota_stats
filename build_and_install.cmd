@echo off
setlocal

cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo pnpm was not found. Installing pnpm globally with npm...
    npm install -g pnpm
    if errorlevel 1 exit /b 1
)

echo Installing dependencies...
pnpm install
if errorlevel 1 exit /b 1

echo Building Dota 2 Stats with Starlight...
pnpm run build
if errorlevel 1 exit /b 1

echo.
echo Build finished. Restart Steam, then enable Dota 2 Stats in Millennium Settings.
