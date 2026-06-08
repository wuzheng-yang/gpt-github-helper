@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=D:\sof\env\anaconda3\envs\ai-gzb\python.exe"
if not exist "%PYTHON_EXE%" (
  set "PYTHON_EXE=python"
)

echo Starting GPT local notify server...
echo.

echo Installing requirements...
rem "%PYTHON_EXE%" -m pip install -r requirements.txt

echo.
echo Server URL: http://127.0.0.1:18888
echo Health URL: http://127.0.0.1:18888/health
echo.

"%PYTHON_EXE%" local_notify_server.py

pause
