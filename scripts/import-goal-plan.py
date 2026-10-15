"""Import the goal-plan workbook into the local AI Workbench SQLite database.

Usage:
  python scripts/import-goal-plan.py <workbook.xlsx> [--replace]

Without --replace the script only validates and reports the import plan.
"""

from __future__ import annotations

import argparse
import datetime as dt
import shutil
import sqlite3
import sys
from pathlib import Path

import openpyxl


PROFILE_ID = "local-profile"
HORIZONS = {"十年": "10年", "五年": "5年", "三年": "3年", "一年": "1年"}
ACTION_STATUS = {"未开始": "待开始"}


def cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    if isinstance(value, dt.date):
        return dt.datetime.combine(value, dt.time()).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return str(value).strip()


def rows(sheet: openpyxl.worksheet.worksheet.Worksheet) -> list[list[str]]:
    result: list[list[str]] = []
    for source in sheet.iter_rows(min_row=5, values_only=True):
        values = [cell_text(value) for value in source]
        if values and values[0]:
            result.append(values)
    return result


def split_milestones(value: str) -> list[str]:
    return [part.strip() for part in value.replace("→", "\n").splitlines() if part.strip()]


def import_plan(workbook_path: Path, database_path: Path, replace: bool) -> None:
    workbook = openpyxl.load_workbook(workbook_path, data_only=True, read_only=True)
    try:
        if len(workbook.worksheets) < 7:
            raise ValueError("工作簿缺少目标、关键结果、项目或任务工作表")
        goals = rows(workbook.worksheets[3])
        key_results = rows(workbook.worksheets[4])
        projects = rows(workbook.worksheets[5])
        actions = rows(workbook.worksheets[6])
    finally:
        workbook.close()

    if not goals or not projects or not actions:
        raise ValueError("未找到完整的目标、项目和任务数据")
    unknown_horizons = sorted({row[1] for row in goals if row[1] not in HORIZONS})
    if unknown_horizons:
        raise ValueError(f"不支持的目标周期：{'、'.join(unknown_horizons)}")
    goal_ids = {row[0] for row in goals}
    project_ids = {row[0] for row in projects}
    if any(row[17] and row[17] not in goal_ids for row in goals):
        raise ValueError("存在找不到父级目标的目标记录")
    if any(row[1] not in goal_ids for row in projects):
        raise ValueError("存在找不到关联目标的项目记录")
    if any(row[1] not in project_ids for row in actions):
        raise ValueError("存在找不到关联项目的任务记录")

    print(f"Validated: {len(goals)} goals, {len(key_results)} key results, {len(projects)} projects, {len(actions)} actions")
    if not replace:
        return

    if not database_path.exists():
        raise FileNotFoundError(f"未找到本地数据库：{database_path}")
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = database_path.with_name(f"ai-workbench-before-goal-import-{timestamp}.db")
    shutil.copy2(database_path, backup_path)

    conn = sqlite3.connect(database_path)
    try:
        now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM Action WHERE profileId = ?", (PROFILE_ID,))
        conn.execute("DELETE FROM Project WHERE profileId = ?", (PROFILE_ID,))
        conn.execute("DELETE FROM Goal WHERE profileId = ?", (PROFILE_ID,))

        key_results_by_goal: dict[str, list[list[str]]] = {}
        for row in key_results:
            key_results_by_goal.setdefault(row[1], []).append(row)
        for row in goals:
            metrics = []
            for key_result in key_results_by_goal.get(row[0], []):
                metrics.append(f"{key_result[0]}：{key_result[2]}（目标 {key_result[4]} {key_result[5]}；截止 {key_result[6]}；证据：{key_result[7]}）")
            description = "\n".join(part for part in [
                f"领域：{row[3]}",
                row[5],
                f"当前基础：{row[6]}",
                f"为什么重要：{row[9]}",
                f"不可违背：{row[10]}",
                f"前提条件：{row[11]}",
                f"主要风险：{row[12]}",
            ] if part)
            conn.execute(
                "INSERT INTO Goal (id, profileId, parentId, title, description, horizon, status, metric, deadline, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row[0], PROFILE_ID, row[17] or None, row[4], description, HORIZONS[row[1]], row[15] or "待确认", "\n".join(metrics) or row[7], row[2] or None, now, now),
            )

        project_goal_ids = {row[0]: row[1] for row in projects}
        for row in projects:
            conn.execute(
                "INSERT INTO Project (id, profileId, goalId, name, description, status, metric, budget, boundary, stopCondition, risk, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row[0], PROFILE_ID, row[1], row[3], row[4], ACTION_STATUS.get(row[11], row[11] or "待开始"), row[10], row[8], row[13], "", row[13], now, now),
            )
            for index, milestone in enumerate(split_milestones(row[9]), start=1):
                conn.execute(
                    "INSERT INTO Milestone (id, projectId, title, deadline, status, metric, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (f"{row[0]}-M{index}", row[0], milestone, row[6] or None, "未开始", row[10], now, now),
                )

        for row in actions:
            project_id = row[1]
            purpose = "\n".join(part for part in [f"负责人：{row[3]}", f"下一步：{row[11]}"] if part and not part.endswith("："))
            conn.execute(
                "INSERT INTO Action (id, profileId, goalId, projectId, title, purpose, dueDate, estimatedHours, standard, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row[0], PROFILE_ID, project_goal_ids[project_id], project_id, row[2], purpose, row[5] or None, float(row[10] or 1), row[8], ACTION_STATUS.get(row[7], row[7] or "待开始"), now, now),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f"Imported successfully. Backup: {backup_path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    import_plan(args.workbook, root / "data" / "ai-workbench.db", args.replace)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
