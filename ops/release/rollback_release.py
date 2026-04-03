#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import shutil
import subprocess
import sys


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def append_zmiany(root: Path, line: str) -> None:
    with (root / "zmiany.log").open("a", encoding="utf-8") as f:
        f.write(line.rstrip() + "\n")


def resolve_snapshot(backup_dir: Path, release_ref: str) -> Path | None:
    snapshots = [p for p in backup_dir.iterdir() if p.is_dir()]
    if not snapshots:
        return None
    snapshots.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    if not release_ref:
        return snapshots[0]
    # exact dir name or prefix by change id
    for s in snapshots:
        if s.name == release_ref or s.name.startswith(release_ref + "__"):
            return s
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Rollback files from release snapshot.")
    parser.add_argument("--root", default=".", help="Project root (default: current directory)")
    parser.add_argument(
        "--backup-dir",
        default="backups/releases",
        help="Backup directory relative to root (default: backups/releases)",
    )
    parser.add_argument(
        "--release",
        default="",
        help="Release ref (directory name or change id prefix). Empty = latest.",
    )
    parser.add_argument("--note", default="", help="Short reason for rollback")
    parser.add_argument(
        "--restart-cmd",
        default="",
        help="Optional command to run after rollback, e.g. 'sudo systemctl restart batgraf-web.service'",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    backup_dir = (root / args.backup_dir).resolve()
    if not backup_dir.exists():
        print(f"[ERR] Backup dir not found: {backup_dir}")
        return 1

    snapshot = resolve_snapshot(backup_dir, args.release.strip())
    if snapshot is None:
        print("[ERR] No matching snapshot found.")
        return 1

    metadata_path = snapshot / "metadata.json"
    if not metadata_path.exists():
        print(f"[ERR] metadata.json missing in snapshot: {snapshot}")
        return 1

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    files = metadata.get("copied_files") or []
    if not isinstance(files, list) or not files:
        print(f"[ERR] Snapshot has no copied_files: {snapshot}")
        return 1

    # Safety backup of current files before rollback.
    now = utc_now()
    safe_dir = (root / "backups" / "rollback_pre" / now.strftime("%Y%m%d_%H%M%S")).resolve()
    safe_dir.mkdir(parents=True, exist_ok=True)

    restored = 0
    for entry in files:
        rel = str(entry.get("path") or "").strip()
        if not rel:
            continue
        src = snapshot / rel
        dst = root / rel
        if not src.exists() or not src.is_file():
            continue

        if dst.exists() and dst.is_file():
            safe_dst = safe_dir / rel
            safe_dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, safe_dst)

        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        restored += 1

    append_zmiany(
        root,
        f"{now.isoformat()} | ROLLBACK | {snapshot.name} | {args.note.strip()} | restored={restored}",
    )

    if args.restart_cmd.strip():
        subprocess.run(args.restart_cmd, cwd=str(root), shell=True, check=False)

    print(f"[OK] Rolled back from: {snapshot}")
    print(f"[OK] Restored files: {restored}")
    print(f"[OK] Safety backup: {safe_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

