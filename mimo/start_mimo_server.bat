@echo off
chcp 65001 >nul
title Mimo Code Worker Server

REM ============================================================
REM 一键启动小米模型代码服务
REM 使用指定 Python：
REM D:\sof\env\miniforge3\envs\py312_xtquant\python.exe
REM ============================================================

REM ====== 1. 项目根目录：改成你的项目路径 ======
set PROJECT_ROOT=D:\project\yzw\ai_gp

REM ====== 2. Python 路径 ======
set PYTHON_EXE=D:\sof\env\miniforge3\envs\py312_xtquant\python.exe

REM ====== 3. 小米模型接口配置：按你的实际情况修改 ======
set MIMO_API_URL=https://token-plan-sgp.xiaomimimo.com/v1/chat/completions
set MIMO_API_KEY=tp-s067q5dz5n7tcv4tg1uzv876fg2x4jaxm5axlkd84e65wj9n
set MIMO_MODEL=mimo-v2.5-pro

REM ====== 4. 服务端口 ======
set MIMO_HOST=127.0.0.1
set MIMO_PORT=8765

echo.
echo ============================================================
echo 启动 Mimo Code Worker Server
echo 项目目录: %PROJECT_ROOT%
echo Python: %PYTHON_EXE%
echo 地址: http://%MIMO_HOST%:%MIMO_PORT%
echo ============================================================
echo.

REM ====== 5. 进入项目目录 ======
cd /d "%PROJECT_ROOT%"

REM ====== 6. 检查 Python 是否存在 ======
if not exist "%PYTHON_EXE%" (
    echo [错误] 找不到 Python:
    echo %PYTHON_EXE%
    pause
    exit /b 1
)

REM ====== 7. 检查服务文件是否存在 ======
if not exist "%PROJECT_ROOT%\tools\mimo\mimo_server.py" (
    echo [错误] 找不到 mimo_server.py:
    echo %PROJECT_ROOT%\tools\mimo\mimo_server.py
    pause
    exit /b 1
)

REM ====== 8. 启动 FastAPI 服务 ======
REM 注意：
REM - 这个窗口不要关闭
REM - 关闭窗口服务就停止
REM - Codex 后续调用 http://127.0.0.1:8765/run
"%PYTHON_EXE%" -m uvicorn tools.mimo.mimo_server:app --host %MIMO_HOST% --port %MIMO_PORT%

echo.
echo 服务已停止。
pause