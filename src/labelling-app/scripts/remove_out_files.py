"""
remove_out_files.py — Remove files/folders whose names contain a substring.

Usage:
  python remove_out_files.py [OPTIONS]

Options:
  -r, --root DIR      Directory to scan (default: server_outputs next to script, else CWD)
  -p, --pattern STR  Substring a name must contain to be targeted (default: out_part)
  -n, --dry-run      List matches without deleting
  -f, --force        Skip confirmation prompt

Examples:
  python remove_out_files.py --dry-run
  python remove_out_files.py --root ~/capstone --pattern out_part
  python remove_out_files.py --force
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove files/folders whose names contain a substring.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "-r", "--root",
        type=Path,
        default=None,
        help="Directory to scan (default: server_outputs next to script, else CWD).",
    )
    parser.add_argument(
        "-p", "--pattern",
        default="out_part",
        help="Substring a name must contain (case-insensitive, default: out_part).",
    )
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="List matches without deleting.",
    )
    parser.add_argument(
        "-f", "--force",
        action="store_true",
        help="Skip confirmation prompt.",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    default_root = script_dir / "server_outputs"

    if args.root is not None:
        root_dir = args.root.resolve()
    else:
        root_dir = default_root.resolve() if default_root.is_dir() else Path.cwd().resolve()

    if not root_dir.is_dir():
        print(f"Directory not found: {root_dir}", file=sys.stderr)
        sys.exit(1)

    pattern_lower = args.pattern.lower()

    # Walk and collect all items whose basename contains the pattern.
    # Skip descendants of an already-matched directory so we don't double-list.
    targets: list[Path] = []
    matched_dirs: set[Path] = set()

    for path in sorted(root_dir.rglob("*"), key=lambda p: (len(p.parts), str(p))):
        if not path.exists():
            continue
        # Skip if under an already-matched dir
        if any(d in path.parents for d in matched_dirs):
            continue
        if pattern_lower not in path.name.lower():
            continue
        targets.append(path)
        if path.is_dir():
            matched_dirs.add(path)

    if not targets:
        print(f"No files or folders found whose names contain '{args.pattern}'.")
        return

    file_count = sum(1 for t in targets if t.is_file())
    dir_count = len(targets) - file_count

    print(f"Scanning : {root_dir}")
    print(f"Pattern  : name contains '{args.pattern}' (case-insensitive)")
    if args.dry_run:
        print("[DRY RUN — nothing will be deleted]")
    print()
    print(f"Found {len(targets)} item(s) to remove  ({dir_count} folder(s), {file_count} file(s)):")
    for t in targets:
        try:
            rel = t.relative_to(root_dir)
        except ValueError:
            rel = t
        tag = "[DIR] " if t.is_dir() else "[FILE]"
        print(f"  {tag} {rel}")
    print()

    if args.dry_run:
        print("Dry-run complete. No changes made.")
        return

    if not args.force:
        answer = input(f"Delete all {len(targets)} item(s)? Type YES to confirm: ").strip()
        if answer != "YES":
            print("Aborted.")
            return

    # Delete deepest first so we remove children before parents
    deleted = 0
    failed = 0
    for t in sorted(targets, key=lambda p: (-len(p.parts), str(p))):
        try:
            rel = t.relative_to(root_dir)
        except ValueError:
            rel = t
        try:
            if t.is_dir():
                shutil.rmtree(t)
            else:
                t.unlink()
            print(f"  Deleted: {rel}")
            deleted += 1
        except OSError as e:
            print(f"  FAILED : {rel} — {e}", file=sys.stderr)
            failed += 1

    print()
    print(f"Done. Deleted: {deleted}  Failed: {failed}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
