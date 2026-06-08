# -*- coding: utf-8 -*-
"""
mimo_cli.py

Codex 调用本地 mimo_server 的轻量客户端。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List

import requests


DEFAULT_SERVER_URL = os.getenv("MIMO_SERVER_URL", "http://127.0.0.1:8765/run")


def parse_files(files_text: str) -> List[str]:
    """把英文逗号分隔的文件列表转成 list。"""
    return [item.strip() for item in files_text.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="调用本地小米模型代码修改服务")

    parser.add_argument("--task", required=True, help="要交给小米模型完成的任务")
    parser.add_argument("--files", required=True, help="相关文件，多个用英文逗号分隔")
    parser.add_argument(
        "--mode",
        default="auto",
        choices=["auto", "replace_file", "edit"],
        help="auto 自动选择；replace_file 整文件替换；edit 精准替换",
    )
    parser.add_argument("--url", default=DEFAULT_SERVER_URL, help="mimo_server /run 地址")
    parser.add_argument("--timeout", type=int, default=600, help="请求超时时间，秒")

    args = parser.parse_args()

    payload = {
        "task": args.task,
        "files": parse_files(args.files),
        "mode": args.mode,
    }

    try:
        response = requests.post(args.url, json=payload, timeout=args.timeout)
        response.raise_for_status()
        result = response.json()
    except Exception as exc:
        print(f"调用 mimo_server 失败：{exc}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False, indent=2))

    if not result.get("ok"):
        sys.exit(2)


if __name__ == "__main__":
    main()
