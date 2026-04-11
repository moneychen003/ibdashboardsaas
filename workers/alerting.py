"""Background alerting worker for IB Dashboard SaaS."""
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import requests
from db.postgres_client import execute, execute_one


CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'server_config.json')
ALERT_STATE_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'alert_state.json')


def _load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"settings": {"webhook": {"url": "", "events": []}}}


def _load_state():
    if os.path.exists(ALERT_STATE_PATH):
        with open(ALERT_STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def _save_state(state):
    os.makedirs(os.path.dirname(ALERT_STATE_PATH), exist_ok=True)
    with open(ALERT_STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f)


def _should_alert(event_key, cooldown_minutes=60):
    state = _load_state()
    last = state.get(event_key)
    if last:
        last_dt = datetime.fromisoformat(last)
        if datetime.now() - last_dt < timedelta(minutes=cooldown_minutes):
            return False
    state[event_key] = datetime.now().isoformat()
    _save_state(state)
    return True


def _send_webhook(url, payload):
    if not url:
        return False, "No webhook URL configured"
    try:
        resp = requests.post(url, json=payload, timeout=30, headers={"Content-Type": "application/json"})
        resp.raise_for_status()
        return True, f"HTTP {resp.status_code}"
    except Exception as e:
        return False, str(e)


def check_import_failures():
    recent = execute_one("""
        SELECT COUNT(*) AS c FROM xml_uploads
        WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour'
    """)
    return recent["c"] if recent else 0


def check_stale_data():
    stale = execute_one("""
        SELECT COUNT(*) AS c FROM daily_nav
        WHERE date < CURRENT_DATE - INTERVAL '2 days'
    """)
    # More accurately: any account whose latest nav is older than 2 days
    rows = execute("""
        SELECT account_id, MAX(date) AS latest
        FROM daily_nav
        GROUP BY account_id
        HAVING MAX(date) < CURRENT_DATE - INTERVAL '2 days'
    """)
    return len(rows)


def check_disk_low():
    # Simplified: check available space on project disk
    stat = os.statvfs(os.path.dirname(__file__))
    free_gb = stat.f_frsize * stat.f_bavail / (1024**3)
    return free_gb < 5


def run_alerts():
    cfg = _load_config()
    webhook = cfg.get("settings", {}).get("webhook", {})
    url = webhook.get("url", "")
    events = set(webhook.get("events", []))
    if not url or not events:
        return {"status": "skipped", "reason": "No webhook or events configured"}

    results = []

    if 'import_failed' in events:
        count = check_import_failures()
        if count > 0 and _should_alert('import_failed', cooldown_minutes=60):
            payload = {
                "event": "import_failed",
                "title": "IB Dashboard: 导入失败告警",
                "message": f"过去 1 小时内有 {count} 个上传任务失败",
                "timestamp": datetime.now().isoformat(),
            }
            ok, info = _send_webhook(url, payload)
            results.append({"event": "import_failed", "sent": ok, "info": info})

    if 'stale_data' in events:
        count = check_stale_data()
        if count > 0 and _should_alert('stale_data', cooldown_minutes=360):
            payload = {
                "event": "stale_data",
                "title": "IB Dashboard: 数据过期告警",
                "message": f"有 {count} 个账户的最新 NAV 数据超过 2 天未更新",
                "timestamp": datetime.now().isoformat(),
            }
            ok, info = _send_webhook(url, payload)
            results.append({"event": "stale_data", "sent": ok, "info": info})

    if 'disk_low' in events:
        low = check_disk_low()
        if low and _should_alert('disk_low', cooldown_minutes=720):
            payload = {
                "event": "disk_low",
                "title": "IB Dashboard: 磁盘空间不足",
                "message": "服务器磁盘剩余空间不足 5GB，请及时清理",
                "timestamp": datetime.now().isoformat(),
            }
            ok, info = _send_webhook(url, payload)
            results.append({"event": "disk_low", "sent": ok, "info": info})

    return {"status": "done", "results": results}


if __name__ == '__main__':
    print(run_alerts())
