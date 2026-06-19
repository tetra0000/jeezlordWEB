@echo off
REM ===========================================================================
REM  Jeezlord - one-click deploy over a Cloudflare quick tunnel.
REM
REM  What it does (all in this one file):
REM    1. installs npm deps (first run only)
REM    2. builds the server + client
REM    3. starts the game server on http://localhost:%PORT% (own window)
REM    4. opens a Cloudflare tunnel and prints a public https URL to share
REM
REM  Requirements: Node.js (>=22) and cloudflared on PATH. If cloudflared is
REM  missing the script tells you how to install it.
REM
REM  Stop: press Ctrl+C in this window (the server window is closed for you).
REM ===========================================================================
setlocal
title Jeezlord - Cloudflare deploy
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=8081"

echo.
echo ============================================================
echo   Jeezlord deploy  (port %PORT%)
echo ============================================================
echo.

REM --- 1. dependencies (only if node_modules is absent) ----------------------
if not exist "node_modules\" (
  echo [deploy] Installing npm dependencies ^(first run^)...
  call npm install
  if errorlevel 1 goto :fail
)

REM --- 2. build --------------------------------------------------------------
echo [deploy] Building server + client...
call npm run build
if errorlevel 1 goto :fail

REM --- 3. check cloudflared --------------------------------------------------
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo [deploy] ERROR: 'cloudflared' was not found on your PATH.
  echo          Install it, then run this script again:
  echo.
  echo            winget install --id Cloudflare.cloudflared
  echo.
  echo          ^(or download from
  echo           https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ ^)
  echo.
  goto :fail
)

REM --- 4. start the game server in its own window ----------------------------
echo [deploy] Starting server at http://localhost:%PORT% ...
start "Jeezlord server" cmd /c "node dist\server\main.js"

REM give the server a moment to bind the port before the tunnel connects
timeout /t 2 /nobreak >nul

REM --- 5. open the public Cloudflare quick tunnel ----------------------------
echo.
echo [deploy] Opening Cloudflare tunnel. Share the https://...trycloudflare.com
echo          URL printed below. Press Ctrl+C here to stop everything.
echo.
cloudflared tunnel --url http://localhost:%PORT%

REM cloudflared has exited (Ctrl+C / closed) -> shut the server window too
echo.
echo [deploy] Tunnel closed - stopping the game server...
taskkill /FI "WINDOWTITLE eq Jeezlord server*" /T /F >nul 2>nul
goto :end

:fail
echo.
echo [deploy] FAILED - see the message above.
echo.
pause
exit /b 1

:end
endlocal
