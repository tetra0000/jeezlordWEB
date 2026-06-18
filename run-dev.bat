@echo off
REM Build everything, then start the server (serves the client + ws on :8081).
REM Open http://localhost:8081 in a couple of browser windows to play.
call npm run build
if errorlevel 1 exit /b 1
echo.
echo  Jeezlord dev server -> http://localhost:8081
echo.
node dist/server/main.js
