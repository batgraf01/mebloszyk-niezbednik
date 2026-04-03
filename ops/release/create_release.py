#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


DEFAULT_ITEMS = [
    "app.py",
    "templates/base_panel.html",
    "templates/kontakty.html",
    "shared/kontakty.json",
]


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def git_head(root: Path) -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(root),
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return out.strip()
    except Exception:
        return ""


def append_zmiany(root: Path, line: str) -> None:
    log_path = root / "zmiany.log"
    with log_path.open("a", encoding="utf-8") as f:
        f.write(line.rstrip() + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create versioned release snapshot.")
    parser.add_argument("--root", default=".", help="Project root (default: current directory)")
    parser.add_argument(
        "--backup-dir",
        default="backups/releases",
        help="Backup directory relative to root (default: backups/releases)",
    )
    parser.add_argument("--change-id", default="", help="Custom change id, e.g. R-20260403-001")
    parser.add_argument("--note", default="", help="Short note for change log")
    parser.add_argument(
        "--items",
        nargs="*",
        default=DEFAULT_ITEMS,
        help="Relative paths to include in snapshot",
    )
    parser.add_argument("--keep", type=int, default=20, help="How many latest snapshots keep (default: 20)")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    backup_dir = (root / args.backup_dir).resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)

    now = utc_now()
    stamp = now.strftime("%Y%m%d_%H%M%S")
    change_id = (args.change_id or f"R-{now.strftime('%Y%m%d-%H%M%S')}").strip()
    safe_change_id = "".join(ch for ch in change_id if ch.isalnum() or ch in ("-", "_"))
    snapshot_dir = backup_dir / f"{safe_change_id}__{stamp}"
    snapshot_dir.mkdir(parents=True, exist_ok=False)

    copied: list[dict[str, str]] = []
    missing: list[str] = []

    for rel in args.items:
        rel_path = Path(rel)
        src = (root / rel_path).resolve()
        if not src.exists():
            missing.append(str(rel_path).replace("\\", "/"))
            continue
        if not src.is_file():
            missing.append(str(rel_path).replace("\\", "/"))
            continue

        dst = snapshot_dir / rel_path
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(
            {
                "path": str(rel_path).replace("\\", "/"),
                "size": str(src.stat().st_size),
                "sha256": sha256_file(src),
            }
        )

    metadata = {
        "change_id": safe_change_id,
        "created_at_utc": now.isoformat(),
        "note": args.note.strip(),
        "project_root": str(root),
        "git_head": git_head(root),
        "copied_files": copied,
        "missing_files": missing,
    }
    with (snapshot_dir / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    append_zmiany(
        root,
        f"{now.isoformat()} | RELEASE | {safe_change_id} | {args.note.strip()} | {snapshot_dir.name} | files={len(copied)}",
    )

    # Retention: keep newest N snapshots.
    snapshots = [p for p in backup_dir.iterdir() if p.is_dir()]
    snapshots.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for old in snapshots[args.keep :]:
        shutil.rmtree(old, ignore_errors=True)

    print(f"[OK] Snapshot: {snapshot_dir}")
    print(f"[OK] Copied files: {len(copied)}")
    if missing:
        print(f"[WARN] Missing files: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

