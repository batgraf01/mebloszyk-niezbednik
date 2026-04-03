#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys
import datetime as dt


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def append_zmiany(root: Path, line: str) -> None:
    with (root / "zmiany.log").open("a", encoding="utf-8") as f:
        f.write(line.rstrip() + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prune old release snapshots.")
    parser.add_argument("--root", default=".", help="Project root (default: current directory)")
    parser.add_argument("--backup-dir", default="backups/releases", help="Relative backup path")
    parser.add_argument("--keep", type=int, default=20, help="How many newest snapshots to keep")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    backup_dir = (root / args.backup_dir).resolve()
    if not backup_dir.exists():
        print(f"[OK] Nothing to prune: {backup_dir}")
        return 0

    snapshots = [p for p in backup_dir.iterdir() if p.is_dir()]
    snapshots.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    to_remove = snapshots[args.keep :]

    for p in to_remove:
        shutil.rmtree(p, ignore_errors=True)

    now = utc_now()
    append_zmiany(
        root,
        f"{now.isoformat()} | PRUNE | keep={args.keep} | removed={len(to_remove)}",
    )
    print(f"[OK] Removed snapshots: {len(to_remove)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

