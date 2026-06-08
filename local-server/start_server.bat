@echo off
chcp 65001 >nul
echo 正在启动 GPT 本地通知服务...
echo.

python -m pip install -r requirements.txt

echo.
echo 服务启动地址：http://127.0.0.1:18888
echo 健康检查地址：http://127.0.0.1:18888/health
echo.

python local_notify_server.py

pause
