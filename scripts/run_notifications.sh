#!/bin/bash
# SaaS 通知触发器（由 cron 每日 09:07 调用）
set -euo pipefail
cd /opt/ib_dashboard
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-ib_dashboard}"
export DB_USER="${DB_USER:-ibuser}"
export DB_PASSWORD="${DB_PASSWORD:-ibpass123}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
exec /opt/ib_dashboard/.venv/bin/python /opt/ib_dashboard/scripts/run_notifications.py
