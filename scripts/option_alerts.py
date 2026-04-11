#!/usr/bin/env python3
"""
期权到期提醒 - Telegram 通知
监控持仓期权，在到期前 N 天发送提醒
"""

import json
import requests
import sys
from datetime import datetime, timedelta
from pathlib import Path


# Telegram 配置（从 MEMORY.md 获取）
TELEGRAM_CONFIG = {
    'bot_token': '8587848312:AAEPsIMg-MD8mdPhMIpKL3G5ZmuqUj3Tvgs',
    'chat_id': '5496550509',
    'proxy': None  # 先尝试无代理，失败再用代理
}

# 备用代理配置
PROXY_LIST = [
    'http://127.0.0.1:7899',  # Clash Verge
    'http://127.0.0.1:7890',  # 常见代理端口
    'socks5://127.0.0.1:7898',
]


def send_telegram_message(message, parse_mode='HTML'):
    """发送 Telegram 消息（支持多代理尝试）"""
    url = f"https://api.telegram.org/bot{TELEGRAM_CONFIG['bot_token']}/sendMessage"
    
    data = {
        'chat_id': TELEGRAM_CONFIG['chat_id'],
        'text': message,
        'parse_mode': parse_mode
    }
    
    # 尝试连接列表
    proxy_attempts = [None] + PROXY_LIST
    
    for proxy_url in proxy_attempts:
        proxies = {
            'http': proxy_url,
            'https': proxy_url
        } if proxy_url else None
        
        try:
            resp = requests.post(url, json=data, proxies=proxies, timeout=30)
            result = resp.json()
            if result.get('ok'):
                print(f"✅ Telegram 消息发送成功 (proxy: {proxy_url or '直连'})")
                return True
            else:
                print(f"❌ Telegram 发送失败：{result}")
                return False
        except Exception as e:
            print(f"⚠️  代理 {proxy_url or '直连'} 失败：{e}")
            continue
    
    print(f"❌ 所有代理均失败")
    return False


def check_option_expiry(positions_file, alert_days=[30, 14, 7, 3, 1]):
    """
    检查期权到期情况并发送提醒
    
    Args:
        positions_file: 持仓 JSON 文件路径
        alert_days: 提前多少天提醒
    """
    with open(positions_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    options = data.get('openPositions', {}).get('options', [])
    if not options:
        print("📄 没有期权持仓")
        return
    
    today = datetime.now()
    alerts = {days: [] for days in alert_days}
    
    for opt in options:
        try:
            expiry_str = opt.get('expiry', '')
            if not expiry_str:
                continue
            
            # 解析到期日
            try:
                expiry_date = datetime.strptime(expiry_str, '%Y-%m-%d')
            except:
                try:
                    expiry_date = datetime.strptime(expiry_str, '%m/%d/%Y')
                except:
                    continue
            
            days_to_expiry = (expiry_date - today).days
            
            # 只提醒未到期的
            if days_to_expiry < 0:
                continue
            
            # 检查是否需要提醒
            for alert_day in alert_days:
                if days_to_expiry == alert_day:
                    alerts[alert_day].append({
                        'symbol': opt.get('symbol', ''),
                        'type': opt.get('type', ''),
                        'strike': opt.get('strike', 0),
                        'expiry': expiry_str,
                        'days': days_to_expiry,
                        'quantity': opt.get('quantity', 0),
                        'marketPrice': opt.get('marketPrice', 0),
                        'breakEven': opt.get('breakEven', 0),
                        'inTheMoney': opt.get('inTheMoney', False)
                    })
        except Exception as e:
            print(f"处理期权 {opt.get('symbol', 'N/A')} 出错：{e}")
    
    # 发送提醒
    message_sent = False
    for days, options_list in alerts.items():
        if options_list:
            message = format_alert_message(days, options_list)
            send_telegram_message(message)
            message_sent = True
    
    if not message_sent:
        print("📄 今天没有需要发送的到期提醒")
    
    # 打印所有期权状态
    print("\n📊 期权到期状态总览:")
    print("-" * 80)
    for opt in sorted(options, key=lambda x: x.get('daysToExpiry', 999)):
        symbol = opt.get('symbol', 'N/A')
        opt_type = opt.get('type', 'N/A')
        strike = opt.get('strike', 0)
        days = opt.get('daysToExpiry', 0)
        expiry = opt.get('expiry', 'N/A')
        itm = "💰" if opt.get('inTheMoney') else "○"
        print(f"{itm} {symbol} {opt_type} {strike} | 到期：{expiry} | 剩余：{days}天")


def format_alert_message(days, options_list):
    """格式化提醒消息"""
    if days == 1:
        emoji = "🚨"
        urgency = "【紧急提醒】"
    elif days <= 3:
        emoji = "⚠️"
        urgency = "【即将到期】"
    elif days <= 7:
        emoji = "⏰"
        urgency = "【本周到期】"
    elif days <= 14:
        emoji = "📅"
        urgency = "【两周到期】"
    else:
        emoji = "🗓️"
        urgency = "【月度提醒】"
    
    message = f"{emoji} {urgency} 期权到期提醒\n\n"
    message += f"以下期权将在 <b>{days} 天</b> 后到期：\n\n"
    
    for opt in options_list:
        symbol = opt['symbol']
        opt_type = 'Put' if opt['type'] == 'Put' else 'Call'
        strike = opt['strike']
        quantity = abs(opt['quantity'])
        current = opt['marketPrice']
        breakeven = opt['breakEven']
        itm = opt['inTheMoney']
        
        # 判断盈亏状态
        if opt_type == 'Put':
            status = "💰 实值" if current < strike else "○ 虚值"
        else:
            status = "💰 实值" if current > strike else "○ 虚值"
        
        message += f"📌 <b>{symbol} {opt_type} {strike}</b>\n"
        message += f"   数量：{quantity} 张\n"
        message += f"   到期：{opt['expiry']}\n"
        message += f"   现价：${current:.2f} | 盈亏平衡：${breakeven:.2f}\n"
        message += f"   状态：{status}\n\n"
    
    message += f"\n⏰ 更新时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}"
    message += f"\n\n💡 提示：请考虑是否平仓、展期或行权"
    
    return message


def send_daily_summary(positions_file):
    """发送每日持仓摘要"""
    with open(positions_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    nav = data.get('netAssetValue', {})
    positions = data.get('openPositions', {})
    perf = data.get('performanceSummary', {})
    
    stocks = positions.get('stocks', [])
    options = positions.get('options', [])
    
    # 计算涨跌家数
    gainers = sum(1 for s in stocks if s.get('unrealizedPL', 0) > 0)
    losers = sum(1 for s in stocks if s.get('unrealizedPL', 0) < 0)
    
    # 最大盈利/亏损
    if stocks:
        top_gainer = max(stocks, key=lambda x: x.get('unrealizedPLPct', 0))
        top_loser = min(stocks, key=lambda x: x.get('unrealizedPLPct', 0))
    else:
        top_gainer = top_loser = None
    
    message = f"📊 <b>IB 账户日报</b>\n\n"
    message += f"💰 账户净值：<b>¥{nav.get('total', 0):,.0f}</b>\n"
    message += f"📈 今日涨跌：<b>{nav.get('changeToday', 0):+,} ({nav.get('changeTodayPct', 0):+.2f}%)</b>\n\n"
    
    message += f"📊 持仓概况:\n"
    message += f"   股票/ETF: {len(stocks)} 只\n"
    message += f"   期权：{len(options)} 只\n"
    message += f"   盈利：{gainers} 只 | 亏损：{losers} 只\n\n"
    
    if top_gainer and top_gainer.get('unrealizedPLPct', 0) > 5:
        message += f" 表现最佳：{top_gainer['symbol']} +{top_gainer['unrealizedPLPct']:.1f}%\n"
    if top_loser and top_loser.get('unrealizedPLPct', 0) < -5:
        message += f"📉 表现最差：{top_loser['symbol']} {top_loser['unrealizedPLPct']:.1f}%\n"
    
    # 即将到期期权
    today = datetime.now()
    expiring_soon = [o for o in options if o.get('daysToExpiry', 999) <= 7 and o.get('daysToExpiry', 0) >= 0]
    if expiring_soon:
        message += f"\n⚠️ 7 天内到期：{len(expiring_soon)} 只期权\n"
        for opt in expiring_soon[:3]:
            message += f"   {opt['symbol']} {opt['type']} {opt['strike']} ({opt['daysToExpiry']}天)\n"
    
    message += f"\n⏰ 更新时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}"
    
    send_telegram_message(message)


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='期权到期提醒')
    parser.add_argument('positions_file', nargs='?', default='data/sample_data.json',
                       help='持仓 JSON 文件路径')
    parser.add_argument('--daily', action='store_true', help='发送每日摘要')
    parser.add_argument('--test', action='store_true', help='发送测试消息')
    
    args = parser.parse_args()
    
    if args.test:
        send_telegram_message("🧪 <b>测试消息</b>\n\nIB 期权提醒系统运行正常！")
        return
    
    if args.daily:
        send_daily_summary(args.positions_file)
    else:
        check_option_expiry(args.positions_file)


if __name__ == "__main__":
    main()
