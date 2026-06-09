"""Single task runner launched by Java Task Center.

Usage:
    python -m app.task_runner --task-id 1001

Java owns scheduling and process launching. Python executes exactly one job_task,
writes local logs during execution, updates final status/result/log_path, then exits.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import pymysql

from app.core.config import get_settings

LOG_DIR = Path("logs/tasks")


def _get_conn():
    s = get_settings()
    return pymysql.connect(
        host=s.mysql_host,
        port=s.mysql_port,
        user=s.mysql_user,
        password=s.mysql_password,
        database=s.mysql_database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def setup_task_logger(task_id: int) -> tuple[logging.Logger, str]:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"job_task_{task_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    logger = logging.getLogger(f"task_runner.{task_id}")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    return logger, str(log_path)


def fetch_task(conn, task_id: int) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM job_task WHERE id=%s", (task_id,))
        row = cur.fetchone()
    if not row:
        raise ValueError(f"job_task not found: {task_id}")
    return row


def mark_running(conn, task_id: int, log_path: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE job_task SET status='running', start_time=COALESCE(start_time, NOW()), "
            "end_time=NULL, error_message=NULL, progress=0, current_step='执行中', "
            "result_json=NULL, log_path=%s WHERE id=%s AND status IN ('pending','failed')",
            (log_path, task_id),
        )
        conn.commit()
        return cur.rowcount > 0


def finish_task(conn, task_id: int, *, status: str, result: Any | None = None, error: str | None = None, log_path: str | None = None):
    result_json = json.dumps(result, ensure_ascii=False, default=str) if result is not None else None
    summary_json = None
    if isinstance(result, dict) and result.get("updated_summary") is not None:
        summary_json = json.dumps(result.get("updated_summary"), ensure_ascii=False, default=str)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE job_task SET status=%s, progress=%s, current_step=%s, result_json=%s, "
            "updated_summary_json=COALESCE(%s, updated_summary_json), error_message=%s, "
            "log_path=COALESCE(%s, log_path), end_time=NOW(), "
            "duration_ms=TIMESTAMPDIFF(MICROSECOND, start_time, NOW())/1000 WHERE id=%s",
            (
                status,
                100 if status == "success" else None,
                "已完成" if status == "success" else "执行失败",
                result_json,
                summary_json,
                error,
                log_path,
                task_id,
            ),
        )
        conn.commit()


def save_cursor(conn, task_id: int, cursor: dict[str, Any]):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE job_task SET resume_cursor_json=%s WHERE id=%s",
            (json.dumps(cursor, ensure_ascii=False, default=str), task_id),
        )
        conn.commit()


class TaskContext:
    def __init__(self, conn, task: dict[str, Any], logger: logging.Logger):
        self.conn = conn
        self.task = task
        self.task_id = int(task["id"])
        self.logger = logger

    @property
    def params(self) -> dict[str, Any]:
        return json.loads(self.task.get("params_json") or "{}")

    @property
    def resume_cursor(self) -> dict[str, Any]:
        return json.loads(self.task.get("resume_cursor_json") or "{}")

    def save_cursor(self, cursor: dict[str, Any]):
        save_cursor(self.conn, self.task_id, cursor)


def handle_sync_1d(ctx: TaskContext) -> dict[str, Any]:
    params = ctx.params
    symbols = params.get("symbols") or []
    start_date = params.get("start_date")
    end_date = params.get("end_date")
    if not symbols:
        raise ValueError("params_json.symbols is required")

    from app.modules.sync.providers.akshare_provider import AkshareProvider
    from app.modules.sync.normalizer import normalize_daily_bar, normalize_symbol
    from app.modules.sync.quality_checker import check_daily_bars
    from app.modules.market.td_writer import create_daily_subtable, write_daily_bars
    from app.modules.market.snapshot_writer import refresh_market_snapshot

    provider = AkshareProvider()
    if not provider.health().get("available"):
        raise RuntimeError("akshare is not available")

    total = len(symbols)
    start_index = int(ctx.resume_cursor.get("next_index") or 0)
    success = 0
    failed = 0
    results: dict[str, Any] = {}
    updated_summary = {
        "tdengine": {"stable": "data_1d", "tables": [], "rows": 0},
        "mysql": {"tables": ["market_snapshot"], "rows": 0},
        "symbols": [],
    }

    ctx.logger.info("sync_1d started, total=%s, start_index=%s", total, start_index)
    for i, symbol in enumerate(symbols):
        if i < start_index:
            ctx.logger.info("skip completed symbol index=%s symbol=%s", i, symbol)
            continue
        ctx.save_cursor({"next_index": i, "current_symbol": symbol, "total": total})
        ctx.logger.info("[%s/%s] fetch daily bars: %s", i + 1, total, symbol)
        try:
            normalized_symbol = normalize_symbol(symbol)
            raw = provider.fetch_daily_bars(normalized_symbol, start_date=start_date, end_date=end_date)
            ctx.logger.info("normalize and quality check: %s", normalized_symbol)
            normalized = [normalize_daily_bar(bar, "akshare") for bar in raw]
            quality = check_daily_bars(normalized)
            ctx.logger.info("write TDengine: %s rows=%s", normalized_symbol, len(normalized))
            create_daily_subtable(normalized_symbol, stock_type="stock", stock_name=symbol)
            written = write_daily_bars(normalized_symbol, normalized, start_date=start_date, end_date=end_date)
            ctx.logger.info("refresh market_snapshot: %s", normalized_symbol)
            refresh_market_snapshot(normalized_symbol, normalized)
            success += 1
            table_name = "d1_" + normalized_symbol.replace(".", "_").lower()
            updated_summary["tdengine"]["tables"].append(table_name)
            updated_summary["tdengine"]["rows"] += int(written or 0)
            updated_summary["mysql"]["rows"] += 1
            updated_summary["symbols"].append(normalized_symbol)
            results[symbol] = {"status": "success", "count": len(normalized), "written": written, "quality": quality}
        except Exception as exc:
            failed += 1
            ctx.logger.exception("sync failed: %s", symbol)
            results[symbol] = {"status": "failed", "error": str(exc)}
        ctx.save_cursor({"next_index": i + 1, "total": total})

    ctx.save_cursor({"next_index": total, "total": total, "done": True})
    return {"total": total, "success": success, "failed": failed, "results": results, "updated_summary": updated_summary}


def handle_backtest(ctx: TaskContext) -> dict[str, Any]:
    params = ctx.params
    backtest_task_id = int(params.get("backtest_task_id") or ctx.task_id)
    from app.modules.backtest.service import BacktestService
    from app.modules.backtest.result_repository import BacktestResultRepository
    config = {
        "task_id": str(backtest_task_id),
        "symbol": params.get("symbol", ""),
        "start_date": params.get("start_date"),
        "end_date": params.get("end_date"),
        "initial_cash": params.get("initial_cash", 1_000_000),
        "fee_rate": params.get("fee_rate", 0.0003),
        "slippage_ticks": params.get("slippage_ticks", 0),
        "position_size": params.get("position_size", 1.0),
    }
    ctx.logger.info("run backtest: %s", config)
    result = BacktestService().run_backtest(config)
    metrics = result.get("metrics", {})
    BacktestResultRepository().upsert_result(backtest_task_id, metrics)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "UPDATE backtest_task SET status='success', progress=100, error_message=NULL, result_summary=%s, end_time=NOW(), duration_ms=%s WHERE id=%s",
            (json.dumps(metrics, ensure_ascii=False, default=str), result.get("duration_ms"), backtest_task_id),
        )
        ctx.conn.commit()
    return {**result, "job_task_id": ctx.task_id, "backtest_task_id": backtest_task_id, "updated_summary": {"mysql": {"tables": ["backtest_task", "backtest_result"], "rows": 2}}}


def handle_ai(ctx: TaskContext) -> dict[str, Any]:
    params = ctx.params
    from app.modules.ai.service import AiAnalysisService
    return AiAnalysisService().prepare_analysis(
        scene=params.get("scene", "security_analysis"),
        target_type=params.get("target_type"),
        target_id=params.get("target_id"),
        target_name=params.get("target_name"),
        symbol=params.get("symbol"),
        question=params.get("question", ""),
    )


HANDLERS: dict[str, Callable[[TaskContext], dict[str, Any]]] = {
    "sync_1d": handle_sync_1d,
    "sync_daily": handle_sync_1d,
    "backtest": handle_backtest,
    "ai": handle_ai,
}


def run_task(task_id: int) -> int:
    logger, log_path = setup_task_logger(task_id)
    conn = None
    try:
        conn = _get_conn()
        task = fetch_task(conn, task_id)
        task_type = task.get("task_type") or task.get("taskType")
        handler = HANDLERS.get(task_type)
        if not handler:
            raise ValueError(f"Unknown task_type: {task_type}")
        if not mark_running(conn, task_id, log_path):
            raise RuntimeError(f"Task {task_id} cannot be marked running. status may not be pending/failed.")
        logger.info("task started: id=%s type=%s", task_id, task_type)
        result = handler(TaskContext(conn, task, logger))
        finish_task(conn, task_id, status="success", result=result, log_path=log_path)
        logger.info("task success: id=%s", task_id)
        return 0
    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("task failed: %s\n%s", exc, tb)
        if conn:
            try:
                finish_task(conn, task_id, status="failed", error=str(exc), log_path=log_path)
            except Exception:
                logger.exception("failed to mark task failed")
        return 1
    finally:
        if conn:
            conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one job_task by task id.")
    parser.add_argument("--task-id", type=int, required=True)
    args = parser.parse_args()
    return run_task(args.task_id)


if __name__ == "__main__":
    raise SystemExit(main())
