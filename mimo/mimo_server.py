# -*- coding: utf-8 -*-
"""
mimo_server.py

本地小米模型代码修改服务。

流程：
1. Codex / 用户调用 /run，传入 task、files、mode。
2. 服务读取指定文件内容。
3. 服务调用小米模型接口。
4. 小米模型返回 JSON。
5. 服务按 replace_file 或 edit 写回本地文件。
6. Codex 负责 build/test/功能验收。
"""

from __future__ import annotations

import json
import os
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import requests
from fastapi import FastAPI
from pydantic import BaseModel, Field


# =========================
# 基础配置
# =========================

# 小米模型 OpenAI-compatible 接口地址，例如：
# https://token-plan-sgp.xiaomimimo.com/v1/chat/completions
MIMO_API_URL = os.getenv("MIMO_API_URL", "").strip()

# 小米模型 API Key
MIMO_API_KEY = os.getenv("MIMO_API_KEY", "").strip()

# 模型名称，例如你实际购买/配置的模型名
MIMO_MODEL = os.getenv("MIMO_MODEL", "").strip()

# 项目根目录：服务只允许读写这个目录下的文件
PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT", ".")).resolve()

# 运行数据目录
MIMO_DIR = PROJECT_ROOT / ".mimo"
BACKUP_DIR = MIMO_DIR / "backup"
LOG_DIR = MIMO_DIR / "logs"

# 接口超时时间，秒
MIMO_TIMEOUT = int(os.getenv("MIMO_TIMEOUT", "300"))


app = FastAPI(title="Mimo Code Worker", version="2.0.0")


class RunRequest(BaseModel):
    """Codex 调用 /run 的请求体。"""

    task: str = Field(..., description="要让小米模型完成的任务")
    files: List[str] = Field(..., description="允许读取/修改的文件列表，使用项目相对路径")
    mode: Literal["auto", "replace_file", "edit"] = Field(
        "auto",
        description="auto 自动选择；replace_file 整文件替换；edit 精准 old/new 替换",
    )


# =========================
# 路径与文件工具
# =========================


def ensure_dirs() -> None:
    """创建 .mimo 运行目录。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)



def safe_path(file_path: str) -> Path:
    """
    把项目相对路径转换成安全的绝对路径。

    防止传入 ../../xxx 访问项目外文件。
    """
    normalized = file_path.replace("\\", "/").strip()
    full_path = (PROJECT_ROOT / normalized).resolve()

    try:
        full_path.relative_to(PROJECT_ROOT)
    except ValueError as exc:
        raise ValueError(f"非法路径，不能访问项目外文件：{file_path}") from exc

    return full_path



def read_text_file(path: Path) -> str:
    """读取文本文件，默认 UTF-8。"""
    return path.read_text(encoding="utf-8")



def write_text_file(path: Path, content: str) -> None:
    """写入文本文件，自动创建父目录。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")



def read_files(files: List[str]) -> str:
    """读取允许修改的文件内容，拼接给模型。"""
    parts: List[str] = []

    for rel_path in files:
        path = safe_path(rel_path)

        if not path.exists():
            parts.append(f"\n===== 文件不存在，可新建：{rel_path} =====\n")
            continue

        if not path.is_file():
            parts.append(f"\n===== 跳过非文件路径：{rel_path} =====\n")
            continue

        content = read_text_file(path)
        parts.append(f"\n===== {rel_path} =====\n{content}\n")

    return "\n".join(parts)



def backup_file(rel_path: str) -> None:
    """写入前备份原文件到 .mimo/backup，保留目录结构。"""
    src = safe_path(rel_path)

    if not src.exists() or not src.is_file():
        return

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / timestamp / rel_path.replace("\\", "/")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")



def write_log(name: str, data: Any) -> Path:
    """写日志到 .mimo/logs。"""
    ensure_dirs()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    path = LOG_DIR / f"{timestamp}_{name}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


# =========================
# Prompt 与模型调用
# =========================


def build_prompt(task: str, files: List[str], file_contents: str, mode: str = "auto") -> str:
    """
    构造给小米模型的提示词。

    mode:
    - auto：模型自行选择 replace_file 或 edit。
    - replace_file：返回完整文件内容，服务整文件覆盖。
    - edit：返回 old/new 片段，服务精准替换。
    """
    files_text = "\n".join(f"- {f}" for f in files)

    mode_rule = {
        "auto": "优先使用 edit 精准替换；如果改动较多或新增文件，再使用 replace_file。",
        "replace_file": "必须使用 replace_file，返回修改后完整文件内容。",
        "edit": "必须使用 edit，返回 old/new 精准替换片段。",
    }.get(mode, "优先使用 edit，必要时使用 replace_file。")

    return f"""
你是代码实现助手，负责直接完成代码修改。

任务：
{task}

只允许修改这些文件：
{files_text}

当前文件内容：
{file_contents}

修改模式要求：
{mode_rule}

硬性要求：
1. 只能修改“只允许修改”的文件。
2. 不要修改密钥、凭证、生产配置、.env。
3. 不要提交 git commit。
4. 不要新增无关依赖。
5. 返回 JSON，不要返回 Markdown，不要使用 ``` 包裹。
6. 如果无法完成，返回 ok=false 并说明原因。

返回格式 A：整文件替换
{{
  "ok": true,
  "mode": "replace_file",
  "summary": "完成了什么",
  "files": [
    {{
      "path": "文件路径",
      "content": "修改后的完整文件内容"
    }}
  ],
  "notes": "其他说明"
}}

返回格式 B：精准片段替换
{{
  "ok": true,
  "mode": "edit",
  "summary": "完成了什么",
  "edits": [
    {{
      "path": "文件路径",
      "old": "原始代码片段，必须和文件中内容完全一致",
      "new": "替换后的代码片段"
    }}
  ],
  "notes": "其他说明"
}}

失败格式：
{{
  "ok": false,
  "mode": "none",
  "summary": "无法完成的原因",
  "notes": "缺少什么信息"
}}
""".strip()



def clean_json_text(text: str) -> str:
    """清理模型可能返回的 Markdown 代码块。"""
    text = text.strip()

    if text.startswith("```json"):
        text = text[len("```json") :].strip()
    elif text.startswith("```"):
        text = text[len("```") :].strip()

    if text.endswith("```"):
        text = text[: -len("```")].strip()

    return text



def parse_model_json(content: str) -> Dict[str, Any]:
    """解析模型返回 JSON，解析失败时保存原始内容方便排查。"""
    cleaned = clean_json_text(content)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        write_log("bad_model_json", {"content": content, "cleaned": cleaned})
        raise ValueError(f"模型返回不是合法 JSON：{exc}") from exc



def call_mimo(prompt: str) -> Dict[str, Any]:
    """调用小米模型接口，按 OpenAI-compatible chat/completions 格式。"""
    if not MIMO_API_URL:
        raise RuntimeError("缺少环境变量 MIMO_API_URL")
    if not MIMO_API_KEY:
        raise RuntimeError("缺少环境变量 MIMO_API_KEY")
    if not MIMO_MODEL:
        raise RuntimeError("缺少环境变量 MIMO_MODEL")

    payload = {
        "model": MIMO_MODEL,
        "messages": [
            {"role": "system", "content": "你是代码实现助手，只输出 JSON。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "thinking": {
            "type": "disabled"
        }
    }

    write_log("request", {"url": MIMO_API_URL, "model": MIMO_MODEL, "payload": payload})

    response = requests.post(
        MIMO_API_URL,
        headers={
            "Authorization": f"Bearer {MIMO_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=MIMO_TIMEOUT,
    )

    if response.status_code >= 400:
        write_log(
            "http_error",
            {
                "status_code": response.status_code,
                "url": MIMO_API_URL,
                "response_text": response.text,
            },
        )
        raise RuntimeError(
            f"小米接口请求失败：status={response.status_code}, body={response.text[:1000]}"
        )

    data = response.json()
    write_log("response", data)

    try:
        content = data["choices"][0]["message"]["content"]
    except Exception as exc:
        raise ValueError(f"小米接口返回格式不是 OpenAI-compatible：{data}") from exc

    return parse_model_json(content)


# =========================
# 写回逻辑
# =========================


def validate_allowed_path(rel_path: str, allowed_files: List[str]) -> None:
    """确保模型返回的 path 在允许修改文件列表内。"""
    normalized = rel_path.replace("\\", "/").strip()
    allowed = {item.replace("\\", "/").strip() for item in allowed_files}
    if normalized not in allowed:
        raise ValueError(f"模型尝试修改未授权文件：{rel_path}")



def write_files(files: List[Dict[str, Any]], allowed_files: List[str]) -> List[str]:
    """整文件覆盖写入。"""
    written_files: List[str] = []

    for item in files:
        rel_path = str(item.get("path", "")).strip()
        content = item.get("content")

        if not rel_path:
            raise ValueError("模型返回 files 中缺少 path")
        if content is None:
            raise ValueError(f"模型返回文件缺少 content：{rel_path}")

        validate_allowed_path(rel_path, allowed_files)
        backup_file(rel_path)

        path = safe_path(rel_path)
        write_text_file(path, str(content))
        written_files.append(rel_path)

    return written_files



def apply_edits(edits: List[Dict[str, Any]], allowed_files: List[str]) -> List[str]:
    """按 old/new 片段精准替换。"""
    written_files: List[str] = []

    for item in edits:
        rel_path = str(item.get("path", "")).strip()
        old = item.get("old")
        new = item.get("new")

        if not rel_path:
            raise ValueError("模型返回 edits 中缺少 path")
        if old is None:
            raise ValueError(f"模型返回 edit 缺少 old：{rel_path}")
        if new is None:
            raise ValueError(f"模型返回 edit 缺少 new：{rel_path}")

        validate_allowed_path(rel_path, allowed_files)

        path = safe_path(rel_path)
        if not path.exists():
            raise FileNotFoundError(f"edit 模式不能修改不存在的文件：{rel_path}")

        content = read_text_file(path)
        old_text = str(old)
        new_text = str(new)

        count = content.count(old_text)
        if count == 0:
            raise ValueError(f"old 片段在文件中未找到：{rel_path}")
        if count > 1:
            raise ValueError(f"old 片段在文件中出现多次，无法安全替换：{rel_path}")

        backup_file(rel_path)
        updated = content.replace(old_text, new_text, 1)
        write_text_file(path, updated)
        written_files.append(rel_path)

    return sorted(set(written_files))



def apply_result(result: Dict[str, Any], allowed_files: List[str]) -> List[str]:
    """根据模型返回 mode 写回文件。"""
    mode = result.get("mode")

    if mode == "replace_file":
        return write_files(result.get("files", []), allowed_files)

    if mode == "edit":
        return apply_edits(result.get("edits", []), allowed_files)

    # 兼容模型忘记返回 mode，但返回了 files/edits 的情况
    if result.get("files"):
        return write_files(result.get("files", []), allowed_files)
    if result.get("edits"):
        return apply_edits(result.get("edits", []), allowed_files)

    return []


# =========================
# FastAPI 接口
# =========================


@app.get("/health")
def health() -> Dict[str, Any]:
    """健康检查。"""
    return {
        "ok": True,
        "status": "running",
        "project_root": str(PROJECT_ROOT),
        "model": MIMO_MODEL,
        "api_url_set": bool(MIMO_API_URL),
    }


@app.post("/run")
def run_task(req: RunRequest) -> Dict[str, Any]:
    """核心接口：读取文件 -> 调模型 -> 写回文件。"""
    started = time.time()
    ensure_dirs()

    try:
        file_contents = read_files(req.files)
        prompt = build_prompt(
            task=req.task,
            files=req.files,
            file_contents=file_contents,
            mode=req.mode,
        )

        result = call_mimo(prompt)
        write_log("model_result", result)

        if not result.get("ok"):
            return {
                "ok": False,
                "summary": result.get("summary", "模型未完成任务"),
                "notes": result.get("notes", ""),
                "raw": result,
                "elapsed": round(time.time() - started, 3),
            }

        written_files = apply_result(result, req.files)

        return {
            "ok": True,
            "summary": result.get("summary", ""),
            "mode": result.get("mode", "unknown"),
            "written_files": written_files,
            "notes": result.get("notes", ""),
            "elapsed": round(time.time() - started, 3),
        }

    except Exception as exc:
        traceback.print_exc()
        write_log(
            "server_error",
            {
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "request": req.model_dump(),
            },
        )
        return {
            "ok": False,
            "summary": "mimo_server 内部错误",
            "error": str(exc),
            "elapsed": round(time.time() - started, 3),
        }
