"""Deprecated worker entry.

The old MySQL polling worker mode has been removed.

Use the Java task center to launch one Python process per task instead:

    python -m app.task_runner --task-id <JOB_TASK_ID>

This file intentionally exits with an error so old startup scripts fail fast
instead of silently running the obsolete polling loop.
"""

from __future__ import annotations

import sys


if __name__ == "__main__":
    print(
        "app.worker has been removed. Use: python -m app.task_runner --task-id <JOB_TASK_ID>",
        file=sys.stderr,
    )
    sys.exit(2)
