@echo off
rem SAMLOCK Gestion : met a jour le logiciel puis le lance (double-clic).
cd /d "%~dp0"
echo === Mise a jour ===
git checkout -- web/dist 2>nul
git pull origin main
call npm install --no-audit --no-fund
call npm --prefix web install --no-audit --no-fund
call npm run build:web
echo === Lancement : http://localhost:3001 ===
start "" http://localhost:3001
npm start
pause
