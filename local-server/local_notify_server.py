# local_notify_server.py
# 功能：
# 1. 接收 Chrome 插件发送的 GPT 回复内容
# 2. 回答结束后按 ChatGPT 会话标题保存 Markdown
# 3. 一个会话固定保存到一个 Markdown 文件中
# 4. 支持 Python 把消息放入队列，由插件自动输入并发送到 ChatGPT
# 5. 检测 GitHub 请求时保存日志
# 6. Windows 下弹窗提醒
# 7. 可扩展为调用你自己的 exe / Java 程序

import datetime
import re
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any
from uuid import uuid4

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

    # ChatGPT 原始会话标题
    # 注意：浏览器标题可能会被插件改成“回答中/已结束”，所以优先使用这个字段。
    conversationTitle: Optional[str] = ""

    # 当前 ChatGPT 页面地址
    url: Optional[str] = ""

    # 最后一条用户提问
    userText: Optional[str] = ""

    # 最后一条 GPT 回复
    replyText: Optional[str] = ""

    # 完整页面可见消息快照，兼容新版插件
    pageData: Optional[Dict[str, Any]] = None

    # 兼容其他字段名
    conversationSnapshot: Optional[Dict[str, Any]] = None

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


class SendChatPayload(BaseModel):
    # 要发送到 ChatGPT 输入框的文本
    text: str


class AckChatPayload(BaseModel):
    # 插件成功点击发送后回传的消息 ID
    id: str


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
# Python -> Chrome 插件消息队列
# =========================
# 说明：
# 1. 插件 GET /next-chat-message 时只查看第一条消息，不立即删除。
# 2. 插件真正点击发送后，再 POST /ack-chat-message 确认删除。
# 3. 这样如果 ChatGPT 发送按钮不可用，消息不会丢。
pending_chat_messages: List[Dict[str, str]] = []


# =========================
# 文件名处理
# =========================
def clean_title(title: Optional[str]) -> str:
    """
    清理 ChatGPT 会话标题。
    说明：
    1. 去掉插件状态标题。
    2. 去掉浏览器标题后缀。
    3. 空标题用“未命名会话”。
    """

    value = (title or "").strip()

    helper_titles = {
        "⏳ GPT 回答中 - ChatGPT",
        "✅ GPT 已结束 - ChatGPT",
    }

    if value in helper_titles:
        value = ""

    value = re.sub(r"\s+-\s+ChatGPT$", "", value, flags=re.IGNORECASE).strip()

    if not value or value.lower() == "chatgpt":
        return "未命名会话"

    return value


def safe_filename(name: str) -> str:
    """
    把会话标题转成 Windows / Linux 都能保存的文件名。
    说明：
    Windows 不允许文件名包含：< > : " / \ | ? *
    """

    value = clean_title(name)
    value = re.sub(r'[<>:"/\\|?*]', "_", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = value.rstrip(". ")

    # 文件名太长时截断，避免 Windows 路径过长。
    if len(value) > 120:
        value = value[:120].rstrip()

    return value or "未命名会话"


def get_conversation_title(payload: NotifyPayload) -> str:
    """
    获取会话标题。
    优先级：
    1. conversationTitle：插件保存的 ChatGPT 原始会话标题。
    2. title：当前页面标题。
    3. 未命名会话。
    """

    title = clean_title(payload.conversationTitle)
    if title != "未命名会话":
        return title

    return clean_title(payload.title)


def get_conversation_file(payload: NotifyPayload) -> Path:
    """
    一个会话一个文件。
    文件名与 ChatGPT 会话标题一致。
    """

    title = get_conversation_title(payload)
    filename = safe_filename(title) + ".md"
    return REPLY_DIR / filename


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
# Markdown 构建
# =========================
def build_message_markdown(payload: NotifyPayload) -> str:
    """
    构建完整消息 Markdown。
    说明：
    1. 如果新版插件发送了 pageData / conversationSnapshot，则保存完整可见消息列表。
    2. 如果没有完整快照，则退回保存最后一轮 userText / replyText。
    """

    page_data = payload.pageData or payload.conversationSnapshot or {}
    messages = page_data.get("messages") or []

    if not messages:
        return f"""## 用户提问

{payload.userText or ""}

## GPT 回复

{payload.replyText or ""}
"""

    message_blocks = []

    for item in messages:
        index = item.get("index", "")
        role = item.get("role", "unknown")
        source = item.get("source", "")
        text = item.get("text", "")

        message_blocks.append(
            f"""## [{index}] {role}

来源：{source}

{text}
"""
        )

    full_page_text = page_data.get("fullPageText") or ""

    if full_page_text:
        message_blocks.append(
            f"""## 完整页面可见文本兜底

```text
{full_page_text}
```
"""
        )

    return "\n---\n".join(message_blocks)


def build_full_markdown(payload: NotifyPayload, now: datetime.datetime) -> str:
    """
    构建一个会话文件的完整 Markdown 内容。
    新版完整快照模式下，每次覆盖同一个文件，保证文件内容是当前会话最新状态。
    """

    title = get_conversation_title(payload)
    message_markdown = build_message_markdown(payload)

    return f"""# {title}

## 保存时间

{now.strftime("%Y-%m-%d %H:%M:%S")}

## 页面地址

{payload.url}

## 浏览器页面时间

{payload.pageTime or ""}

---

{message_markdown}
"""


def append_legacy_round(file_path: Path, payload: NotifyPayload, now: datetime.datetime):
    """
    兼容旧插件：如果没有完整消息快照，就把每一轮回答追加到同一个会话文件。
    这样即使 local_api.js 还没更新，也能做到“一个会话一个文件”。
    """

    title = get_conversation_title(payload)

    if not file_path.exists():
        header = f"""# {title}

## 页面地址

{payload.url}

"""
        file_path.write_text(header, encoding="utf-8")

    content = f"""
---

## 保存时间

{now.strftime("%Y-%m-%d %H:%M:%S")}

## 用户提问

{payload.userText or ""}

## GPT 回复

{payload.replyText or ""}
"""

    with file_path.open("a", encoding="utf-8") as f:
        f.write(content)


# =========================
# 保存 GPT 回复
# =========================
@app.post("/gpt-finished")
def gpt_finished(payload: NotifyPayload):
    """
    GPT 回答结束后由 Chrome 插件调用。
    保存策略：
    1. 文件名使用 ChatGPT 会话标题。
    2. 同一个会话固定写入同一个 Markdown 文件。
    3. 新版完整快照：覆盖写入，保存当前完整会话。
    4. 旧版最后一轮：追加写入，避免覆盖丢历史。
    """

    now = datetime.datetime.now()
    file_path = get_conversation_file(payload)

    page_data = payload.pageData or payload.conversationSnapshot or {}
    messages = page_data.get("messages") or []

    if messages:
        markdown = build_full_markdown(payload, now)
        file_path.write_text(markdown, encoding="utf-8")
    else:
        append_legacy_round(file_path, payload, now)

    # 写日志
    log_file = LOG_DIR / "finished.log"
    with log_file.open("a", encoding="utf-8") as f:
        f.write(
            f"{now.strftime('%Y-%m-%d %H:%M:%S')} "
            f"保存会话：{get_conversation_title(payload)} -> {file_path}\n"
        )

    # 弹窗提醒
    show_windows_message("ChatGPT 通知", "GPT 回答结束，内容已保存")

    # 可选：调用自己的程序
    call_your_program("finished", file_path)

    return {
        "success": True,
        "message": "GPT 会话已保存",
        "title": get_conversation_title(payload),
        "file": str(file_path)
    }


# =========================
# Python -> 插件：发送 ChatGPT 消息
# =========================
@app.post("/send-chat-message")
def send_chat_message(payload: SendChatPayload):
    """
    把消息加入待发送队列。
    用法：Python 或其他程序 POST 到这个接口，插件会轮询并自动填入 ChatGPT 输入框发送。
    """

    text = (payload.text or "").strip()

    if not text:
        return {
            "success": False,
            "message": "消息内容不能为空",
            "queueSize": len(pending_chat_messages)
        }

    message = {
        "id": uuid4().hex,
        "text": text,
        "createdAt": datetime.datetime.now().isoformat()
    }

    pending_chat_messages.append(message)

    return {
        "success": True,
        "message": "消息已加入待发送队列",
        "data": message,
        "queueSize": len(pending_chat_messages)
    }


@app.get("/next-chat-message")
def next_chat_message():
    """
    插件轮询这个接口。
    如果有待发送消息，只返回第一条，不删除。
    插件发送成功后会调用 /ack-chat-message 删除。
    """

    if not pending_chat_messages:
        return {
            "success": True,
            "hasMessage": False,
            "message": None,
            "queueSize": 0
        }

    return {
        "success": True,
        "hasMessage": True,
        "message": pending_chat_messages[0],
        "queueSize": len(pending_chat_messages)
    }


@app.post("/ack-chat-message")
def ack_chat_message(payload: AckChatPayload):
    """
    插件确认消息已经点击发送。
    收到确认后，本地服务才从队列删除消息。
    """

    message_id = (payload.id or "").strip()

    if not message_id:
        return {
            "success": False,
            "message": "缺少消息 ID",
            "queueSize": len(pending_chat_messages)
        }

    before_size = len(pending_chat_messages)
    pending_chat_messages[:] = [
        item for item in pending_chat_messages
        if item.get("id") != message_id
    ]
    removed = before_size - len(pending_chat_messages)

    return {
        "success": True,
        "message": "消息确认成功" if removed else "消息已不在队列中",
        "removed": removed,
        "queueSize": len(pending_chat_messages)
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
Conversation: {get_conversation_title(payload)}
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
        "message": "GPT 本地通知服务运行中",
        "pendingChatMessages": len(pending_chat_messages)
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
