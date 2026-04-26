#!/usr/bin/env python3
"""Clean up XML files in uploads/ older than N days.
The xml_uploads DB table keeps filename/md5/status/error_message for audit;
only the disk payload is removed. archive_* tables are the authoritative data source.

Usage: cleanup_uploads.py <uploads_dir> [days=14]
"""
import os
import sys
import time


def cleanup(uploads_dir, days=14):
    if not os.path.isdir(uploads_dir):
        print(f"[cleanup] Skip (not a directory): {uploads_dir}")
        return 0
    cutoff = time.time() - days * 86400
    removed = 0
    freed = 0
    for name in os.listdir(uploads_dir):
        if not name.endswith(".xml"):
            continue
        path = os.path.join(uploads_dir, name)
        try:
            st = os.stat(path)
        except FileNotFoundError:
            continue
        if st.st_mtime > cutoff:
            continue
        freed += st.st_size
        try:
            os.remove(path)
            removed += 1
        except Exception as e:
            print(f"[cleanup] Failed to remove {path}: {e}")
    print(f"[cleanup] {uploads_dir}: removed {removed} files, freed {freed/1024/1024:.1f} MB (>{days}d old)")
    return removed


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: cleanup_uploads.py <uploads_dir> [days=14]")
        sys.exit(1)
    uploads_dir = sys.argv[1]
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 14
    cleanup(uploads_dir, days)
