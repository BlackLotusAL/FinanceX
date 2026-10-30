@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 用演示数据体验 FinanceX：写入 data\demo.db，端口 8731，不影响正式数据 data\wealthx.db
set "FINANCEX_DB=%~dp0data\demo.db"
set "FINANCEX_PORT=8731"

set "PY=python"
where py >nul 2>nul && set "PY=py -3"
if not exist ".venv\Scripts\python.exe" (
  %PY% -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
)

if not exist "data\demo.db" ".venv\Scripts\python.exe" -m financex.demo
".venv\Scripts\python.exe" -m financex %*
pause
