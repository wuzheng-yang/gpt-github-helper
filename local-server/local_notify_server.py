# local_notify_server.py
# 功能：
# 1. 接收 Chrome 插件发送的 GPT 回复内容
# 2. 回答结束后保存最后一条 GPT 回复为 Markdown
# 3. 检测 GitHub 请求时保存日志
# 4. Windows 下弹窗提醒
# 5. 可扩展为调用你自己的 exe / Java 程序

import datetime
import subprocess
from pathlib import Path
from typing import Optional, List

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# =========================
# 请求体模型
# =========================
class NotifyPayload(BaseModel):
    # 事件类型：finished / github
    type: str

    # 当前页面标题
    title: Optional[str] = ""

    # 当前 ChatGPT 页面地址
    url: Optional[str] = ""

    # 最后一条用户提问
    userText: Optional[str] = ""

    # 最后一条 GPT 回复
    replyText: Optional[str] = ""

    # 浏览器页面时间
    pageTime: Optional[str] = ""

    # GitHub 文件路径
    githubFilePath: Optional[str] = ""

    # GitHub 安全校验是否通过
    securityOk: Optional[bool] = None

    # GitHub 安全校验失败原因
    securityReasons: Optional[List[str]] = None

    # 兼容旧版本字段
    whitelistOk: Optional[bool] = None

    # 兼容旧版本字段
    whitelistReasons: Optional[List[str]] = None


# =========================
# FastAPI 应用
# =========================
app = FastAPI(title="GPT 本地通知服务")

# 允许浏览器插件调用本地接口
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# 保存目录
# =========================
BASE_DIR = Path(__file__).resolve().parent
REPLY_DIR = BASE_DIR / "gpt_replies"
LOG_DIR = BASE_DIR / "logs"

REPLY_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)


# =========================
# Windows 弹窗
# =========================
def show_windows_message(title: str, message: str):
    """
    Windows 系统弹窗。
    如果你不想弹窗，可以把这个函数里的内容注释掉。
    """

    try:
        subprocess.Popen(
            [
                "powershell",
                "-Command",
                f"""
                Add-Type -AssemblyName PresentationFramework;
                [System.Windows.MessageBox]::Show('{message}', '{title}')
                """
            ],
            shell=True
        )
    except Exception as exc:
        # 弹窗失败不影响主流程
        print(f"弹窗失败：{exc}")


# =========================
# 可选：调用你自己的本地程序
# =========================
def call_your_program(event_type: str, markdown_file: Optional[Path] = None):
    """
    这里可以改成调用你自己的 exe / bat / Java 程序。

    示例：
    subprocess.Popen([
        "D:\\your_app\\notify.exe",
        event_type,
        str(markdown_file or "")
    ], shell=False)
    """

    # 默认不调用任何外部程序
    return


# =========================
# 保存 GPT 回复
# =========================
@app.post("/gpt-finished")
def gpt_finished(payload: NotifyPayload):
    """
    GPT 回答结束后由 Chrome 插件调用。
    保存最后一条用户消息和最后一条 GPT 回复。
    """

    now = datetime.datetime.now()
    filename = now.strftime("%Y%m%d_%H%M%S") + "_gpt_reply.md"
    file_path = REPLY_DIR / filename

    markdown = f"""# GPT 回复记录

## 保存时间

{now.strftime("%Y-%m-%d %H:%M:%S")}

## 页面标题

{payload.title}

## 页面地址

{payload.url}

## 用户最后提问

{payload.userText or ""}

## GPT 最后回复

{payload.replyText or ""}
"""

    file_path.write_text(markdown, encoding="utf-8")

    # 写日志
    log_file = LOG_DIR / "finished.log"
    with log_file.open("a", encoding="utf-8") as f:
        f.write(f"{now.strftime('%Y-%m-%d %H:%M:%S')} 保存回复：{file_path}\n")

    # 弹窗提醒
    show_windows_message("ChatGPT 通知", "GPT 回答结束，内容已保存")

    # 可选：调用自己的程序
    call_your_program("finished", file_path)

    return {
        "success": True,
        "message": "GPT 回复已保存",
        "file": str(file_path)
    }


# =========================
# 保存 GitHub 请求日志
# =========================
@app.post("/github-confirm-request")
def github_confirm_request(payload: NotifyPayload):
    """
    检测到 GitHub 工具确认请求后由 Chrome 插件调用。
    保存请求日志，方便你追踪。
    """

    now = datetime.datetime.now()
    log_file = LOG_DIR / "github_confirm.log"

    security_ok = payload.securityOk
    if security_ok is None:
        security_ok = payload.whitelistOk

    reasons = payload.securityReasons or payload.whitelistReasons or []

    content = f"""[{now.strftime('%Y-%m-%d %H:%M:%S')}]
URL: {payload.url}
GitHub File: {payload.githubFilePath}
Security OK: {security_ok}
Reasons: {"; ".join(reasons)}
User: {payload.userText}

"""

    with log_file.open("a", encoding="utf-8") as f:
        f.write(content)

    return {
        "success": True,
        "message": "GitHub 请求日志已保存"
    }


# =========================
# 健康检查接口
# =========================
@app.get("/health")
def health():
    """
    用于测试本地服务是否启动。
    浏览器访问：http://127.0.0.1:18888/health
    """

    return {
        "success": True,
        "message": "GPT 本地通知服务运行中"
    }


# =========================
# 启动服务
# =========================
if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=18888
    )
