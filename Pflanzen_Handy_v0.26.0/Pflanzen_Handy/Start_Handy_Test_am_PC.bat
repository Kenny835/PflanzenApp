@echo off
rem Startet die Handy-Version zum Ausprobieren am PC (nur dieser Rechner, http://localhost:8000).
rem Das Fenster offen lassen, solange du testest. Beenden mit Strg+C.
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000 --bind 127.0.0.1
pause
