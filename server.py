#!/usr/bin/env python3
"""IB Dashboard - Flask backend with session auth, permission control,
auto-refresh, export, and security hardening."""

import hashlib
import json
import os
import sys
import time
import shutil
import io
import csv
import tarfile
import traceback
import urllib.request
from db.postgres_client import execute, execute_one
from pathlib import Path
from datetime import datetime, timedelta
from functools import wraps
from subprocess import run, PIPE
from threading import Thread
from flask import (
    Flask, session, request, jsonify,
    send_from_directory, redirect, Response
)

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(APP_DIR, "config", "server_config.json")
LOG_DIR = os.path.join(APP_DIR, "logs")
BACKUP_DIR = os.path.join(APP_DIR, "backups")
UPLOAD_DIR = os.path.join(APP_DIR, "uploads")
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Simple in-memory rate-limiting for login attempts
LOGIN_ATTEMPTS = {}
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_SECONDS = 900  # 15 minutes

# Dashboard JSON cache: {file_path: (mtime, payload)}
_DASHBOARD_CACHE = {}

# Background job status for refresh/import
_BG_JOBS = {}

# DQ cache: {timestamp: report}
_DQ_CACHE = {}

# Logging
import logging
from logging.handlers import RotatingFileHandler

_access_logger = logging.getLogger("ib_dashboard.access")
if not _access_logger.handlers:
    _hdl = RotatingFileHandler(os.path.join(LOG_DIR, "access.log"), maxBytes=10*1024*1024, backupCount=5, encoding="utf-8")
    _hdl.setFormatter(logging.Formatter("%(message)s"))
    _access_logger.addHandler(_hdl)
    _access_logger.setLevel(logging.INFO)

_app_logger = logging.getLogger("ib_dashboard.app")
if not _app_logger.handlers:
    _app_hdl = RotatingFileHandler(os.path.join(LOG_DIR, "app.log"), maxBytes=10*1024*1024, backupCount=5, encoding="utf-8")
    _app_hdl.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    _app_logger.addHandler(_app_hdl)
    _app_logger.setLevel(logging.INFO)

# Config hot-reload
_config_mtime = 0
_config_cache = None

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg):
    global _config_mtime, _config_cache
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    _config_mtime = os.path.getmtime(CONFIG_PATH)
    _config_cache = cfg


def get_config():
    global _config_mtime, _config_cache
    try:
        mtime = os.path.getmtime(CONFIG_PATH)
        if mtime != _config_mtime or _config_cache is None:
            _config_cache = load_config()
            _config_mtime = mtime
    except Exception as e:
        _app_logger.error(f"Config load failed: {e}")
        if _config_cache is None:
            _config_cache = load_config()
    return _config_cache


CONFIG = get_config()

app = Flask(__name__, static_folder=None)
app.secret_key = CONFIG["secret_key"]


# ------------------------------------------------------------------
# Security headers & access logging
# ------------------------------------------------------------------
_CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "http://localhost:5173")

@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Cache-Control"] = "no-store"
    # CORS: configurable via env for production
    origin = request.headers.get("Origin", _CORS_ORIGIN)
    allowed = _CORS_ORIGIN if _CORS_ORIGIN != "*" else origin
    if _CORS_ORIGIN == "*" or origin == allowed:
        response.headers["Access-Control-Allow-Origin"] = allowed
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

@app.route("/<path:path>", methods=["OPTIONS"])
def cors_preflight(path):
    return "", 204


def log_access(status_code):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user = session.get("user", "-")
    ip = request.environ.get("HTTP_X_FORWARDED_FOR", request.remote_addr)
    line = f'{ts} {ip} {user} "{request.method} {request.path}" {status_code}'
    _access_logger.info(line)


@app.after_request
def after_request_logging(response):
    log_access(response.status_code)
    return response


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("sha256:"):
        return False
    _, salt, hexdigest = password_hash.split(":", 2)
    computed = hashlib.sha256((salt + password).encode()).hexdigest()
    return computed == hexdigest


def hash_password(password: str) -> str:
    salt = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"sha256:{salt}:{h}"


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = session.get("user")
        cfg = get_config()
        if not user or user not in cfg["users"]:
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, **kwargs)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = session.get("user")
        if user != "moneychen":
            return jsonify({"error": "Admin only"}), 403
        return fn(*args, **kwargs)
    return wrapper


def require_visible_account(alias_param="alias"):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            cfg = get_config()
            user = session.get("user")
            alias = kwargs.get(alias_param)
            visible = set()
            if user and user in cfg["users"]:
                visible = set(cfg["users"][user].get("visible_accounts", []))
            else:
                visible = {cfg.get("public", {}).get("account", "combined")}
            if alias not in visible:
                return jsonify({"error": "Forbidden"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def get_user_config():
    cfg = get_config()
    user = session.get("user")
    return cfg["users"].get(user, {})


SENSITIVE_KEYS = {
    "trades", "dividends", "cashTransactions", "transactionFees",
    "optionEAE", "slb", "corporateActions", "priorPeriodPositions",
    "openPositions", "monthlyTradeStats",
    "dailyPnL", "tradePnLAnalysis", "netStockPositions", "stmtFunds",
    "mtmPerformanceSummary", "changeInNavDetails", "conversionRates"
}

DASHBOARD_SLICES = {
    "overview": {
        "accountId", "asOfDate", "generatedAt", "baseCurrency", "fxRates",
        "historyRange", "rangeSummaries", "summary", "performance",
        "flowSummary", "history", "historyTwr", "historyMwr", "historySimpleReturns", "historyAdjustedReturns",
        "dailyFlow", "dailyPnL", "monthlyRealGains",
        "balanceBreakdown", "metrics", "benchmarks",
        "changeInNav", "leverageMetrics", "cashflowWaterfall", "positionAttribution"
    },
    "positions": {
        "accountId", "asOfDate", "openPositions", "optionEAE",
        "priorPeriodPositions", "netStockPositions", "slb",
        "changeInNav", "tradePnLAnalysis", "dividends", "positionAttribution"
    },
    "performance": {
        "accountId", "asOfDate", "dailyPnL", "tradePnLAnalysis",
        "monthlyTradeStats", "benchmarks", "mtmPerformanceSummary",
        "changeInNav", "transactionFees", "history", "monthlyReturns",
        "tradeBehavior", "costBreakdown", "leverageMetrics"
    },
    "details": {
        "accountId", "asOfDate", "trades", "dividends", "cashTransactions",
        "transactionFees", "corporateActions", "stmtFunds",
        "changeInNavDetails", "conversionRates", "changeInNav",
        "taxSummary", "cashflowWaterfall"
    }
}


def filter_public_payload(payload: dict) -> dict:
    cfg = get_config()
    pub = cfg.get("public", {})
    modules = pub.get("modules", {})
    keys = set(SENSITIVE_KEYS)
    # 如果 public 配置允许查看对应模块，则不过滤相关数据
    if modules.get("positions"):
        keys.discard("openPositions")
        keys.discard("optionEAE")
        keys.discard("priorPeriodPositions")
        keys.discard("netStockPositions")
        keys.discard("slb")
    if modules.get("details"):
        keys.discard("trades")
        keys.discard("dividends")
        keys.discard("cashTransactions")
        keys.discard("transactionFees")
        keys.discard("corporateActions")
        keys.discard("stmtFunds")
    return {k: v for k, v in payload.items() if k not in keys}


def _get_dashboard_payload(alias, is_admin_view=False):
    cfg = get_config()
    acc_info = cfg["accounts"].get(alias)
    if not acc_info:
        return None
    file_path = os.path.join(APP_DIR, acc_info["file"])
    if not os.path.exists(file_path):
        return None

    mtime = os.path.getmtime(file_path)
    cached = _DASHBOARD_CACHE.get(file_path)
    if cached and cached[0] == mtime:
        payload = cached[1]
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        _DASHBOARD_CACHE[file_path] = (mtime, payload)

    payload = dict(payload)
    payload["accountId"] = acc_info["label"]
    user = session.get("user")
    if not is_admin_view and not user:
        payload = filter_public_payload(payload)
    return payload


def _slice_payload(payload, slice_name):
    keys = DASHBOARD_SLICES.get(slice_name)
    if not keys:
        return payload
    return {k: payload.get(k) for k in keys if k in payload}


def is_locked_out(username: str) -> bool:
    rec = LOGIN_ATTEMPTS.get(username)
    if not rec:
        return False
    if rec["count"] >= MAX_LOGIN_ATTEMPTS:
        if time.time() - rec["last"] < LOCKOUT_SECONDS:
            return True
        # Reset after lockout expires
        rec["count"] = 0
    return False


def record_login_attempt(username: str, success: bool):
    now = time.time()
    if success:
        LOGIN_ATTEMPTS.pop(username, None)
        return
    rec = LOGIN_ATTEMPTS.setdefault(username, {"count": 0, "last": now})
    rec["count"] += 1
    rec["last"] = now


# ------------------------------------------------------------------
# API Routes
# ------------------------------------------------------------------

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if is_locked_out(username):
        return jsonify({"error": "Too many failed attempts. Please try again later."}), 429

    cfg = get_config()
    user_cfg = cfg["users"].get(username)
    if not user_cfg or not verify_password(password, user_cfg["password_hash"]):
        record_login_attempt(username, False)
        return jsonify({"error": "Invalid username or password"}), 401

    record_login_attempt(username, True)
    session["user"] = username
    return jsonify({
        "success": True,
        "user": username,
        "modules": user_cfg.get("modules", {}),
        "visible_accounts": user_cfg.get("visible_accounts", [])
    })


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user", None)
    return jsonify({"success": True})


@app.route("/api/me")
def api_me():
    user = session.get("user")
    cfg = get_config()
    if user and user in cfg["users"]:
        user_cfg = cfg["users"][user]
        return jsonify({
            "user": user,
            "modules": user_cfg.get("modules", {}),
            "visible_accounts": user_cfg.get("visible_accounts", [])
        })
    # Public / not logged in
    pub = cfg.get("public", {})
    return jsonify({
        "user": None,
        "modules": pub.get("modules", {"overview": True, "performance": True, "positions": False, "details": False}),
        "visible_accounts": [pub.get("account", "combined")]
    })


@app.route("/api/accounts")
def api_accounts():
    cfg = get_config()
    user = session.get("user")
    if user and user in cfg["users"]:
        visible = set(cfg["users"][user].get("visible_accounts", []))
    else:
        visible = {cfg.get("public", {}).get("account", "combined")}
    result = []
    for alias, info in cfg["accounts"].items():
        if alias in visible:
            result.append({
                "alias": alias,
                "label": info["label"],
                "color": info["color"],
                "isDefault": alias == "combined"
            })
    return jsonify({"accounts": result})


@app.route("/api/dashboard/<alias>")
@require_visible_account()
def api_dashboard(alias):
    is_admin_view = session.get("user") and request.args.get("admin") == "1"
    payload = _get_dashboard_payload(alias, is_admin_view)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    return jsonify(payload)


@app.route("/api/dashboard/<alias>/overview")
@require_visible_account()
def api_dashboard_overview(alias):
    is_admin_view = session.get("user") and request.args.get("admin") == "1"
    payload = _get_dashboard_payload(alias, is_admin_view)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    return jsonify(_slice_payload(payload, "overview"))


@app.route("/api/dashboard/<alias>/positions")
@require_visible_account()
def api_dashboard_positions(alias):
    is_admin_view = session.get("user") and request.args.get("admin") == "1"
    payload = _get_dashboard_payload(alias, is_admin_view)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    return jsonify(_slice_payload(payload, "positions"))


@app.route("/api/dashboard/<alias>/performance")
@require_visible_account()
def api_dashboard_performance(alias):
    is_admin_view = session.get("user") and request.args.get("admin") == "1"
    payload = _get_dashboard_payload(alias, is_admin_view)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    return jsonify(_slice_payload(payload, "performance"))


@app.route("/api/dashboard/<alias>/details")
@require_visible_account()
def api_dashboard_details(alias):
    is_admin_view = session.get("user") and request.args.get("admin") == "1"
    payload = _get_dashboard_payload(alias, is_admin_view)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    return jsonify(_slice_payload(payload, "details"))


# ------------------------------------------------------------------
# XML Import
# ------------------------------------------------------------------
UPLOAD_DIR = os.path.join(APP_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _run_import_job(job_id, save_path, filename, timestamp):
    try:
        default_user_id = os.environ.get("DEFAULT_USER_ID", "5800d4ba-84f1-453b-9238-101462eaf139")
        result = run(
            [sys.executable, os.path.join(APP_DIR, "scripts", "xml_to_postgres.py"), default_user_id, save_path],
            cwd=APP_DIR,
            stdout=PIPE,
            stderr=PIPE,
            text=True
        )
        if result.returncode != 0:
            _BG_JOBS[job_id] = {"status": "failed", "error": result.stderr}
            send_webhook("import_failed", {"jobId": job_id, "file": filename, "error": result.stderr})
            return

        backup_xml = os.path.join(BACKUP_DIR, f"{timestamp}_{filename}")
        shutil.copy2(save_path, backup_xml)
        _BG_JOBS[job_id] = {"status": "done", "output": result.stdout.strip().split("\n")[-5:]}
        # auto cleanup
        do_cleanup()
        send_webhook("import_success", {"jobId": job_id, "file": filename})
    except Exception as e:
        _BG_JOBS[job_id] = {"status": "failed", "error": str(e)}
        send_webhook("import_failed", {"jobId": job_id, "file": filename, "error": str(e)})


@app.route("/api/import/xml", methods=["POST"])
@require_auth
@require_admin
def api_import_xml():
    """Upload IB FlexQuery XML and import into SQLite."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.endswith(".xml"):
        return jsonify({"error": "Please upload an XML file"}), 400

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"upload_{timestamp}_{file.filename}"
    save_path = os.path.join(UPLOAD_DIR, filename)
    file.save(save_path)

    job_id = f"import_{timestamp}"
    _BG_JOBS[job_id] = {"status": "running"}
    Thread(target=_run_import_job, args=(job_id, save_path, file.filename, timestamp), daemon=True).start()

    return jsonify({"success": True, "jobId": job_id, "message": "Import started in background"})


def _run_refresh_job(job_id):
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_subdir = os.path.join(BACKUP_DIR, ts)
        os.makedirs(backup_subdir, exist_ok=True)
        for fname in os.listdir(os.path.join(APP_DIR, "data")):
            if fname.startswith("dashboard_") and fname.endswith(".json"):
                shutil.copy2(
                    os.path.join(APP_DIR, "data", fname),
                    os.path.join(backup_subdir, fname)
                )

        sys.path.insert(0, APP_DIR)
        import scripts.postgres_to_dashboard as pgdash

        default_user_id = os.environ.get("DEFAULT_USER_ID", "5800d4ba-84f1-453b-9238-101462eaf139")
        rows = execute("SELECT DISTINCT account_id FROM daily_nav ORDER BY account_id")
        account_ids = [row['account_id'] for row in rows]

        output_lines = []
        for acc in account_ids:
            output_path = os.path.join(APP_DIR, "data", f"dashboard_{acc}.json")
            data = pgdash.generate_dashboard_data(default_user_id, acc)
            if data:
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                output_lines.append(f"✅ {acc}: {data['historyRange']['fromDate']} ~ {data['historyRange']['toDate']} ({data['historyRange']['totalDays']}天)")

        combined = pgdash.generate_dashboard_data(default_user_id, "combined")
        if combined:
            output_path = os.path.join(APP_DIR, "data", "dashboard_combined.json")
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(combined, f, indent=2, ensure_ascii=False)
            output_lines.append(f"✅ COMBINED: {combined['historyRange']['fromDate']} ~ {combined['historyRange']['toDate']} ({combined['historyRange']['totalDays']}天)")

        # clear dashboard cache after refresh
        _DASHBOARD_CACHE.clear()
        # auto cleanup
        do_cleanup()

        _BG_JOBS[job_id] = {"status": "done", "backupFolder": ts, "output": output_lines[-3:]}
        send_webhook("refresh_success", {"jobId": job_id, "backupFolder": ts})
    except Exception as e:
        _BG_JOBS[job_id] = {"status": "failed", "error": str(e)}
        send_webhook("refresh_failed", {"jobId": job_id, "error": str(e)})


# ------------------------------------------------------------------
# Data refresh & backup
# ------------------------------------------------------------------
@app.route("/api/refresh", methods=["POST"])
@require_auth
def api_refresh():
    """Re-run the JSON generation pipeline and backup old files."""
    job_id = f"refresh_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    _BG_JOBS[job_id] = {"status": "running"}
    Thread(target=_run_refresh_job, args=(job_id,), daemon=True).start()
    return jsonify({"success": True, "jobId": job_id, "message": "Refresh started in background"})


# ------------------------------------------------------------------
# Export
# ------------------------------------------------------------------
@app.route("/api/export/trades.csv")
@require_auth
def export_trades_csv():
    """Export all trades to CSV."""
    cfg = get_config()
    user_cfg = get_user_config()
    alias = request.args.get("account", "combined")
    if alias not in user_cfg.get("visible_accounts", []):
        return jsonify({"error": "Forbidden"}), 403

    acc_info = cfg["accounts"].get(alias)
    if not acc_info:
        return jsonify({"error": "Account not found"}), 404

    file_path = os.path.join(APP_DIR, acc_info["file"])
    with open(file_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    trades = payload.get("trades", [])
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["日期", "标的", "方向", "数量", "成交价", "币种", "盈亏", "类型", "描述"])
    for t in trades:
        writer.writerow([
            t.get("tradeDate", ""),
            t.get("symbol", ""),
            t.get("buySell", ""),
            t.get("quantity", ""),
            t.get("tradePrice", ""),
            t.get("currency", ""),
            t.get("mtmPnl") if t.get("mtmPnl") is not None else t.get("realizedPnl", ""),
            t.get("assetCategory", ""),
            t.get("description", "")
        ])

    filename = f"trades_{alias}_{datetime.now().strftime('%Y%m%d')}.csv"
    bom = "\ufeff"
    return Response(
        bom + output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ------------------------------------------------------------------
# Background jobs status
# ------------------------------------------------------------------
@app.route("/api/jobs/<job_id>")
@require_auth
def api_job_status(job_id):
    job = _BG_JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


# ------------------------------------------------------------------
# Admin Helpers
# ------------------------------------------------------------------
def _ensure_settings(cfg):
    if "settings" not in cfg:
        cfg["settings"] = {
            "baseCurrency": "USD",
            "fxOverrides": {},
            "retention": {"backups": 15, "uploads": 30, "logs": 90},
            "webhook": {"url": "", "events": ["refresh_failed", "import_failed", "disk_low", "stale_data"]}
        }
    return cfg


def send_webhook(event_type, payload):
    cfg = get_config()
    settings = cfg.get("settings", {})
    webhook = settings.get("webhook", {})
    url = webhook.get("url", "").strip()
    events = webhook.get("events", [])
    if not url or event_type not in events:
        return
    data = {"event": event_type, "timestamp": datetime.now().isoformat(), "payload": payload}
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            _app_logger.info(f"Webhook {event_type} sent, status={resp.status}")
    except Exception as e:
        _app_logger.error(f"Webhook {event_type} failed: {e}")


def cleanup_old_files(directory, retention_days, pattern="*"):
    if not os.path.isdir(directory):
        return 0
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for f in Path(directory).glob(pattern):
        if f.is_file() and f.stat().st_mtime < cutoff:
            try:
                f.unlink()
                removed += 1
            except Exception:
                pass
    return removed


def do_cleanup():
    cfg = get_config()
    settings = cfg.get("settings", {})
    retention = settings.get("retention", {"backups": 15, "uploads": 30, "logs": 90})
    # uploads
    up = cleanup_old_files(UPLOAD_DIR, retention.get("uploads", 30))
    # logs
    lo = cleanup_old_files(LOG_DIR, retention.get("logs", 90), pattern="*.log*")
    # backups: keep last N dirs
    bd = 0
    try:
        backup_dirs = sorted(
            (d for d in os.listdir(BACKUP_DIR) if os.path.isdir(os.path.join(BACKUP_DIR, d))),
            reverse=True
        )
        for old in backup_dirs[retention.get("backups", 15):]:
            shutil.rmtree(os.path.join(BACKUP_DIR, old), ignore_errors=True)
            bd += 1
    except Exception:
        pass
    return {"uploadsRemoved": up, "logsRemoved": lo, "backupsRemoved": bd}


def _backup_entry(ts):
    path = os.path.join(BACKUP_DIR, ts)
    if not os.path.isdir(path):
        return None
    size = 0
    btype = "unknown"
    for root, _, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            size += os.path.getsize(fp)
            if f.startswith("dashboard_") and f.endswith(".json"):
                btype = "dashboard"
            elif f.endswith(".xml"):
                btype = "upload"
    return {"timestamp": ts, "type": btype, "sizeMB": round(size / (1024 ** 2), 2)}


def _get_db_size():
    # PostgreSQL database size (simplified)
    try:
        row = execute_one("SELECT pg_database_size(current_database()) AS size")
        return round(row['size'] / (1024 ** 2), 2)
    except Exception:
        return 0.0


def _get_latest_import():
    try:
        row = execute_one("SELECT file_name, created_at, status FROM import_audit ORDER BY id DESC LIMIT 1")
        if row:
            return {"file": row['file_name'], "time": row['created_at'], "status": row['status']}
    except Exception as e:
        _app_logger.error(f"Latest import query failed: {e}")
    return None


def _get_import_count():
    try:
        row = execute_one("SELECT COUNT(*) AS cnt FROM import_audit WHERE status = 'success'")
        return row['cnt'] if row else 0
    except Exception:
        return 0


def _run_dq_check():
    issues = []
    # 1. NAV negative
    try:
        rows = execute("SELECT date, account_id, ending_value FROM daily_nav WHERE ending_value < 0 LIMIT 5")
        for row in rows:
            issues.append({"severity": "error", "category": "NAV", "message": f"NAV 为负: {row['date']} {row['account_id']} {row['ending_value']}"})
    except Exception as e:
        issues.append({"severity": "warn", "category": "NAV", "message": f"NAV 检查失败: {e}"})
    # 2. Stale data (>7 days)
    try:
        row = execute_one("SELECT MAX(date) AS max_date FROM daily_nav")
        max_date = row['max_date']
        if max_date:
            if isinstance(max_date, str):
                days = (datetime.now() - datetime.strptime(max_date, "%Y-%m-%d")).days
            else:
                days = (datetime.now() - max_date).days
            if days > 7:
                issues.append({"severity": "warn", "category": "DataFreshness", "message": f"最新数据距今 {days} 天 ({max_date})"})
    except Exception as e:
        issues.append({"severity": "warn", "category": "DataFreshness", "message": f"新鲜度检查失败: {e}"})
    # 3. Expired options still open
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        rows = execute("SELECT symbol, expiry FROM archive_open_position WHERE asset_type = 'OPTION' AND expiry < %s LIMIT 5", (today,))
        for row in rows:
            issues.append({"severity": "warn", "category": "Options", "message": f"期权已过期但仍持仓: {row['symbol']} 到期日 {row['expiry']}"})
    except Exception as e:
        issues.append({"severity": "warn", "category": "Options", "message": f"期权检查失败: {e}"})
    report = {"checkedAt": datetime.now().isoformat(), "issues": issues}
    _DQ_CACHE["latest"] = report
    return report


# ------------------------------------------------------------------
# Admin Routes
# ------------------------------------------------------------------
@app.route("/api/admin/config", methods=["GET", "POST"])
@require_auth
@require_admin
def admin_config():
    cfg = get_config()
    cfg = _ensure_settings(cfg)
    if request.method == "GET":
        safe_users = {}
        for u, info in cfg["users"].items():
            safe_users[u] = {
                "modules": info.get("modules", {}),
                "visible_accounts": info.get("visible_accounts", [])
            }
        return jsonify({
            "users": safe_users,
            "accounts": cfg.get("accounts", {}),
            "public": cfg.get("public", {}),
            "settings": cfg.get("settings", {})
        })

    data = request.get_json(silent=True) or {}
    changed = False
    if "public" in data:
        pub = data["public"]
        if "modules" in pub:
            cfg.setdefault("public", {})["modules"] = pub["modules"]
        if "account" in pub:
            cfg.setdefault("public", {})["account"] = pub["account"]
        changed = True

    if "settings" in data:
        cfg["settings"] = {**cfg.get("settings", {}), **data["settings"]}
        changed = True

    target_user = (data.get("username") or "").strip()
    new_password = data.get("password") or ""
    modules = data.get("modules")
    visible_accounts = data.get("visible_accounts")

    if target_user:
        if target_user not in cfg["users"]:
            return jsonify({"error": "User not found"}), 404
        if new_password:
            cfg["users"][target_user]["password_hash"] = hash_password(new_password)
        if modules is not None:
            cfg["users"][target_user]["modules"] = modules
        if visible_accounts is not None:
            cfg["users"][target_user]["visible_accounts"] = visible_accounts
        changed = True

    if changed:
        save_config(cfg)
    return jsonify({"success": True})


@app.route("/api/admin/reload-config", methods=["POST"])
@require_auth
@require_admin
def reload_config():
    global CONFIG
    try:
        CONFIG = get_config()
        return jsonify({"success": True, "settings": CONFIG.get("settings", {})})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/accounts", methods=["POST"])
@require_auth
@require_admin
def admin_accounts():
    cfg = get_config()
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    alias = (data.get("alias") or "").strip().lower()
    if not alias:
        return jsonify({"error": "alias required"}), 400

    if action == "create":
        if alias in cfg.get("accounts", {}):
            return jsonify({"error": "Account already exists"}), 409
        cfg.setdefault("accounts", {})[alias] = {
            "real_id": data.get("real_id", alias.upper()),
            "file": data.get("file", f"data/dashboard_{alias}.json"),
            "label": data.get("label", alias),
            "color": data.get("color", "#000000")
        }
        save_config(cfg)
        return jsonify({"success": True})

    if action == "update":
        if alias not in cfg.get("accounts", {}):
            return jsonify({"error": "Account not found"}), 404
        for k in ["real_id", "file", "label", "color"]:
            if k in data:
                cfg["accounts"][alias][k] = data[k]
        save_config(cfg)
        return jsonify({"success": True})

    if action == "delete":
        if alias not in cfg.get("accounts", {}):
            return jsonify({"error": "Account not found"}), 404
        del cfg["accounts"][alias]
        # also remove from users visibility
        for u in cfg.get("users", {}).values():
            va = u.get("visible_accounts", [])
            if alias in va:
                va.remove(alias)
                u["visible_accounts"] = va
        save_config(cfg)
        return jsonify({"success": True})

    return jsonify({"error": "Invalid action"}), 400


@app.route("/api/admin/imports")
@require_auth
@require_admin
def admin_imports():
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    try:
        total = execute_one("SELECT COUNT(*) AS cnt FROM import_audit")['cnt']
        rows = execute("""
            SELECT id, file_name, file_md5, stmt_date, account_id, rows_inserted, status, error_message, created_at
            FROM import_audit ORDER BY id DESC LIMIT %s OFFSET %s
        """, (limit, offset))
        cols = ["id", "fileName", "fileMd5", "stmtDate", "accountId", "rowsInserted", "status", "errorMessage", "createdAt"]
        imports = [dict(zip(cols, row.values())) for row in rows]
        return jsonify({"imports": imports, "total": total})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/backups")
@require_auth
@require_admin
def api_backups():
    entries = []
    try:
        for ts in sorted(os.listdir(BACKUP_DIR), reverse=True):
            ent = _backup_entry(ts)
            if ent:
                entries.append(ent)
    except Exception:
        pass
    return jsonify({"backups": entries})


@app.route("/api/backups/<ts>/restore", methods=["POST"])
@require_auth
@require_admin
def api_restore_backup(ts):
    src = os.path.join(BACKUP_DIR, ts)
    if not os.path.isdir(src):
        return jsonify({"error": "Backup not found"}), 404
    restored = []
    for fname in os.listdir(src):
        if fname.startswith("dashboard_") and fname.endswith(".json"):
            shutil.copy2(os.path.join(src, fname), os.path.join(APP_DIR, "data", fname))
            restored.append(fname)
    # clear cache
    _DASHBOARD_CACHE.clear()
    return jsonify({"success": True, "restored": restored})


@app.route("/api/backups/<ts>/download")
@require_auth
@require_admin
def api_download_backup(ts):
    src = os.path.join(BACKUP_DIR, ts)
    if not os.path.isdir(src):
        return jsonify({"error": "Backup not found"}), 404
    tar_path = os.path.join(APP_DIR, "backups", f"{ts}.tar.gz")
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(src, arcname=ts)
    try:
        return send_from_directory(os.path.join(APP_DIR, "backups"), f"{ts}.tar.gz", as_attachment=True)
    finally:
        try:
            os.remove(tar_path)
        except Exception:
            pass


@app.route("/api/admin/cleanup", methods=["POST"])
@require_auth
@require_admin
def api_cleanup():
    result = do_cleanup()
    return jsonify({"success": True, **result})


@app.route("/api/admin/dq-check", methods=["POST"])
@require_auth
@require_admin
def api_dq_check():
    report = _run_dq_check()
    return jsonify(report)


@app.route("/api/admin/dq-check/latest")
@require_auth
@require_admin
def api_dq_check_latest():
    report = _DQ_CACHE.get("latest")
    if not report:
        report = _run_dq_check()
    return jsonify(report)


@app.route("/api/admin/webhook/test", methods=["POST"])
@require_auth
@require_admin
def api_test_webhook():
    Thread(target=send_webhook, args=("test", {"message": "Webhook test from IB Dashboard"}), daemon=True).start()
    return jsonify({"success": True, "message": "Test webhook sent in background"})


# ------------------------------------------------------------------
# Status & Health
# ------------------------------------------------------------------
@app.route("/api/status")
@require_auth
def api_status():
    latest_refresh = None
    data_dir = os.path.join(APP_DIR, "data")
    for fname in sorted(os.listdir(data_dir), reverse=True):
        if fname.startswith("dashboard_") and fname.endswith(".json"):
            path = os.path.join(data_dir, fname)
            mtime = os.path.getmtime(path)
            latest_refresh = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
            break

    # data freshness in hours
    freshness_hours = None
    if latest_refresh:
        try:
            lr = datetime.strptime(latest_refresh, "%Y-%m-%d %H:%M:%S")
            freshness_hours = round((datetime.now() - lr).total_seconds() / 3600, 1)
        except Exception:
            pass

    disk = shutil.disk_usage(APP_DIR)
    running_jobs = {k: v for k, v in _BG_JOBS.items() if v.get("status") == "running"}
    cfg = get_config()
    return jsonify({
        "latestRefresh": latest_refresh,
        "dataFreshnessHours": freshness_hours,
        "dbSizeMB": _get_db_size(),
        "latestImport": _get_latest_import(),
        "importCount": _get_import_count(),
        "runningJobs": running_jobs,
        "backups": sorted(os.listdir(BACKUP_DIR), reverse=True)[:10],
        "diskFreeGB": round(disk.free / (1024 ** 3), 2),
        "settings": cfg.get("settings", {}),
        "version": "1.2.0"
    })


@app.route("/api/health")
def api_health():
    errors = []
    # check db readable
    try:
        execute("SELECT 1")
    except Exception:
        errors.append("db_unreadable")
    # check json fresh (< 24h)
    data_dir = os.path.join(APP_DIR, "data")
    fresh = False
    for fname in sorted(os.listdir(data_dir), reverse=True):
        if fname.startswith("dashboard_") and fname.endswith(".json"):
            path = os.path.join(data_dir, fname)
            if time.time() - os.path.getmtime(path) < 86400:
                fresh = True
            break
    if not fresh:
        errors.append("dashboard_stale")
    status = "healthy" if not errors else "unhealthy"
    return jsonify({"status": status, "errors": errors}), (200 if not errors else 503)


# ------------------------------------------------------------------
# Static files & pages
# ------------------------------------------------------------------
@app.route("/")
def index():
    react_index = os.path.join(APP_DIR, "web", "dist", "index.html")
    if os.path.exists(react_index):
        return send_from_directory(os.path.join(APP_DIR, "web", "dist"), "index.html")
    return send_from_directory(APP_DIR, "index.html")


@app.route("/login.html")
def login_page():
    return send_from_directory(APP_DIR, "login.html")


@app.route("/<path:filename>")
def static_files(filename):
    if ".." in filename:
        return jsonify({"error": "Forbidden"}), 403
    if filename.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    react_path = os.path.join(APP_DIR, "web", "dist", filename)
    if os.path.exists(react_path) and os.path.isfile(react_path):
        return send_from_directory(os.path.join(APP_DIR, "web", "dist"), filename)
    if filename.startswith("config/") or filename.startswith("backups/"):
        return jsonify({"error": "Forbidden"}), 403
    if filename.startswith("data/"):
        allowed_data = {"data/kline_data.json", "data/realtime_quotes.json", "data/sample_data.json"}
        if filename not in allowed_data:
            return jsonify({"error": "Forbidden"}), 403
    file_path = os.path.join(APP_DIR, filename)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return send_from_directory(APP_DIR, filename)
    return send_from_directory(os.path.join(APP_DIR, "web", "dist"), "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"🚀 IB Dashboard server running at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
