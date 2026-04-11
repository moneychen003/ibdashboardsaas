"""Minimal backup helpers."""
import os
import shutil
import json
from datetime import datetime

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(APP_DIR, "backups")
DATA_DIR = os.path.join(APP_DIR, "data")

def list_backups():
    if not os.path.exists(BACKUP_DIR):
        return []
    items = []
    for name in sorted(os.listdir(BACKUP_DIR), reverse=True):
        path = os.path.join(BACKUP_DIR, name)
        if not os.path.isdir(path):
            continue
        size = sum(os.path.getsize(os.path.join(dirpath, f)) for dirpath, _, filenames in os.walk(path) for f in filenames)
        items.append({
            "timestamp": name,
            "type": "manual",
            "sizeMB": round(size / (1024 * 1024), 2)
        })
    return items


def create_backup():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, ts)
    os.makedirs(path, exist_ok=True)
    for fname in os.listdir(DATA_DIR):
        src = os.path.join(DATA_DIR, fname)
        if os.path.isfile(src):
            shutil.copy2(src, path)
    return ts


def restore_backup(ts):
    src = os.path.join(BACKUP_DIR, ts)
    if not os.path.isdir(src):
        return False
    for fname in os.listdir(src):
        shutil.copy2(os.path.join(src, fname), DATA_DIR)
    return True


def cleanup_old_backups(keep=15):
    backups = sorted([d for d in os.listdir(BACKUP_DIR) if os.path.isdir(os.path.join(BACKUP_DIR, d))])
    removed = 0
    for old in backups[:-keep]:
        shutil.rmtree(os.path.join(BACKUP_DIR, old))
        removed += 1
    return removed


def cleanup_uploads(days=30):
    uploads_dir = os.path.join(APP_DIR, "uploads")
    removed = 0
    if os.path.exists(uploads_dir):
        for f in os.listdir(uploads_dir):
            path = os.path.join(uploads_dir, f)
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            if (datetime.now() - mtime).days > days:
                os.remove(path)
                removed += 1
    return removed


def cleanup_logs(days=90):
    logs_dir = os.path.join(APP_DIR, "logs")
    removed = 0
    if os.path.exists(logs_dir):
        for f in os.listdir(logs_dir):
            path = os.path.join(logs_dir, f)
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            if (datetime.now() - mtime).days > days:
                os.remove(path)
                removed += 1
    return removed
