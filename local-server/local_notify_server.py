# local_notify_server.py
# -----------------------------------------------------------------------------
# 本地 Python 服务。
#
# 运行方式：
#   python local_notify_server.py
#
# 默认监听：
#   http://127.0.0.1:18888
#
# 主要功能：
# 1. 接收 Chrome 插件发送的 GPT 回答结束事件。
# 2. 把 ChatGPT 会话保存成 Markdown 文件。
# 3. 记录 GitHub 工具确认请求日志。
# 4. 提供 Python -> ChatGPT 的消息队列接口。
# 5. 支持 targetUrl，把消息发送到指定 ChatGPT 会话页面。
# 6. 支持消息领取锁，避免多个 ChatGPT 标签页重复发送同一条消息。
# 7. 预留 call_your_program()，方便后续接入自己的 exe / bat / Java 程序。
#
# 当前队列是内存队列：
# - 服务重启后，未发送消息会丢失。
# - 本地个人工具够用。
# - 如果后面要更稳，可以改成 JSON 文件或 SQLite 持久化。
# -----------------------------------------------------------------------------

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
    """
    Chrome 插件通知本地服务时使用的请求体。

    使用场景：
    1. POST /gpt-finished
       GPT 回答结束后，插件把会话内容发到本地服务。

    2. POST /github-confirm-request
       插件检测到 GitHub 工具确认请求后，把请求信息发到本地服务写日志。
    """

    # 事件类型：finished / github。
    # finished：回答结束保存 Markdown。
    # github：记录 GitHub 确认请求日志。
    type: str

    # 当前浏览器标题。
    # 注意：插件可能会把标题改成“⏳ GPT 回答中 - ChatGPT”或“✅ GPT 已结束 - ChatGPT”。
    title: Optional[str] = ""

    # ChatGPT 原始会话标题。
    # 这是 content.js 单独缓存的真实标题，优先用于文件名。
    conversationTitle: Optional[str] = ""

    # 当前 ChatGPT 页面地址。
    # 用于 Markdown 记录来源，也方便后续回到原会话。
    url: Optional[str] = ""

    # 最后一条用户提问。
    # 如果没有完整会话快照，则用它和 replyText 走旧版追加保存逻辑。
    userText: Optional[str] = ""

    # 最后一条 GPT 回复。
    # 如果没有完整会话快照，则用它和 userText 走旧版追加保存逻辑。
    replyText: Optional[str] = ""

    # 新版插件发送的完整页面可见消息快照。
    # page_reader.js.getConversationSnapshot() 会生成这个字段。
    pageData: Optional[Dict[str, Any]] = None

    # 兼容其他字段名。
    # 如果以后插件或旧版本使用 conversationSnapshot，本地服务也能读取。
    conversationSnapshot: Optional[Dict[str, Any]] = None

    # 浏览器侧时间。
    # 用于和后端保存时间对比，排查延迟问题。
    pageTime: Optional[str] = ""

    # GitHub 工具请求中的文件路径。
    # 由 safety_check.js 从确认卡片文本中提取。
    githubFilePath: Optional[str] = ""

    # GitHub 配置校验是否通过。
    # 新字段名：securityOk。
    securityOk: Optional[bool] = None

    # GitHub 配置校验失败原因。
    # 新字段名：securityReasons。
    securityReasons: Optional[List[str]] = None

    # 兼容旧版本字段：以前可能叫 whitelistOk。
    whitelistOk: Optional[bool] = None

    # 兼容旧版本字段：以前可能叫 whitelistReasons。
    whitelistReasons: Optional[List[str]] = None


class SendChatPayload(BaseModel):
    """
    Python 或其他本地程序向 ChatGPT 发送消息时使用的请求体。

    接口：
      POST /send-chat-message

    示例 1：不指定 URL，发给当前前台 ChatGPT 页面。
      {"text": "继续"}

    示例 2：指定 URL，发给指定 ChatGPT 会话。
      {"text": "继续", "targetUrl": "https://chatgpt.com/c/xxxx"}
    """

    # 要发送到 ChatGPT 输入框的文本。
    text: str

    # 可选：指定 ChatGPT 会话 URL。
    # 不传：只允许当前前台激活的 ChatGPT 页面取走。
    # 传了：只允许 URL 匹配的 ChatGPT 页面取走，即使这个标签页在后台也可以尝试发送。
    targetUrl: Optional[str] = ""


class AckChatPayload(BaseModel):
    """
    插件确认消息已经成功进入 ChatGPT 页面后，调用 ack 接口使用的请求体。

    接口：
      POST /ack-chat-message
    """

    # 插件成功发送后回传的消息 ID。
    id: str


# =========================
# FastAPI 应用
# =========================
app = FastAPI(title="GPT 本地通知服务")

# 允许浏览器插件调用本地接口。
# 虽然当前主要通过 Chrome extension background.js 中转，
# 但这里仍然打开 CORS，方便你直接用浏览器、curl、其他本地程序调试。
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
# BASE_DIR：local-server 目录。
BASE_DIR = Path(__file__).resolve().parent

# GPT 回复保存目录。
REPLY_DIR = BASE_DIR / "gpt_replies"

# 日志目录。
LOG_DIR = BASE_DIR / "logs"

# 启动时自动创建目录，避免第一次保存时报错。
REPLY_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)


# =========================
# Python -> Chrome 插件消息队列
# =========================
# 队列元素结构：
# {
#   "id": "uuid",
#   "text": "要发送的内容",
#   "targetUrl": "指定 ChatGPT 会话 URL，可为空",
#   "createdAt": "创建时间",
#   "claimedBy": "领取该消息的 pageId",
#   "claimExpiresAt": "领取锁过期时间"
# }
#
# 关键规则：
# 1. /next-chat-message 只返回“当前页面可处理”的消息，不立即删除。
# 2. 插件真正点击发送，并确认消息出现在页面后，再调用 /ack-chat-message 删除。
# 3. 如果发送失败或按钮不可用，消息不会丢。
# 4. targetUrl 为空：只允许当前前台激活页面处理。
# 5. targetUrl 不为空：只允许 URL 匹配的页面处理，后台标签页也可以尝试发送。
# 6. 消息被某个页面取走后，会短暂加锁，避免多个窗口重复发送同一条消息。
pending_chat_messages: List[Dict[str, str]] = []

# 页面领取消息后的锁定时间。
# 如果插件没有 ack，锁过期后消息会重新允许匹配页面领取。
MESSAGE_CLAIM_SECONDS = 45


# =========================
# URL 处理
# =========================
def normalize_url(url: Optional[str]) -> str:
    """
    归一化 ChatGPT 会话 URL。

    参数：
        url: 原始 URL。

    返回：
        清理后的 URL。

    处理逻辑：
    1. 去掉首尾空格。
    2. 去掉末尾斜杠，避免下面两个地址不匹配：
       - https://chatgpt.com/c/xxx
       - https://chatgpt.com/c/xxx/
    3. 不删除 query/hash，避免用户希望精确匹配特殊 URL 时误匹配。
    """

    value = (url or "").strip()
    return value.rstrip("/")


def is_message_match_page(message: Dict[str, str], page_url: str, page_active: bool) -> bool:
    """
    判断某条队列消息是否应该被当前 ChatGPT 页面取走。

    参数：
        message: 队列中的一条消息。
        page_url: 插件当前页面 URL。
        page_active: 插件当前页面是否前台激活。

    返回：
        True 表示当前页面可以处理这条消息。

    匹配规则：
    1. message.targetUrl 有值：
       当前页面 URL 必须等于 targetUrl，不强制前台。

    2. message.targetUrl 为空：
       只允许当前前台激活页面处理。
    """

    target_url = normalize_url(message.get("targetUrl"))
    current_url = normalize_url(page_url)

    if target_url:
        return bool(current_url) and current_url == target_url

    return page_active


def is_claim_available(message: Dict[str, str], page_id: str, now: datetime.datetime) -> bool:
    """
    判断消息领取锁是否允许当前页面领取。

    参数：
        message: 队列消息。
        page_id: 插件页面生成的唯一 ID。
        now: 当前后端时间。

    返回：
        True 表示可以领取。

    规则：
    1. 没有 claimedBy：说明没人领取，可以领取。
    2. claimedBy 是当前 pageId：允许当前页面重复读取，避免自己被自己锁住。
    3. claimExpiresAt 为空或格式异常：认为锁无效，可以领取。
    4. claimExpiresAt 已过期：可以重新领取。
    5. 其他情况：别的页面正在处理，不返回。
    """

    claimed_by = (message.get("claimedBy") or "").strip()
    claim_expires_at = (message.get("claimExpiresAt") or "").strip()

    if not claimed_by:
        return True

    if page_id and claimed_by == page_id:
        return True

    if not claim_expires_at:
        return True

    try:
        expires_at = datetime.datetime.fromisoformat(claim_expires_at)
    except ValueError:
        return True

    return now >= expires_at


def claim_message(message: Dict[str, str], page_id: str, now: datetime.datetime):
    """
    给消息加短期领取锁。

    参数：
        message: 队列消息。
        page_id: 当前领取消息的页面 ID。
        now: 当前后端时间。

    说明：
    插件取到消息后，不会立刻删除消息。
    只有插件确认消息已经出现在 ChatGPT 页面后才会 ack 删除。
    所以这里先加锁，防止其他标签页在这段时间重复拿到同一条消息。
    """

    message["claimedBy"] = page_id or "unknown-page"
    message["claimExpiresAt"] = (
        now + datetime.timedelta(seconds=MESSAGE_CLAIM_SECONDS)
    ).isoformat()


# =========================
# 文件名处理
# =========================
def clean_title(title: Optional[str]) -> str:
    """
    清理 ChatGPT 会话标题。

    参数：
        title: 原始标题。

    返回：
        清理后的标题，空标题返回“未命名会话”。

    处理逻辑：
    1. 去掉插件状态标题。
    2. 去掉浏览器标题后缀：xxx - ChatGPT。
    3. 空标题或默认 ChatGPT 标题使用“未命名会话”。
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

    参数：
        name: 会话标题。

    返回：
        可用于文件名的字符串。

    处理逻辑：
    1. 替换 Windows 不允许的字符：< > : " / \ | ? *
    2. 合并多余空白。
    3. 去掉末尾点号和空格。
    4. 截断超长文件名，避免 Windows 路径过长。
    """

    value = clean_title(name)
    value = re.sub(r'[<>:"/\\|?*]', "_", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = value.rstrip(". ")

    if len(value) > 120:
        value = value[:120].rstrip()

    return value or "未命名会话"


def get_conversation_title(payload: NotifyPayload) -> str:
    """
    从请求体中获取会话标题。

    优先级：
    1. conversationTitle：插件缓存的真实 ChatGPT 会话标题。
    2. title：当前页面标题。
    3. 未命名会话。
    """

    title = clean_title(payload.conversationTitle)
    if title != "未命名会话":
        return title

    return clean_title(payload.title)


def get_conversation_file(payload: NotifyPayload) -> Path:
    """
    根据会话标题生成 Markdown 保存路径。

    一个 ChatGPT 会话固定对应一个 Markdown 文件。
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

    参数：
        title: 弹窗标题。
        message: 弹窗内容。

    说明：
    这个函数失败不影响主流程。
    如果你不想每次回答结束都弹窗，可以直接注释 gpt_finished() 里的调用。
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
        print(f"弹窗失败：{exc}")


# =========================
# 可选：调用你自己的本地程序
# =========================
def call_your_program(event_type: str, markdown_file: Optional[Path] = None):
    """
    可选扩展点：调用你自己的 exe / bat / Java 程序。

    参数：
        event_type: 事件类型，例如 finished。
        markdown_file: 本次保存的 Markdown 文件路径。

    示例：
        subprocess.Popen([
            "D:\\your_app\\notify.exe",
            event_type,
            str(markdown_file or "")
        ], shell=False)

    默认不调用任何外部程序。
    """

    return


# =========================
# Markdown 构建
# =========================
def build_message_markdown(payload: NotifyPayload) -> str:
    """
    构建会话消息部分 Markdown。

    保存策略：
    1. 如果插件发送了 pageData / conversationSnapshot：
       保存完整可见消息列表，包括 user / assistant / tool。

    2. 如果没有完整快照：
       退回旧版逻辑，只保存最后一轮 userText / replyText。
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
    兼容旧插件：追加保存最后一轮问答。

    使用场景：
    插件没有发送完整 pageData 时，避免覆盖旧内容。
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

    接口：
        POST /gpt-finished

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

    log_file = LOG_DIR / "finished.log"
    with log_file.open("a", encoding="utf-8") as f:
        f.write(
            f"{now.strftime('%Y-%m-%d %H:%M:%S')} "
            f"保存会话：{get_conversation_title(payload)} -> {file_path}\n"
        )

    show_windows_message("ChatGPT 通知", "GPT 回答结束，内容已保存")

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

    接口：
        POST /send-chat-message

    请求示例：
    1. 不指定 targetUrl：发给当前前台激活的 ChatGPT 页面。
       {"text": "继续"}

    2. 指定 targetUrl：只发给 URL 匹配的 ChatGPT 页面，后台标签页也可以尝试发送。
       {"text": "继续", "targetUrl": "https://chatgpt.com/c/xxxx"}

    注意：
    这里只是加入队列，不代表已经发送到 ChatGPT。
    真正发送由 Chrome 插件轮询 /next-chat-message 完成。
    """

    text = (payload.text or "").strip()
    target_url = normalize_url(payload.targetUrl)

    if not text:
        return {
            "success": False,
            "message": "消息内容不能为空",
            "queueSize": len(pending_chat_messages)
        }

    message = {
        "id": uuid4().hex,
        "text": text,
        "targetUrl": target_url,
        "createdAt": datetime.datetime.now().isoformat(),
        "claimedBy": "",
        "claimExpiresAt": ""
    }

    pending_chat_messages.append(message)

    return {
        "success": True,
        "message": "消息已加入待发送队列",
        "data": message,
        "queueSize": len(pending_chat_messages)
    }


@app.get("/next-chat-message")
def next_chat_message(pageUrl: str = "", pageActive: bool = False, pageId: str = ""):
    """
    插件轮询这个接口，用于领取一条待发送消息。

    接口：
        GET /next-chat-message?pageUrl=...&pageActive=...&pageId=...

    参数：
        pageUrl: 当前 ChatGPT 页面 URL。
        pageActive: 当前页面是否前台激活。
        pageId: 当前页面唯一 ID。

    匹配规则：
    1. targetUrl 为空：只有 pageActive=true 的当前前台页面能取走。
    2. targetUrl 不为空：只要 pageUrl 与 targetUrl 匹配即可取走，不强制前台。
    3. 命中后会短暂加锁，避免多个窗口重复发送。

    注意：
    返回消息后不会立刻从队列删除。
    必须等插件调用 /ack-chat-message 后才删除。
    """

    if not pending_chat_messages:
        return {
            "success": True,
            "hasMessage": False,
            "message": None,
            "queueSize": 0
        }

    now = datetime.datetime.now()

    for message in pending_chat_messages:
        if not is_message_match_page(message, pageUrl, pageActive):
            continue

        if not is_claim_available(message, pageId, now):
            continue

        claim_message(message, pageId, now)

        return {
            "success": True,
            "hasMessage": True,
            "message": message,
            "queueSize": len(pending_chat_messages)
        }

    return {
        "success": True,
        "hasMessage": False,
        "message": None,
        "queueSize": len(pending_chat_messages)
    }


@app.post("/ack-chat-message")
def ack_chat_message(payload: AckChatPayload):
    """
    插件确认消息已经成功发送后调用。

    接口：
        POST /ack-chat-message

    删除条件：
    - 根据 message_id 从 pending_chat_messages 中删除对应消息。

    说明：
    插件会在确认最后一条用户消息已经出现在 ChatGPT 页面后再调用这个接口。
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

    接口：
        POST /github-confirm-request

    功能：
    - 写入 local-server/logs/github_confirm.log。
    - 记录会话标题、页面 URL、文件路径、校验结果、用户最后提问。
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
    健康检查接口。

    接口：
        GET /health

    用途：
    1. 检查本地服务是否启动。
    2. 查看当前待发送队列状态。
    3. 查看有多少消息指定了 targetUrl、多少消息已被领取。
    """

    targeted_count = len([
        item for item in pending_chat_messages
        if item.get("targetUrl")
    ])
    claimed_count = len([
        item for item in pending_chat_messages
        if item.get("claimedBy")
    ])

    return {
        "success": True,
        "message": "GPT 本地通知服务运行中",
        "pendingChatMessages": len(pending_chat_messages),
        "targetedChatMessages": targeted_count,
        "claimedChatMessages": claimed_count
    }


# =========================
# 启动服务
# =========================
if __name__ == "__main__":
    # host 固定为 127.0.0.1，只允许本机访问。
    # port 需要和 chrome-extension/config.js 里的 localServerBaseUrl 保持一致。
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=18888
    )
