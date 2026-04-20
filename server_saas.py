#!/usr/bin/env python3
"""IB Dashboard SaaS - Flask backend with JWT auth, PostgreSQL, and RQ workers."""

import hashlib
import json
import os
import sys
import io
import csv
import uuid
from datetime import datetime, timedelta
import time
from functools import wraps
from pathlib import Path

from flask import Flask, request, jsonify, Response, send_from_directory
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required,
    get_jwt_identity, get_jwt, verify_jwt_in_request
)
from werkzeug.utils import secure_filename
import redis
from rq import Queue

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db.postgres_client import get_cursor, execute, execute_one
from workers.jobs import import_xml_job, flex_sync_job
from rq.job import Job
from rq.command import send_stop_job_command
from utils.crypto_token import encrypt_token, decrypt_token
from utils.quotas import check_account_limit, get_user_limits
from utils import backups as backup_utils
from workers.alerting import run_alerts

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
APP_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(APP_DIR, "uploads")
BACKUP_DIR = os.path.join(APP_DIR, "backups")
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "50"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)

# Redis / RQ
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_conn = redis.from_url(REDIS_URL)
queue = Queue(connection=redis_conn)

app = Flask(__name__)
app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET_KEY", "change_this_to_a_very_long_random_string_for_production_32bytes_min")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
jwt = JWTManager(app)

_CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store"
    origin = request.headers.get("Origin", _CORS_ORIGIN)
    allowed = _CORS_ORIGIN if _CORS_ORIGIN != "*" else origin
    if _CORS_ORIGIN == "*" or origin == allowed:
        response.headers["Access-Control-Allow-Origin"] = allowed
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


@app.route("/<path:path>", methods=["OPTIONS"])
def cors_preflight(path):
    return "", 204


# ------------------------------------------------------------------
# Auth Helpers
# ------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"sha256:{salt}:{h}"


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("sha256:"):
        return False
    _, salt, hexdigest = password_hash.split(":", 2)
    computed = hashlib.sha256((salt + password).encode()).hexdigest()
    return computed == hexdigest


GUEST_USER_ID = "00000000-0000-0000-0000-000000000000"


def optional_jwt(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        request._jwt_user_id = GUEST_USER_ID
        try:
            verify_jwt_in_request()
            request._jwt_user_id = get_jwt_identity()
        except Exception:
            pass
        return fn(*args, **kwargs)
    return wrapper


def get_current_user_id():
    return getattr(request, '_jwt_user_id', GUEST_USER_ID)


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user_id = get_jwt_identity()
        row = execute_one("SELECT is_admin FROM users WHERE id = %s", (user_id,))
        if not row or not row.get("is_admin"):
            return jsonify({"error": "Admin only"}), 403
        return fn(*args, **kwargs)
    return wrapper


def _audit_log(admin_id, action, target_type=None, target_id=None, details=None):
    """Record an admin action into audit logs."""
    try:
        with get_cursor() as cur:
            cur.execute('''
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details, ip_address, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ''', (admin_id, action, target_type, target_id, json.dumps(details or {}), request.remote_addr))
    except Exception:
        pass


# ------------------------------------------------------------------
# Auth Routes
# ------------------------------------------------------------------
@app.route("/api/auth/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip().lower()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not username or not email or not password or len(password) < 6:
        return jsonify({"error": "Invalid username, email or password (min 6 chars)"}), 400

    # Check duplicate username or email
    existing = execute_one(
        "SELECT id FROM users WHERE username = %s OR email = %s",
        (username, email)
    )
    if existing:
        return jsonify({"error": "Username or email already registered"}), 409

    # Create user
    user_id = str(uuid.uuid4())
    with get_cursor() as cur:
        cur.execute('''
            INSERT INTO users (id, username, email, password_hash, is_active, created_at)
            VALUES (%s, %s, %s, %s, TRUE, NOW())
        ''', (user_id, username, email, hash_password(password)))
        cur.execute('''
            INSERT INTO user_profiles (user_id, tier, base_currency)
            VALUES (%s, %s, %s)
        ''', (user_id, "free", "USD"))

    token = create_access_token(identity=user_id)
    return jsonify({"success": True, "token": token, "user_id": user_id})


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    login = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    user = execute_one(
        "SELECT id, password_hash, is_active, is_admin FROM users WHERE username = %s OR email = %s",
        (login, login)
    )
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid username or password"}), 401
    if not user.get("is_active"):
        return jsonify({"error": "Account disabled"}), 403

    # Update last login IP
    try:
        with get_cursor() as cur:
            cur.execute("UPDATE users SET last_login_ip = %s WHERE id = %s", (request.remote_addr, user["id"]))
    except Exception:
        pass

    token = create_access_token(identity=user["id"])
    return jsonify({
        "success": True,
        "token": token,
        "user_id": user["id"],
        "is_admin": user.get("is_admin", False)
    })


@app.route("/api/auth/me")
@jwt_required()
def api_me():
    user_id = get_jwt_identity()
    user = execute_one('''
        SELECT u.id, u.email, u.is_admin, p.tier, p.display_name, p.base_currency, p.max_accounts, p.max_history_months
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        WHERE u.id = %s
    ''', (user_id,))
    if not user:
        return jsonify({"error": "User not found"}), 404

    accounts = execute('''
        SELECT account_id, label, color, is_default
        FROM user_accounts
        WHERE user_id = %s
        ORDER BY created_at
    ''', (user_id,))

    current_accounts = execute_one('SELECT COUNT(*) AS c FROM user_accounts WHERE user_id = %s', (user_id,))
    current_count = current_accounts["c"] if current_accounts else 0

    return jsonify({
        "user": {
            "id": user["id"],
            "email": user["email"],
            "is_admin": user["is_admin"],
            "tier": user["tier"] or "free",
            "display_name": user["display_name"],
            "base_currency": user["base_currency"] or "USD",
            "limits": {
                "max_accounts": user.get("max_accounts") or 1,
                "max_history_months": user.get("max_history_months") or 3,
                "current_accounts": current_count,
            }
        },
        "accounts": [dict(a) for a in accounts]
    })


# ------------------------------------------------------------------
# Accounts
# ------------------------------------------------------------------
@app.route("/api/accounts", methods=["GET"])
@optional_jwt
def api_accounts():
    user_id = get_current_user_id()
    if user_id == GUEST_USER_ID:
        return jsonify({"accounts": []})
    target_user = _resolve_preview_user_id(user_id)
    rows = execute('''
        SELECT account_id, label, color, is_default
        FROM user_accounts
        WHERE user_id = %s
        ORDER BY created_at
    ''', (target_user,))
    result = []
    for r in rows:
        result.append({
            "alias": r["account_id"],
            "label": r["label"] or r["account_id"],
            "color": r["color"] or "#6366f1",
            "isDefault": r["is_default"]
        })
    # Always inject combined
    result.insert(0, {
        "alias": "combined",
        "label": "全部账户",
        "color": "#000000",
        "isDefault": True
    })
    return jsonify({"accounts": result})


# ------------------------------------------------------------------
# Upload XML
# ------------------------------------------------------------------
@app.route("/api/upload/xml", methods=["POST"])
@jwt_required()
def api_upload_xml():
    user_id = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.endswith(".xml"):
        return jsonify({"error": "Please upload an XML file"}), 400

    # Check tier limits
    profile = execute_one("SELECT tier, max_accounts FROM user_profiles WHERE user_id = %s", (user_id,))
    tier = profile.get("tier") or "free" if profile else "free"

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = secure_filename(f"upload_{timestamp}_{file.filename}")
    save_path = os.path.join(UPLOAD_DIR, filename)
    file.save(save_path)

    # Create upload audit record
    upload_id = str(uuid.uuid4())
    with get_cursor() as cur:
        cur.execute('''
            INSERT INTO xml_uploads (id, user_id, filename, file_md5, storage_path, status, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ''', (upload_id, user_id, filename, "", save_path, "pending"))

    # Enqueue RQ job
    job = queue.enqueue(import_xml_job, user_id, upload_id, save_path, job_timeout=600)

    return jsonify({"success": True, "jobId": job.id, "uploadId": upload_id})


@app.route("/api/jobs/<job_id>")
@jwt_required()
def api_job_status(job_id):
    from rq.job import Job
    try:
        job = Job.fetch(job_id, connection=redis_conn)
    except Exception:
        return jsonify({"error": "Job not found"}), 404

    if job.is_finished:
        return jsonify({"status": "done", "result": job.result})
    elif job.is_failed:
        return jsonify({"status": "failed", "error": str(job.exc_info)})
    else:
        return jsonify({"status": "running"})


# ------------------------------------------------------------------
# FlexQuery Credentials & Sync
# ------------------------------------------------------------------
@app.route("/api/flex-credentials", methods=["GET"])
@jwt_required()
def api_flex_credentials_get():
    user_id = get_jwt_identity()
    row = execute_one('''
        SELECT query_id, token_encrypted, is_active, auto_sync, last_sync_at, last_sync_status, last_sync_message, created_at, updated_at
        FROM user_flex_credentials
        WHERE user_id = %s
    ''', (user_id,))
    if not row:
        return jsonify({"credentials": None})
    data = dict(row)
    # Mask token
    data["token"] = "********"
    data.pop("token_encrypted", None)
    return jsonify({"credentials": data})


@app.route("/api/flex-credentials", methods=["POST"])
@jwt_required()
def api_flex_credentials_post():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    query_id = (data.get("query_id") or "").strip()
    token = (data.get("token") or "").strip()
    auto_sync = bool(data.get("auto_sync"))
    is_active = bool(data.get("is_active", True))

    if not query_id:
        return jsonify({"error": "query_id is required"}), 400

    existing = execute_one("SELECT token_encrypted FROM user_flex_credentials WHERE user_id = %s", (user_id,))
    # Only encrypt and store token if user provided a new one (not masked)
    if token and token != "********":
        token_encrypted = encrypt_token(token)
    elif existing:
        token_encrypted = existing["token_encrypted"]
    else:
        return jsonify({"error": "token is required"}), 400

    with get_cursor() as cur:
        cur.execute('''
            INSERT INTO user_flex_credentials (user_id, query_id, token_encrypted, is_active, auto_sync, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                query_id = EXCLUDED.query_id,
                token_encrypted = EXCLUDED.token_encrypted,
                is_active = EXCLUDED.is_active,
                auto_sync = EXCLUDED.auto_sync,
                updated_at = NOW()
        ''', (user_id, query_id, token_encrypted, is_active, auto_sync))
    return jsonify({"success": True})


@app.route("/api/flex-credentials/test", methods=["POST"])
@jwt_required()
def api_flex_credentials_test():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    query_id = (data.get("query_id") or "").strip()
    token = (data.get("token") or "").strip()

    if not query_id or not token:
        return jsonify({"error": "query_id and token are required"}), 400

    # If user had a recent test or sync within last 2 minutes, skip IB call to avoid rate limit
    recent = execute_one('''
        SELECT message FROM flex_sync_logs
        WHERE user_id = %s AND completed_at > NOW() - INTERVAL '2 minutes'
        ORDER BY completed_at DESC LIMIT 1
    ''', (user_id,))
    if recent:
        msg = recent.get("message") or "近期有同步/测试记录，凭证有效"
        return jsonify({"success": True, "message": f"凭证有效（{msg}）"})

    import requests
    import re
    # Step 1: SendRequest
    send_url = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t={token}&q={query_id}&v=3"
    try:
        resp = requests.get(send_url, headers={"User-Agent": "Python/3.11"}, timeout=60)
        send_text = resp.text
    except requests.RequestException as e:
        return jsonify({"success": False, "error": f"SendRequest failed: {e}"}), 502

    ref_match = re.search(r'<ReferenceCode>([^<]+)</ReferenceCode>', send_text)
    if not ref_match:
        if "ErrorCode>1018" in send_text:
            return jsonify({"success": True, "message": "连接成功，当前请求被限流（这是正常的）"})
        if "ErrorCode>1019" in send_text:
            return jsonify({"success": True, "message": "连接成功，报表正在生成中（这是正常的）"})
        if "ErrorCode>1020" in send_text:
            return jsonify({"success": False, "error": "IB 拒绝了请求（1020），可能是 Token/Query ID 无效或调用过于频繁，请 2 分钟后重试"}), 400
        if "ErrorCode>" in send_text:
            return jsonify({"success": False, "error": send_text[:500]}), 400
        return jsonify({"success": False, "error": "SendRequest did not return ReferenceCode"}), 400

    # Test only validates SendRequest; do not pull full XML to avoid rate limits.
    return jsonify({"success": True, "message": "凭证验证成功，可以正常发起 SendRequest"})


def _has_running_flex_sync(user_id: str) -> bool:
    """Check if there is already a running or queued flex_sync_job for this user."""
    # 1. Check RQ started registry
    for jid in queue.started_job_registry.get_job_ids():
        try:
            j = Job.fetch(jid, connection=redis_conn)
            if j.func_name == 'workers.jobs.flex_sync_job' and j.args and j.args[0] == user_id:
                return True
        except Exception:
            pass
    # 2. Check RQ queued jobs
    for jid in queue.get_job_ids():
        try:
            j = Job.fetch(jid, connection=redis_conn)
            if j.func_name == 'workers.jobs.flex_sync_job' and j.args and j.args[0] == user_id:
                return True
        except Exception:
            pass
    # 3. Check recent running logs in PostgreSQL (fallback)
    recent_running = execute_one('''
        SELECT 1 FROM flex_sync_logs
        WHERE user_id = %s AND status = 'running' AND started_at > NOW() - INTERVAL '5 minutes'
        LIMIT 1
    ''', (user_id,))
    if recent_running:
        return True
    return False


@app.route("/api/flex-credentials/sync", methods=["POST"])
@jwt_required()
def api_flex_credentials_sync():
    user_id = get_jwt_identity()
    cred = execute_one('SELECT is_active FROM user_flex_credentials WHERE user_id = %s', (user_id,))
    if not cred:
        return jsonify({"error": "No credentials configured"}), 400
    if not cred.get("is_active"):
        return jsonify({"error": "Credentials are inactive"}), 400
    if _has_running_flex_sync(user_id):
        return jsonify({"error": "已有同步任务在运行中，请稍后再试"}), 429
    job = queue.enqueue(flex_sync_job, user_id, job_timeout=600)
    return jsonify({"success": True, "jobId": job.id})


@app.route("/api/flex-credentials/sync-logs")
@jwt_required()
def api_flex_credentials_sync_logs():
    user_id = get_jwt_identity()
    offset = request.args.get("offset", 0, type=int)
    limit = request.args.get("limit", 20, type=int)
    rows = execute('''
        SELECT id, status, message, rows_inserted, account_id, upload_id, job_id, started_at, completed_at
        FROM flex_sync_logs
        WHERE user_id = %s
        ORDER BY started_at DESC
        LIMIT %s OFFSET %s
    ''', (user_id, limit, offset))
    total = execute_one("SELECT COUNT(*) AS c FROM flex_sync_logs WHERE user_id = %s", (user_id,))
    return jsonify({"logs": [dict(r) for r in rows], "total": total["c"] if total else 0})


@app.route("/api/flex-credentials/sync-logs/<log_id>", methods=["DELETE"])
@jwt_required()
def api_flex_credentials_delete_log(log_id):
    user_id = get_jwt_identity()
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM flex_sync_logs WHERE id = %s AND user_id = %s
        ''', (log_id, user_id))
    return jsonify({"success": True})


@app.route("/api/flex-credentials/sync/cancel", methods=["POST"])
@jwt_required()
def api_flex_credentials_sync_cancel():
    user_id = get_jwt_identity()
    log_row = execute_one('''
        SELECT id, job_id FROM flex_sync_logs
        WHERE user_id = %s AND status = 'running'
        ORDER BY started_at DESC
        LIMIT 1
    ''', (user_id,))
    if not log_row:
        return jsonify({"error": "没有正在运行的同步任务"}), 404

    job_id = log_row.get("job_id")
    log_id = log_row["id"]

    # Try to stop the job if it has a job_id
    stopped = False
    if job_id:
        try:
            send_stop_job_command(redis_conn, job_id)
            stopped = True
        except Exception:
            pass
        # Also try to remove from queue if still queued
        try:
            j = Job.fetch(job_id, connection=redis_conn)
            if j.is_queued:
                j.cancel()
                stopped = True
        except Exception:
            pass

    # Update log and credentials status
    msg = '同步已手动取消'
    with get_cursor() as cur:
        cur.execute('''
            UPDATE flex_sync_logs
            SET status = 'cancelled', message = %s, completed_at = NOW()
            WHERE id = %s
        ''', (msg, log_id))
        cur.execute('''
            UPDATE user_flex_credentials
            SET last_sync_status = 'cancelled',
                last_sync_message = %s,
                updated_at = NOW()
            WHERE user_id = %s
        ''', (msg, user_id))
    return jsonify({"success": True, "stopped": stopped, "logId": str(log_id)})


# ------------------------------------------------------------------
# Dashboard API
# ------------------------------------------------------------------
DASHBOARD_SLICES = {
    "overview": {
        "accountId", "asOfDate", "generatedAt", "baseCurrency", "fxRates", "isDemo",
        "historyRange", "rangeSummaries", "summary", "performance",
        "flowSummary", "history", "historyTwr", "historyMwr", "historySimpleReturns", "historyAdjustedReturns",
        "dailyFlow", "dailyPnL", "monthlyRealGains",
        "balanceBreakdown", "metrics", "benchmarks",
        "changeInNav", "leverageMetrics", "cashflowWaterfall", "positionAttribution",
        "fxExposure", "slbIncome", "enhancedCashflow", "dividendTracker"
    },
    "positions": {
        "accountId", "asOfDate", "openPositions", "optionEAE", "isDemo",
        "priorPeriodPositions", "netStockPositions", "slb",
        "changeInNav", "tradePnLAnalysis", "dividends", "positionAttribution",
        "positionTimeline", "riskRadar", "optionsStrategyLens", "corporateActionImpact"
    },
    "performance": {
        "accountId", "asOfDate", "dailyPnL", "tradePnLAnalysis", "isDemo",
        "monthlyTradeStats", "benchmarks", "mtmPerformanceSummary",
        "changeInNav", "transactionFees", "history", "monthlyReturns",
        "tradeBehavior", "costBreakdown", "leverageMetrics",
        "tradingHeatmap", "tradeRankings", "feeErosion", "timingAttribution"
    },
    "details": {
        "accountId", "asOfDate", "trades", "dividends", "cashTransactions", "isDemo",
        "transactionFees", "corporateActions", "stmtFunds",
        "changeInNavDetails", "conversionRates", "changeInNav",
        "taxSummary", "cashflowWaterfall",
        "orderExecution", "washSaleAlerts"
    },
    "changes": {
        "accountId", "asOfDate", "baseCurrency", "isDemo",
        "positionChanges", "latestDayTrades", "costBasisHoldings", "soldAnalysis",
        "balanceBreakdown", "changeInNav", "dailyPnL"
    }
}


def _slice_payload(payload, slice_name):
    keys = DASHBOARD_SLICES.get(slice_name)
    if not keys:
        return payload
    # Demo payload: return full dataset so guest users see rich sample data in every tab
    if payload.get("isDemo"):
        return payload
    return {k: payload.get(k) for k in keys if k in payload}


def _generate_dashboard_for_account(user_id: str, account_id: str):
    """
    生成 Dashboard JSON，三级回退策略：
    1. Redis 缓存（TTL 300s）
    2. 预生成 JSON 文件
    3. 实时从 PostgreSQL 计算（并写入 Redis + 落盘 JSON）
    """
    cache_key = f"dashboard:{user_id}:{account_id}"
    # 1. 尝试 Redis
    try:
        cached = redis_conn.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    # 2. 尝试预生成 JSON 文件（新路径优先，兼容旧路径）
    json_path = os.path.join(APP_DIR, "data", f"dashboard_{account_id}_{user_id}.json")
    legacy_path = os.path.join(APP_DIR, "data", f"dashboard_{account_id}.json")
    for path in (json_path, legacy_path):
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # 异步回写 Redis（非阻塞）
                try:
                    redis_conn.setex(cache_key, 300, json.dumps(data, ensure_ascii=False, default=str))
                except Exception:
                    pass
                return data
            except Exception:
                pass

    # 3. 实时计算并缓存
    import scripts.postgres_to_dashboard as pgdash
    data = pgdash.generate_dashboard_data(user_id, account_id)
    if data:
        try:
            redis_conn.setex(cache_key, 300, json.dumps(data, ensure_ascii=False, default=str))
        except Exception:
            pass
        # 同时落盘，方便下次走文件缓存
        try:
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        except Exception:
            pass
        return data

    # 4. 无数据时返回 Demo 仪表盘
    demo_path = os.path.join(APP_DIR, "data", "demo_dashboard.json")
    if os.path.exists(demo_path):
        try:
            with open(demo_path, "r", encoding="utf-8") as f:
                demo = json.load(f)
            demo["isDemo"] = True
            return demo
        except Exception:
            pass
    return None


def _resolve_preview_user_id(caller_id: str):
    """Allow admins to specify a preview_user_id query param to view another user's data."""
    if caller_id == GUEST_USER_ID:
        return caller_id
    preview = request.args.get("preview_user_id", "", type=str).strip()
    if not preview:
        return caller_id
    admin = execute_one("SELECT is_admin FROM users WHERE id = %s", (caller_id,))
    if admin and admin.get("is_admin"):
        return preview
    return caller_id


@app.route("/api/dashboard/<alias>")
@optional_jwt
def api_dashboard(alias):
    user_id = get_current_user_id()
    target_user = _resolve_preview_user_id(user_id)
    payload = _generate_dashboard_for_account(target_user, alias)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/api/dashboard/<alias>/<slice_name>")
@optional_jwt
def api_dashboard_slice(alias, slice_name):
    user_id = get_current_user_id()
    target_user = _resolve_preview_user_id(user_id)
    payload = _generate_dashboard_for_account(target_user, alias)
    if payload is None:
        return jsonify({"error": "Data not found"}), 404
    resp = jsonify(_slice_payload(payload, slice_name))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


# ------------------------------------------------------------------
# Market data settings (global default for SaaS)
# ------------------------------------------------------------------
MARKET_SETTINGS_FILE = os.path.join(APP_DIR, "config", "market_data_settings.json")


def _load_market_settings():
    if os.path.exists(MARKET_SETTINGS_FILE):
        with open(MARKET_SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "sources": ["finnhub", "yahoo"],
        "finnhub": {"enabled": True, "api_key": os.environ.get("FINNHUB_API_KEY", "")},
        "yahoo": {"enabled": True, "api_key": ""},
        "polygon": {"enabled": False, "api_key": ""},
        "alpaca": {"enabled": False, "api_key": ""}
    }


def _save_market_settings(data):
    os.makedirs(os.path.dirname(MARKET_SETTINGS_FILE), exist_ok=True)
    with open(MARKET_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _load_user_market_settings(user_id):
    """Load per-user market settings, fallback to global default."""
    row = execute_one('''
        SELECT sources, finnhub, yahoo, webull, tradier, polygon, alpaca
        FROM user_market_settings WHERE user_id = %s
    ''', (user_id,))
    if row:
        return {
            "sources": row.get("sources", ["finnhub", "yahoo", "webull", "tradier"]),
            "finnhub": row.get("finnhub", {"enabled": True, "api_key": ""}),
            "yahoo": row.get("yahoo", {"enabled": True, "api_key": ""}),
            "webull": row.get("webull", {"enabled": True, "api_key": ""}),
            "tradier": row.get("tradier", {"enabled": False, "api_key": ""}),
            "polygon": row.get("polygon", {"enabled": False, "api_key": ""}),
            "alpaca": row.get("alpaca", {"enabled": False, "api_key": ""}),
        }
    return _load_market_settings()


def _save_user_market_settings(user_id, data):
    """Upsert per-user market settings."""
    import psycopg2
    sources = json.dumps(data.get("sources", ["finnhub", "yahoo", "webull", "tradier"]))
    finnhub = json.dumps(data.get("finnhub", {"enabled": True, "api_key": ""}))
    yahoo = json.dumps(data.get("yahoo", {"enabled": True, "api_key": ""}))
    webull = json.dumps(data.get("webull", {"enabled": True, "api_key": ""}))
    tradier = json.dumps(data.get("tradier", {"enabled": False, "api_key": ""}))
    polygon = json.dumps(data.get("polygon", {"enabled": False, "api_key": ""}))
    alpaca = json.dumps(data.get("alpaca", {"enabled": False, "api_key": ""}))
    execute_one('''
        INSERT INTO user_market_settings
            (user_id, sources, finnhub, yahoo, webull, tradier, polygon, alpaca, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            sources = EXCLUDED.sources,
            finnhub = EXCLUDED.finnhub,
            yahoo = EXCLUDED.yahoo,
            webull = EXCLUDED.webull,
            tradier = EXCLUDED.tradier,
            polygon = EXCLUDED.polygon,
            alpaca = EXCLUDED.alpaca,
            updated_at = NOW()
    ''', (user_id, sources, finnhub, yahoo, webull, tradier, polygon, alpaca))


@app.route("/api/market/settings", methods=["GET"])
@jwt_required()
def api_market_settings_get():
    user_id = get_jwt_identity()
    return jsonify(_load_user_market_settings(user_id))


@app.route("/api/market/settings", methods=["POST"])
@jwt_required()
def api_market_settings_post():
    user_id = get_jwt_identity()
    data = request.get_json(force=True) or {}
    settings = _load_user_market_settings(user_id)
    if "sources" in data:
        settings["sources"] = data["sources"]
    for src in ["finnhub", "yahoo", "webull", "tradier", "polygon", "alpaca"]:
        if src in data:
            settings[src] = {**settings.get(src, {}), **data[src]}
    _save_user_market_settings(user_id, settings)
    return jsonify({"success": True, "settings": settings})


# ------------------------------------------------------------------
# Market data update (async, polled from frontend)
# ------------------------------------------------------------------
_manual_market_jobs = {}


def _run_market_update(job_id: str, user_id: str):
    _manual_market_jobs[job_id]["status"] = "running"
    _manual_market_jobs[job_id]["message"] = "正在刷新股价..."
    try:
        from scripts.market_data import update_market_prices
        update_market_prices(user_id)
        _manual_market_jobs[job_id]["status"] = "done"
        _manual_market_jobs[job_id]["message"] = "股价刷新完成"
    except Exception as e:
        _manual_market_jobs[job_id]["status"] = "failed"
        _manual_market_jobs[job_id]["message"] = str(e)


@app.route("/api/market/update", methods=["POST"])
@jwt_required()
def api_market_update():
    import uuid
    from datetime import datetime
    user_id = get_jwt_identity()
    job_id = str(uuid.uuid4())
    _manual_market_jobs[job_id] = {
        "status": "queued",
        "message": "等待开始...",
        "started_at": datetime.now().isoformat(),
        "user_id": user_id,
    }
    import threading
    t = threading.Thread(target=_run_market_update, args=(job_id, user_id), daemon=True)
    t.start()
    return jsonify({"success": True, "jobId": job_id})


@app.route("/api/market/update/status/<job_id>")
@jwt_required()
def api_market_update_status(job_id):
    user_id = get_jwt_identity()
    job = _manual_market_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    # Users can only check their own jobs
    if job.get("user_id") and job.get("user_id") != user_id:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({"success": True, "job": job})

@app.route("/api/market/test/<source>", methods=["POST"])
@jwt_required()
def api_market_test(source):
    user_id = get_jwt_identity()
    data = request.get_json(force=True) or {}
    # Use API key from request (user testing unsaved key) or fallback to saved settings
    api_key = data.get("api_key", "")
    if not api_key:
        settings = _load_user_market_settings(user_id)
        api_key = settings.get(source, {}).get("api_key", "")
    try:
        if source == "finnhub":
            import requests
            resp = requests.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": "AAPL", "token": api_key},
                timeout=10,
            )
            r = resp.json()
            price = r.get("c")
            if price is not None and float(price) > 0:
                return jsonify({"success": True, "price": float(price), "sample": "AAPL"})
            return jsonify({"success": False, "error": r.get("error") or "无法获取有效价格，请检查 API Key"}), 400
        elif source == "yahoo":
            import yfinance as yf
            df = yf.download("AAPL", period="5d", interval="1d", progress=False)
            price = float(df["Close"].dropna().iloc[-1]) if not df.empty else None
            if price and price > 0:
                return jsonify({"success": True, "price": price, "sample": "AAPL"})
            return jsonify({"success": False, "error": "Yahoo 获取不到数据"}), 400
        elif source == "polygon":
            import requests
            resp = requests.get(
                "https://api.polygon.io/v2/aggs/ticker/AAPL/prev",
                params={"apiKey": api_key},
                timeout=10,
            )
            r = resp.json()
            results = r.get("results", [])
            if results:
                price = results[0].get("c")
                if price is not None and float(price) > 0:
                    return jsonify({"success": True, "price": float(price), "sample": "AAPL"})
            return jsonify({"success": False, "error": r.get("error") or "无法获取有效价格，请检查 API Key"}), 400
        elif source == "alpaca":
            import requests
            if ":" not in api_key:
                return jsonify({"success": False, "error": "格式应为 PKID:SECRET"}), 400
            key_id, secret = api_key.split(":", 1)
            resp = requests.get(
                "https://data.alpaca.markets/v2/stocks/AAPL/trades/latest",
                headers={"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret},
                timeout=10,
            )
            r = resp.json()
            trade = r.get("trade", {})
            price = trade.get("p")
            if price is not None and float(price) > 0:
                return jsonify({"success": True, "price": float(price), "sample": "AAPL"})
            return jsonify({"success": False, "error": r.get("message") or "无法获取有效价格，请检查 API Key"}), 400
        else:
            return jsonify({"success": False, "error": "未知数据源"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ------------------------------------------------------------------
# Admin Routes
# ------------------------------------------------------------------

# 1. Users
@app.route("/api/admin/users")
@jwt_required()
@require_admin
def admin_users():
    search = request.args.get("search", "", type=str).strip()
    offset = request.args.get("offset", 0, type=int)
    limit = request.args.get("limit", 50, type=int)
    params = []
    where = "1=1"
    if search:
        where = "(u.email ILIKE %s OR u.username ILIKE %s OR u.id::text = %s)"
        params = [f"%{search}%", f"%{search}%", search]
    rows = execute(f'''
        SELECT u.id, u.username, u.email, u.is_active, u.is_admin, u.created_at, u.last_login_ip,
               p.tier, p.max_accounts, p.display_name, p.base_currency,
               (SELECT COUNT(*) FROM xml_uploads WHERE user_id = u.id) AS upload_count,
               (SELECT MAX(created_at) FROM xml_uploads WHERE user_id = u.id) AS last_upload_at
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        WHERE {where}
        ORDER BY u.created_at DESC
        LIMIT %s OFFSET %s
    ''', tuple(params) + (limit, offset))
    total = execute_one(f"SELECT COUNT(*) AS c FROM users u WHERE {where}", tuple(params))
    return jsonify({"users": [dict(r) for r in rows], "total": total["c"] if total else 0})


@app.route("/api/admin/users/<user_id>")
@jwt_required()
@require_admin
def admin_user_detail(user_id):
    user = execute_one('''
        SELECT u.id, u.username, u.email, u.is_active, u.is_admin, u.created_at, u.updated_at, u.last_login_ip,
               p.tier, p.max_accounts, p.display_name, p.base_currency, p.retention_days, p.max_history_months
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        WHERE u.id = %s
    ''', (user_id,))
    if not user:
        return jsonify({"error": "User not found"}), 404
    accounts = execute('''
        SELECT account_id, label, color, is_default, created_at
        FROM user_accounts
        WHERE user_id = %s
        ORDER BY created_at
    ''', (user_id,))
    uploads = execute('''
        SELECT id, filename, account_id, status, rows_inserted, created_at, completed_at, error_message
        FROM xml_uploads
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 20
    ''', (user_id,))
    return jsonify({
        "user": dict(user),
        "accounts": [dict(a) for a in accounts],
        "recent_uploads": [dict(u) for u in uploads]
    })


@app.route("/api/admin/users/<user_id>", methods=["POST"])
@jwt_required()
@require_admin
def admin_user_update(user_id):
    data = request.get_json(silent=True) or {}
    admin_id = get_jwt_identity()
    is_active = data.get("is_active")
    is_admin = data.get("is_admin")
    tier = data.get("tier")
    max_accounts = data.get("max_accounts")
    base_currency = data.get("base_currency")
    with get_cursor() as cur:
        if is_active is not None:
            cur.execute("UPDATE users SET is_active = %s WHERE id = %s", (is_active, user_id))
        if is_admin is not None:
            cur.execute("UPDATE users SET is_admin = %s WHERE id = %s", (is_admin, user_id))
        if tier is not None or max_accounts is not None or base_currency is not None:
            cur.execute('''
                INSERT INTO user_profiles (user_id, tier, max_accounts, base_currency)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    tier = COALESCE(EXCLUDED.tier, user_profiles.tier),
                    max_accounts = COALESCE(EXCLUDED.max_accounts, user_profiles.max_accounts),
                    base_currency = COALESCE(EXCLUDED.base_currency, user_profiles.base_currency),
                    updated_at = NOW()
            ''', (user_id, tier or 'free', max_accounts or 1, base_currency or 'USD'))
    _audit_log(admin_id, "update_user", "user", user_id, data)
    return jsonify({"success": True})


@app.route("/api/admin/users/<user_id>/delete", methods=["POST"])
@jwt_required()
@require_admin
def admin_user_delete(user_id):
    admin_id = get_jwt_identity()
    with get_cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    _audit_log(admin_id, "delete_user", "user", user_id)
    return jsonify({"success": True})


# 2. Uploads
@app.route("/api/admin/uploads")
@jwt_required()
@require_admin
def admin_uploads():
    offset = request.args.get("offset", 0, type=int)
    limit = request.args.get("limit", 50, type=int)
    status = request.args.get("status", "", type=str).strip()
    user_id = request.args.get("user_id", "", type=str).strip()
    account_id = request.args.get("account_id", "", type=str).strip()
    search = request.args.get("search", "", type=str).strip()
    where_clauses = ["1=1"]
    params = []
    if status:
        where_clauses.append("x.status = %s")
        params.append(status)
    if user_id:
        where_clauses.append("x.user_id = %s")
        params.append(user_id)
    if account_id:
        where_clauses.append("x.account_id = %s")
        params.append(account_id)
    if search:
        where_clauses.append("(x.filename ILIKE %s OR u.email ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    where = " AND ".join(where_clauses)
    rows = execute(f'''
        SELECT x.id, x.user_id, u.email, x.filename, x.account_id, x.status,
               x.rows_inserted, x.created_at, x.completed_at, x.error_message, x.storage_path
        FROM xml_uploads x
        JOIN users u ON x.user_id = u.id
        WHERE {where}
        ORDER BY x.created_at DESC
        LIMIT %s OFFSET %s
    ''', tuple(params) + (limit, offset))
    total = execute_one(f"SELECT COUNT(*) AS c FROM xml_uploads x JOIN users u ON x.user_id = u.id WHERE {where}", tuple(params))
    return jsonify({"uploads": [dict(r) for r in rows], "total": total["c"] if total else 0})


@app.route("/api/admin/uploads/<upload_id>")
@jwt_required()
@require_admin
def admin_upload_detail(upload_id):
    upload = execute_one('''
        SELECT x.*, u.email
        FROM xml_uploads x
        JOIN users u ON x.user_id = u.id
        WHERE x.id = %s
    ''', (upload_id,))
    if not upload:
        return jsonify({"error": "Upload not found"}), 404
    return jsonify({"upload": dict(upload)})


@app.route("/api/admin/uploads/<upload_id>/retry", methods=["POST"])
@jwt_required()
@require_admin
def admin_upload_retry(upload_id):
    admin_id = get_jwt_identity()
    row = execute_one("SELECT user_id, storage_path FROM xml_uploads WHERE id = %s", (upload_id,))
    if not row:
        return jsonify({"error": "Upload not found"}), 404
    user_id, path = row["user_id"], row["storage_path"]
    if not path or not os.path.exists(path):
        return jsonify({"error": "Original file not found"}), 400
    with get_cursor() as cur:
        cur.execute("UPDATE xml_uploads SET status = 'pending', error_message = NULL WHERE id = %s", (upload_id,))
    job = queue.enqueue(import_xml_job, str(user_id), upload_id, path, job_timeout=600)
    _audit_log(admin_id, "retry_upload", "upload", upload_id, {"job_id": job.id})
    return jsonify({"success": True, "jobId": job.id})


@app.route("/api/admin/uploads/<upload_id>/download")
@jwt_required()
@require_admin
def admin_upload_download(upload_id):
    row = execute_one("SELECT storage_path, filename FROM xml_uploads WHERE id = %s", (upload_id,))
    if not row:
        return jsonify({"error": "Upload not found"}), 404
    path, filename = row["storage_path"], row["filename"]
    if not path or not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404
    with open(path, "rb") as f:
        data = f.read()
    return Response(data, headers={
        "Content-Type": "application/xml",
        "Content-Disposition": f'attachment; filename="{secure_filename(filename)}"'
    })


# 3. Accounts
@app.route("/api/admin/accounts", methods=["GET", "POST"])
@jwt_required()
@require_admin
def admin_accounts():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        action = data.get("action")
        if action == "create":
            alias = data.get("alias")
            label = data.get("label")
            color = data.get("color", "#6366f1")
            # This is a legacy endpoint for server-side config; we just return success
            return jsonify({"success": True})
        if action == "delete":
            return jsonify({"success": True})
        return jsonify({"error": "Unknown action"}), 400
    rows = execute('''
        SELECT ua.user_id, u.email, ua.account_id, ua.label, ua.is_default, ua.created_at,
               (SELECT COUNT(*) FROM xml_uploads WHERE user_id = ua.user_id AND account_id = ua.account_id) AS upload_count,
               (SELECT MIN(date) FROM daily_nav WHERE user_id = ua.user_id AND account_id = ua.account_id) AS nav_from,
               (SELECT MAX(date) FROM daily_nav WHERE user_id = ua.user_id AND account_id = ua.account_id) AS nav_to,
               (SELECT COUNT(*) FROM daily_nav WHERE user_id = ua.user_id AND account_id = ua.account_id) AS nav_days
        FROM user_accounts ua
        JOIN users u ON ua.user_id = u.id
        ORDER BY ua.created_at DESC
    ''')
    return jsonify({"accounts": [dict(r) for r in rows]})


@app.route("/api/admin/accounts/<account_id>/stats")
@jwt_required()
@require_admin
def admin_account_stats(account_id):
    user_id = request.args.get("user_id", "", type=str).strip()
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    nav_stats = execute_one('''
        SELECT COUNT(*) AS days, MIN(date) AS from_date, MAX(date) AS to_date, MAX(ending_value) AS max_nav
        FROM daily_nav
        WHERE user_id = %s AND account_id = %s
    ''', (user_id, account_id))
    pos_stats = execute_one('''
        SELECT COUNT(DISTINCT date) AS pos_days, COUNT(DISTINCT symbol) AS symbols
        FROM positions
        WHERE user_id = %s AND account_id = %s
    ''', (user_id, account_id))
    trade_stats = execute_one('''
        SELECT COUNT(*) AS trades, SUM(CASE WHEN buy_sell = 'BUY' THEN 1 ELSE 0 END) AS buys,
               SUM(CASE WHEN buy_sell = 'SELL' THEN 1 ELSE 0 END) AS sells
        FROM archive_trade
        WHERE user_id = %s AND account_id = %s
    ''', (user_id, account_id))
    upload_stats = execute_one('''
        SELECT COUNT(*) AS uploads, SUM(rows_inserted) AS total_rows
        FROM xml_uploads
        WHERE user_id = %s AND account_id = %s
    ''', (user_id, account_id))
    return jsonify({
        "nav": dict(nav_stats) if nav_stats else {},
        "positions": dict(pos_stats) if pos_stats else {},
        "trades": dict(trade_stats) if trade_stats else {},
        "uploads": dict(upload_stats) if upload_stats else {}
    })


# 4. Admin Dashboard View
@app.route("/api/admin/dashboard")
@jwt_required()
@require_admin
def admin_dashboard():
    target_user = request.args.get("user_id", "", type=str).strip()
    account_id = request.args.get("account_id", "combined", type=str).strip()
    if not target_user:
        return jsonify({"error": "user_id required"}), 400
    import scripts.postgres_to_dashboard as pgdash
    data = pgdash.generate_dashboard_data(target_user, account_id)
    if data is None:
        return jsonify({"error": "Data not found"}), 404
    return jsonify(data)


# 5. Data Quality
@app.route("/api/admin/data-quality")
@jwt_required()
@require_admin
def admin_data_quality():
    # Users with no data
    no_data_users = execute('''
        SELECT u.id, u.email, u.created_at
        FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM daily_nav WHERE user_id = u.id)
        ORDER BY u.created_at DESC
        LIMIT 20
    ''')
    # Failed uploads
    failed_uploads = execute('''
        SELECT x.id, u.email, x.filename, x.error_message, x.created_at
        FROM xml_uploads x
        JOIN users u ON x.user_id = u.id
        WHERE x.status = 'failed'
        ORDER BY x.created_at DESC
        LIMIT 20
    ''')
    # Orphan uploads (file missing)
    orphan_count = 0
    # Accounts missing positions for latest nav date
    missing_pos = execute('''
        SELECT dn.user_id, dn.account_id, dn.date
        FROM daily_nav dn
        WHERE dn.date = (SELECT MAX(date) FROM daily_nav dn2 WHERE dn2.user_id = dn.user_id AND dn2.account_id = dn.account_id)
          AND NOT EXISTS (
              SELECT 1 FROM positions p
              WHERE p.user_id = dn.user_id AND p.account_id = dn.account_id AND p.date = dn.date
          )
        LIMIT 20
    ''')
    # Uploads with zero rows
    zero_row_uploads = execute('''
        SELECT x.id, u.email, x.filename, x.account_id, x.created_at
        FROM xml_uploads x
        JOIN users u ON x.user_id = u.id
        WHERE x.status = 'done' AND (x.rows_inserted = 0 OR x.rows_inserted IS NULL)
        ORDER BY x.created_at DESC
        LIMIT 20
    ''')
    # Overall counts
    totals = execute_one('''
        SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM xml_uploads) AS total_uploads,
            (SELECT COUNT(*) FROM xml_uploads WHERE status = 'failed') AS failed_count,
            (SELECT COUNT(*) FROM daily_nav) AS total_nav_rows,
            (SELECT COUNT(*) FROM positions) AS total_pos_rows,
            (SELECT COUNT(*) FROM archive_trade) AS total_trade_rows
    ''')
    return jsonify({
        "totals": dict(totals) if totals else {},
        "noDataUsers": [dict(r) for r in no_data_users],
        "failedUploads": [dict(r) for r in failed_uploads],
        "missingPositions": [dict(r) for r in missing_pos],
        "zeroRowUploads": [dict(r) for r in zero_row_uploads]
    })


# 6. System Status
@app.route("/api/admin/system")
@jwt_required()
@require_admin
def admin_system():
    q_len = queue.count
    workers = len(queue.connection.smembers("rq:workers"))
    redis_ping = queue.connection.ping()
    # DB stats
    db_size = execute_one("SELECT pg_database_size(current_database()) AS size")
    # Recent uploads summary
    uploads_24h = execute_one("SELECT COUNT(*) AS c FROM xml_uploads WHERE created_at > NOW() - INTERVAL '24 hours'")
    uploads_7d = execute_one("SELECT COUNT(*) AS c FROM xml_uploads WHERE created_at > NOW() - INTERVAL '7 days'")
    return jsonify({
        "queue_length": q_len,
        "active_workers": workers,
        "redis_connected": redis_ping,
        "db_size_bytes": db_size["size"] if db_size else 0,
        "uploads_24h": uploads_24h["c"] if uploads_24h else 0,
        "uploads_7d": uploads_7d["c"] if uploads_7d else 0
    })


# 7. Audit Logs
@app.route("/api/admin/audit-logs")
@jwt_required()
@require_admin
def admin_audit_logs():
    offset = request.args.get("offset", 0, type=int)
    limit = request.args.get("limit", 50, type=int)
    rows = execute('''
        SELECT l.id, l.admin_id, a.email AS admin_email, l.action, l.target_type, l.target_id,
               l.details, l.ip_address, l.created_at
        FROM admin_audit_logs l
        JOIN users a ON l.admin_id = a.id
        ORDER BY l.created_at DESC
        LIMIT %s OFFSET %s
    ''', (limit, offset))
    total = execute_one("SELECT COUNT(*) AS c FROM admin_audit_logs")
    return jsonify({"logs": [dict(r) for r in rows], "total": total["c"] if total else 0})


# 8. Config
@app.route("/api/admin/config")
@jwt_required()
@require_admin
def admin_config_get():
    path = os.path.join(APP_DIR, "config", "server_config.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    else:
        cfg = {"settings": {"baseCurrency": "USD", "fxOverrides": {}}, "public": {}}
    return jsonify(cfg)


@app.route("/api/admin/config", methods=["POST"])
@jwt_required()
@require_admin
def admin_config_post():
    data = request.get_json(silent=True) or {}
    admin_id = get_jwt_identity()
    path = os.path.join(APP_DIR, "config", "server_config.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    _audit_log(admin_id, "update_config", "config", None, data)
    return jsonify({"success": True})


# 9. System APIs (used by SettingsPanel / dashboardStore)
@app.route("/api/system/status")
@optional_jwt
def api_system_status():
    import shutil
    disk = shutil.disk_usage(APP_DIR)
    db_size = execute_one("SELECT pg_database_size(current_database()) AS size")
    latest_import = execute_one('''
        SELECT filename, status, created_at FROM xml_uploads
        ORDER BY created_at DESC LIMIT 1
    ''')
    latest_refresh = execute_one('''
        SELECT MAX(completed_at) AS t FROM xml_uploads WHERE status = 'done'
    ''')
    freshness = None
    if latest_refresh and latest_refresh.get("t"):
        from datetime import timezone
        now = datetime.now(latest_refresh["t"].tzinfo) if latest_refresh["t"].tzinfo else datetime.now()
        freshness = round((now - latest_refresh["t"]).total_seconds() / 3600, 1)
    return jsonify({
        "latestRefresh": latest_refresh["t"].isoformat() if latest_refresh and latest_refresh.get("t") else None,
        "dataFreshnessHours": freshness,
        "dbSizeMB": round(db_size["size"] / (1024*1024), 1) if db_size else 0,
        "diskFreeGB": round(disk.free / (1024**3), 1),
        "importCount": (execute_one("SELECT COUNT(*) AS c FROM xml_uploads WHERE status = 'done'") or {}).get("c", 0),
        "latestImport": {
            "fileName": latest_import["filename"],
            "status": latest_import["status"],
            "time": latest_import["created_at"].isoformat() if latest_import else None
        } if latest_import else None,
        "settings": {
            "retention": {"backups": 15, "uploads": 30, "logs": 90}
        }
    })


@app.route("/api/admin/imports")
@jwt_required()
@require_admin
def admin_imports():
    offset = request.args.get("offset", 0, type=int)
    limit = request.args.get("limit", 20, type=int)
    rows = execute('''
        SELECT id, filename, status, created_at FROM xml_uploads
        ORDER BY created_at DESC LIMIT %s OFFSET %s
    ''', (limit, offset))
    return jsonify({
        "imports": [dict(r) for r in rows],
        "total": (execute_one("SELECT COUNT(*) AS c FROM xml_uploads") or {}).get("c", 0)
    })


@app.route("/api/admin/latest-dq")
@jwt_required()
@require_admin
def admin_latest_dq():
    path = os.path.join(APP_DIR, "data", "dq_report.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            report = json.load(f)
    else:
        report = {"checkedAt": None, "issues": []}
    return jsonify(report)


@app.route("/api/admin/run-dq-check", methods=["POST"])
@jwt_required()
@require_admin
def admin_run_dq_check():
    issues = []
    # Check failed uploads in last 24h
    failed = execute_one("SELECT COUNT(*) AS c FROM xml_uploads WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'")
    if failed and failed["c"] > 0:
        issues.append({"category": "upload", "severity": "error", "message": f"过去24小时有 {failed['c']} 个上传失败"})
    # Check stale data
    stale = execute_one("SELECT COUNT(*) AS c FROM daily_nav WHERE date < CURRENT_DATE - INTERVAL '2 days'")
    if stale and stale["c"] == 0:
        issues.append({"category": "data", "severity": "warning", "message": "NAV 数据可能已过期"})
    report = {"checkedAt": datetime.now().isoformat(), "issues": issues}
    os.makedirs(os.path.join(APP_DIR, "data"), exist_ok=True)
    with open(os.path.join(APP_DIR, "data", "dq_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False)
    return jsonify(report)


@app.route("/api/admin/backups")
@jwt_required()
@require_admin
def admin_backups():
    return jsonify({"backups": backup_utils.list_backups()})


@app.route("/api/admin/restore-backup", methods=["POST"])
@jwt_required()
@require_admin
def admin_restore_backup():
    data = request.get_json(silent=True) or {}
    ts = data.get("timestamp")
    if not ts:
        return jsonify({"error": "timestamp required"}), 400
    ok = backup_utils.restore_backup(ts)
    if not ok:
        return jsonify({"error": "Backup not found"}), 404
    return jsonify({"success": True})


@app.route("/api/admin/backups/<timestamp>/download")
@jwt_required()
@require_admin
def admin_download_backup(timestamp):
    import zipfile
    src = os.path.join(BACKUP_DIR, timestamp)
    if not os.path.isdir(src):
        return jsonify({"error": "Backup not found"}), 404
    zip_path = os.path.join("/tmp", f"backup_{timestamp}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src):
            for f in files:
                full = os.path.join(root, f)
                zf.write(full, os.path.relpath(full, src))
    with open(zip_path, "rb") as f:
        data = f.read()
    return Response(data, headers={
        "Content-Type": "application/zip",
        "Content-Disposition": f'attachment; filename="backup_{timestamp}.zip"'
    })


@app.route("/api/admin/run-cleanup", methods=["POST"])
@jwt_required()
@require_admin
def admin_run_cleanup():
    removed_backups = backup_utils.cleanup_old_backups(keep=15)
    removed_uploads = backup_utils.cleanup_uploads(days=30)
    removed_logs = backup_utils.cleanup_logs(days=90)
    return jsonify({
        "backupsRemoved": removed_backups,
        "uploadsRemoved": removed_uploads,
        "logsRemoved": removed_logs
    })


@app.route("/api/admin/test-webhook", methods=["POST"])
@jwt_required()
@require_admin
def admin_test_webhook():
    import requests
    cfg = admin_config_get().get_json()
    url = (cfg.get("settings") or {}).get("webhook", {}).get("url", "")
    if not url:
        return jsonify({"error": "No webhook URL configured"}), 400
    payload = {
        "event": "test",
        "title": "IB Dashboard Webhook 测试",
        "message": "这是一条测试消息，说明你的 Webhook 配置正确。",
        "timestamp": datetime.now().isoformat()
    }
    try:
        resp = requests.post(url, json=payload, timeout=30, headers={"Content-Type": "application/json"})
        resp.raise_for_status()
        return jsonify({"success": True, "status": resp.status_code})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# 10. Export
@app.route("/api/admin/export/dashboard")
@jwt_required()
@require_admin
def admin_export_dashboard():
    target_user = request.args.get("user_id", "", type=str).strip()
    account_id = request.args.get("account_id", "combined", type=str).strip()
    fmt = request.args.get("format", "csv", type=str).strip()
    if not target_user:
        return jsonify({"error": "user_id required"}), 400
    import scripts.postgres_to_dashboard as pgdash
    data = pgdash.generate_dashboard_data(target_user, account_id)
    if data is None:
        return jsonify({"error": "Data not found"}), 404

    if fmt == "json":
        return Response(
            json.dumps(data, ensure_ascii=False, indent=2, default=str),
            headers={"Content-Type": "application/json", "Content-Disposition": f'attachment; filename="dashboard_{account_id}.json"'}
        )

    # CSV export of key tables: trades, dividends, positions
    import csv
    import io
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["IB Dashboard Export", f"Account: {account_id}", f"Generated: {datetime.now().isoformat()}"])
    writer.writerow([])
    writer.writerow(["Summary"])
    summary = data.get("summary", {})
    for k, v in summary.items():
        writer.writerow([k, v])
    writer.writerow([])
    writer.writerow(["Trades"])
    trades = data.get("trades", [])
    if trades:
        writer.writerow(list(trades[0].keys()))
        for t in trades:
            writer.writerow(list(t.values()))
    else:
        writer.writerow(["No trades"])
    writer.writerow([])
    writer.writerow(["Open Positions - Stocks"])
    stocks = data.get("openPositions", {}).get("stocks", [])
    if stocks:
        writer.writerow(list(stocks[0].keys()))
        for p in stocks:
            writer.writerow(list(p.values()))
    else:
        writer.writerow(["No positions"])
    return Response(
        output.getvalue().encode("utf-8-sig"),
        headers={"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": f'attachment; filename="dashboard_{account_id}.csv"'}
    )


# 11. Upload comparison
@app.route("/api/admin/uploads/<upload_id>/compare/<other_upload_id>")
@jwt_required()
@require_admin
def admin_upload_compare(upload_id, other_upload_id):
    a = execute_one('SELECT user_id, account_id, storage_path FROM xml_uploads WHERE id = %s', (upload_id,))
    b = execute_one('SELECT user_id, account_id, storage_path FROM xml_uploads WHERE id = %s', (other_upload_id,))
    if not a or not b:
        return jsonify({"error": "Upload not found"}), 404
    if a["user_id"] != b["user_id"]:
        return jsonify({"error": "Cannot compare uploads from different users"}), 400
    user_id = a["user_id"]
    account_id = a["account_id"] or b["account_id"]

    # Compare positions by symbol
    pos_a = execute('''
        SELECT symbol, position, position_value, mark_price
        FROM archive_open_position
        WHERE user_id = %s AND stmt_account_id = %s
          AND stmt_date = (SELECT stmt_date FROM archive_open_position WHERE user_id = %s AND stmt_account_id = %s ORDER BY stmt_date DESC LIMIT 1)
    ''', (user_id, account_id, user_id, account_id))
    # Simplification: compare using the two upload ids indirectly by looking at the latest positions for the account
    # A more accurate approach would be to snapshot per upload, but we can compare archive_open_position by stmt_date
    latest_dates = execute('''
        SELECT DISTINCT stmt_date FROM archive_open_position
        WHERE user_id = %s AND stmt_account_id = %s
        ORDER BY stmt_date DESC LIMIT 2
    ''', (user_id, account_id))
    if len(latest_dates) < 2:
        return jsonify({"error": "Not enough history for comparison"}), 400
    d1, d2 = latest_dates[0]["stmt_date"], latest_dates[1]["stmt_date"]
    p1 = execute('''
        SELECT symbol, position, position_value, mark_price
        FROM archive_open_position
        WHERE user_id = %s AND stmt_account_id = %s AND stmt_date = %s
    ''', (user_id, account_id, d1))
    p2 = execute('''
        SELECT symbol, position, position_value, mark_price
        FROM archive_open_position
        WHERE user_id = %s AND stmt_account_id = %s AND stmt_date = %s
    ''', (user_id, account_id, d2))
    pos_map1 = {r["symbol"]: r for r in p1}
    pos_map2 = {r["symbol"]: r for r in p2}
    all_symbols = set(pos_map1.keys()) | set(pos_map2.keys())
    position_diffs = []
    for sym in sorted(all_symbols):
        r1 = pos_map1.get(sym)
        r2 = pos_map2.get(sym)
        if not r1 or not r2:
            position_diffs.append({
                "symbol": sym,
                "change": "added" if r1 else "removed",
                "position_before": float(r2["position"]) if r2 else 0,
                "position_after": float(r1["position"]) if r1 else 0,
            })
        elif float(r1["position"] or 0) != float(r2["position"] or 0):
            position_diffs.append({
                "symbol": sym,
                "change": "changed",
                "position_before": float(r2["position"]),
                "position_after": float(r1["position"]),
            })

    # Compare trade counts between the two latest statement dates
    t1 = execute('''
        SELECT trade_id, symbol, buy_sell, quantity, trade_price, trade_money
        FROM archive_trade
        WHERE user_id = %s AND account_id = %s AND trade_date = %s::text
    ''', (user_id, account_id, d1))
    t2 = execute('''
        SELECT trade_id, symbol, buy_sell, quantity, trade_price, trade_money
        FROM archive_trade
        WHERE user_id = %s AND account_id = %s AND trade_date = %s::text
    ''', (user_id, account_id, d2))
    return jsonify({
        "accountId": account_id,
        "dates": {"newer": str(d1), "older": str(d2)},
        "positionChanges": position_diffs,
        "tradeCounts": {"newer": len(t1), "older": len(t2)},
    })


# 12. Alert runner endpoint
@app.route("/api/admin/run-alerts", methods=["POST"])
@jwt_required()
@require_admin
def admin_run_alerts():
    result = run_alerts()
    return jsonify(result)


# 13. Refresh endpoint (legacy compat)
@app.route("/api/admin/refresh", methods=["POST"])
@jwt_required()
@require_admin
def admin_refresh():
    # Create a backup then enqueue a no-op or placeholder refresh job
    ts = backup_utils.create_backup()
    job = queue.enqueue(backup_utils.create_backup, job_timeout=300)
    return jsonify({"success": True, "jobId": job.id, "backupTimestamp": ts})


# ------------------------------------------------------------------

# ------------------------------------------------------------------
# User uploads management
# ------------------------------------------------------------------

@app.route("/api/uploads")
@jwt_required()
def user_uploads():
    user_id = get_jwt_identity()
    rows = execute('''
        SELECT id, filename, file_md5, stmt_date, account_id, status,
               rows_inserted, error_message, created_at, completed_at
        FROM xml_uploads
        WHERE user_id = %s
        ORDER BY created_at DESC
    ''', (user_id,))
    return jsonify({"uploads": [dict(r) for r in rows]})


@app.route("/api/uploads/<upload_id>", methods=["DELETE"])
@jwt_required()
def user_upload_delete(upload_id):
    user_id = get_jwt_identity()
    upload = execute_one(
        "SELECT user_id, storage_path FROM xml_uploads WHERE id = %s",
        (upload_id,)
    )
    if not upload:
        return jsonify({"error": "Upload not found"}), 404
    if str(upload["user_id"]) != str(user_id):
        return jsonify({"error": "Forbidden"}), 403
    # Delete physical file
    path = upload.get("storage_path")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass
    # Delete upload record (flex_sync_logs will set upload_id NULL via FK)
    with get_cursor() as cur:
        cur.execute("DELETE FROM xml_uploads WHERE id = %s", (upload_id,))
    return jsonify({"success": True})


@app.route("/api/uploads/reset", methods=["POST"])
@jwt_required()
def user_upload_reset():
    user_id = get_jwt_identity()
    tables = [
        "archive_account_information",
        "archive_asset_summary",
        "archive_cash_report_currency",
        "archive_cash_transaction",
        "archive_change_in_dividend_accrual",
        "archive_change_in_nav",
        "archive_change_in_position_value",
        "archive_conversion_rate",
        "archive_corporate_action",
        "archive_equity_summary_by_report_date_in_base",
        "archive_fdic_insured_deposits_by_bank_entry",
        "archive_fifo_performance_summary_underlying",
        "archive_flex_statement",
        "archive_fx_lot",
        "archive_fx_position",
        "archive_interest_accruals_currency",
        "archive_lot",
        "archive_mtdytd_performance_summary_underlying",
        "archive_mtm_performance_summary_underlying",
        "archive_net_stock_position",
        "archive_open_dividend_accrual",
        "archive_open_position",
        "archive_option_eae",
        "archive_order",
        "archive_prior_period_position",
        "archive_security_info",
        "archive_slb_activity",
        "archive_slb_collateral",
        "archive_slb_fee",
        "archive_slb_open_contract",
        "archive_statement_of_funds_line",
        "archive_symbol_summary",
        "archive_tier_interest_detail",
        "archive_trade",
        "archive_transfer",
        "archive_unbundled_commission_detail",
    ]
    with get_cursor() as cur:
        for tbl in tables:
            cur.execute(f"DELETE FROM {tbl} WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM cash_report WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM cost_basis_history WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM cost_basis_snapshots WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM daily_nav WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM flex_sync_logs WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM market_prices WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM option_eae WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM positions WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM xml_uploads WHERE user_id = %s", (user_id,))
    return jsonify({"success": True})
# Static files (React SPA catch-all)
# ------------------------------------------------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa_catch_all(path):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    react_dist = os.path.join(APP_DIR, "web", "dist")
    react_index = os.path.join(react_dist, "index.html")
    if path:
        target = os.path.join(react_dist, path)
        if os.path.exists(target) and os.path.isfile(target):
            return send_from_directory(react_dist, path)
    if os.path.exists(react_index):
        return send_from_directory(react_dist, "index.html")
    return jsonify({"error": "Not found"}), 404


# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------
if __name__ == "__main__":
    # 启动实时行情定时刷新（仅本地开发单进程模式；生产环境请用 cron/systemd timer）
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from scripts.market_data import scheduled_update_all
        import threading
        scheduler = BackgroundScheduler()
        scheduler.add_job(scheduled_update_all, 'interval', minutes=30, id='market_data_refresh', replace_existing=True)
        scheduler.start()
        print("📈 Market data scheduler started (every 30 min)")
        # 启动时在后台线程立即执行一次预热，避免阻塞 Flask 启动
        threading.Thread(target=scheduled_update_all, daemon=True).start()
    except Exception as e:
        print(f"⚠️  Market scheduler failed to start: {e}")

    port = int(os.environ.get("PORT", 8080))
    print(f"🚀 SaaS server running at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
