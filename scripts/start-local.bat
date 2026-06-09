@echo off
setlocal

REM 获取当前脚本所在目录，上级就是项目根目录
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI"

set "JAVA_HOME=D:\sof\env\jdk17"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo Starting local stock workbench services...
echo Root: %ROOT%
echo Java: %JAVA_HOME%
echo.

start "workbench-java :10004" /D "%ROOT%\ai_java\workbench-java" cmd /k ""%JAVA_HOME%\bin\java.exe" -jar target\workbench-java-0.0.1-SNAPSHOT.jar"

start "ai-python :8000" /D "%ROOT%\ai_python" cmd /k "python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

REM 旧 ai-python-worker 轮询模式已移除。
REM 任务由 Java 任务中心按需启动：python -m app.task_runner --task-id <ID>

start "gateway :8086" /D "%ROOT%\ai_java\gateway" cmd /k ""%JAVA_HOME%\bin\java.exe" -jar target\gateway-0.0.1-SNAPSHOT.jar"

start "ai-vue :3200" /D "%ROOT%\ai_vue" cmd /k "pnpm.cmd dev --host 0.0.0.0"

echo.
echo Started 4 services in separate console windows:
echo   1. workbench-java   :10004
echo   2. ai-python        :8000
echo   3. gateway          :8086
echo   4. ai-vue           :3200
echo.
echo Python task execution is launched by Java per job_task:
echo   python -m app.task_runner --task-id ^<ID^>
echo.
echo Frontend: http://localhost:3200/
echo Gateway Java health: http://127.0.0.1:8086/api/java/workbench/health
echo Gateway Python health: http://127.0.0.1:8086/api/python/health
echo.
pause
