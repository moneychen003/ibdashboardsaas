"""Telegram Bot notification helper."""
import requests
from datetime import datetime


def send_telegram_message(bot_token: str, chat_id: str, message: str) -> dict:
    """Send a plain text message via Telegram Bot API.

    Returns the parsed JSON response or raises on failure.
    """
    if not bot_token or not chat_id:
        raise ValueError("bot_token and chat_id are required")

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram API error: {data}")
    return data


def fmt_currency(value, currency="USD"):
    if value is None:
        return "-"
    prefix = "¥" if currency == "CNH" else "$"
    return f"{prefix}{value:,.2f}"
