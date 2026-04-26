#!/bin/bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=ib_dashboard
export DB_USER=ibuser
export DB_PASSWORD=ibpass123
export REDIS_URL=redis://localhost:6379/0
export TELEGRAM_BOT_TOKEN=7671167468:AAGHX9ns309NoAsO2EJk4_Jyq219iMiP4HU
export DATA_DIR=/opt/ib_dashboard/data
exec /opt/ib_dashboard/.venv/bin/python3 /opt/ib_dashboard/scripts/tg_daily_broadcast.py
