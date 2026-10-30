@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY=python"
where py >nul 2>nul && set "PY=py -3"

if not exist ".venv\Scripts\python.exe" (
  echo [FinanceX] 首次启动：正在创建运行环境...
  %PY% -m venv .venv
  if errorlevel 1 goto nopy
)

".venv\Scripts\python.exe" -c "import pdfplumber" >nul 2>nul
if errorlevel 1 (
  echo [FinanceX] 正在安装依赖（只需一次，用于解析信用卡 PDF）...
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
  if errorlevel 1 echo [FinanceX] 依赖安装失败：除信用卡 PDF 导入外，其他功能仍可使用。
)

".venv\Scripts\python.exe" -m financex %*
pause
exit /b

:nopy
echo [FinanceX] 没有找到 Python 3.10 以上版本，请先安装：https://www.python.org/downloads/
pause
