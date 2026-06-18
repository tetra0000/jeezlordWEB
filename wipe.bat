@echo off
REM Dev-only: wipe the persistent world (accounts, players, entities, seeded map).
REM Stop the server first -- node:sqlite holds world.db open while running.
cd /d "%~dp0"
node scripts\reset-world.mjs
pause
