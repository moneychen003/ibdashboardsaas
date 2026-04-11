#!/usr/bin/env python3
"""
实时行情获取脚本
支持雪球、Yahoo Finance、Alpha Vantage 等多个数据源
"""

import json
import requests
import sys
from datetime import datetime
from pathlib import Path

# 雪球配置（需要 Cookie）
XUEQIU_COOKIES = {
    # 从浏览器复制雪球 Cookie，或运行 `xueqiu login --qrcode` 获取
}

# Yahoo Finance 配置
YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
}

# 关注的股票列表
WATCHLIST = {
    "CN": ["SH600519", "SZ000858", "SH601318", "SH600036"],  # A 股
    "US": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],  # 美股
    "HK": ["0700.HK", "9988.HK", "1211.HK", "2318.HK"],  # 港股
}


def get_xueqiu_quote(symbol):
    """获取雪球行情（A 股/港股/美股）"""
    try:
        url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}"
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Cookie': '; '.join([f"{k}={v}" for k, v in XUEQIU_COOKIES.items()]) if XUEQIU_COOKIES else ''
        }
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            quote = data.get('data', {}).get('quote', {})
            return {
                'symbol': symbol,
                'name': quote.get('name', ''),
                'price': float(quote.get('current', 0)),
                'change': float(quote.get('percent', 0)),
                'change_amount': float(quote.get('chg', 0)),
                'volume': float(quote.get('volume', 0)),
                'market_cap': float(quote.get('market_capital', 0)),
                'pe': float(quote.get('pe_ttm', 0)),
                'timestamp': datetime.now().isoformat()
            }
    except Exception as e:
        print(f"雪球获取 {symbol} 失败：{e}")
    return None


def get_yahoo_quote(symbol):
    """获取 Yahoo Finance 行情（美股/港股）"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        params = {
            'interval': '1d',
            'range': '1d'
        }
        resp = requests.get(url, headers=YAHOO_HEADERS, params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            result = data.get('chart', {}).get('result', [{}])[0]
            meta = result.get('meta', {})
            quote = result.get('indicators', {}).get('quote', [{}])[0]
            return {
                'symbol': symbol,
                'name': meta.get('symbol', ''),
                'price': meta.get('regularMarketPrice', 0),
                'change': meta.get('regularMarketChangePercent', 0) * 100,
                'change_amount': meta.get('regularMarketChange', 0),
                'volume': quote.get('volume', [0])[-1] if quote.get('volume') else 0,
                'market_cap': meta.get('marketCap', 0),
                'timestamp': datetime.now().isoformat()
            }
    except Exception as e:
        print(f"Yahoo 获取 {symbol} 失败：{e}")
    return None


def get_sina_quote(symbol):
    """获取新浪财经行情（A 股/港股/美股）"""
    try:
        # 转换股票代码格式
        if symbol.startswith('SH') or symbol.startswith('SZ'):
            code = symbol.lower().replace('sh', 's_sh').replace('sz', 's_sz')
        elif symbol.endswith('.HK'):
            code = 'hk' + symbol.replace('.HK', '')
        else:
            code = 'gb_' + symbol.lower()
        
        url = f"https://hq.sinajs.cn/list={code}"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            content = resp.text
            if '=' in content:
                parts = content.split('=')[1].strip('"').split(',')
                if len(parts) >= 7:
                    name = parts[0]
                    current = float(parts[3]) if parts[3] else 0
                    open_price = float(parts[1]) if parts[1] else 0
                    prev_close = float(parts[2]) if parts[2] else current
                    high = float(parts[4]) if parts[4] else 0
                    low = float(parts[5]) if parts[5] else 0
                    change = ((current - prev_close) / prev_close * 100) if prev_close else 0
                    return {
                        'symbol': symbol,
                        'name': name,
                        'price': current,
                        'change': round(change, 2),
                        'change_amount': round(current - prev_close, 2),
                        'open': open_price,
                        'high': high,
                        'low': low,
                        'prev_close': prev_close,
                        'timestamp': datetime.now().isoformat()
                    }
    except Exception as e:
        print(f"新浪获取 {symbol} 失败：{e}")
    return None


def fetch_all_quotes(symbols):
    """批量获取行情"""
    quotes = {}
    for symbol in symbols:
        quote = None
        # 优先使用新浪（无需 Cookie）
        if symbol.startswith('SH') or symbol.startswith('SZ') or symbol.endswith('.HK'):
            quote = get_sina_quote(symbol)
        else:
            quote = get_yahoo_quote(symbol)
        
        # 备用雪球
        if not quote and XUEQIU_COOKIES:
            quote = get_xueqiu_quote(symbol)
        
        if quote:
            quotes[symbol] = quote
            print(f"✅ {symbol}: ${quote['price']} ({quote['change']:+.2f}%)")
        else:
            print(f"❌ {symbol}: 获取失败")
    
    return quotes


def fetch_portfolio_quotes(positions_file):
    """根据持仓文件获取行情"""
    with open(positions_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 提取持仓股票代码
    symbols = set()
    for pos in data.get('openPositions', {}).get('stocks', []):
        symbols.add(pos['symbol'])
    
    print(f"📊 获取 {len(symbols)} 只股票的实时行情...")
    quotes = fetch_all_quotes(list(symbols))
    
    # 更新持仓数据
    for pos in data.get('openPositions', {}).get('stocks', []):
        symbol = pos['symbol']
        if symbol in quotes:
            quote = quotes[symbol]
            pos['marketPrice'] = quote['price']
            pos['marketValue'] = pos['quantity'] * quote['price']
            pos['realTimeChange'] = quote['change']
            pos['realTimeChangeAmount'] = quote['change_amount']
    
    # 保存更新后的数据
    output_file = positions_file.replace('.json', '_realtime.json')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 行情已更新，保存到：{output_file}")
    return output_file


def main():
    if len(sys.argv) > 1:
        # 从持仓文件获取
        fetch_portfolio_quotes(sys.argv[1])
    else:
        # 获取关注列表
        all_symbols = []
        for market, symbols in WATCHLIST.items():
            all_symbols.extend(symbols)
        
        print(f"📈 获取 {len(all_symbols)} 只股票行情...")
        quotes = fetch_all_quotes(all_symbols)
        
        # 保存到文件
        output = {
            'timestamp': datetime.now().isoformat(),
            'quotes': quotes
        }
        
        output_file = Path(__file__).parent.parent / 'data' / 'realtime_quotes.json'
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ 行情已保存到：{output_file}")


if __name__ == "__main__":
    main()
