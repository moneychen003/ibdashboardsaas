#!/usr/bin/env python3
"""
K 线图数据获取
获取股票历史 K 线数据用于前端图表展示
"""

import json
import requests
from datetime import datetime, timedelta
from pathlib import Path


def get_yahoo_kline(symbol, period='3mo', interval='1d'):
    """
    从 Yahoo Finance 获取 K 线数据
    
    Args:
        symbol: 股票代码
        period: 时间范围 (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)
        interval: K 线周期 (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)
    
    Returns:
        K 线数据列表
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        'period': period,
        'interval': interval,
        'includePrePost': 'true'
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
    
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            result = data.get('chart', {}).get('result', [{}])[0]
            if not result:
                return []
            
            timestamp = result.get('timestamp', [])
            quote = result.get('indicators', {}).get('quote', [{}])[0]
            adjclose = result.get('indicators', {}).get('adjclose', [{}])[0]
            
            klines = []
            for i in range(len(timestamp)):
                kline = {
                    'timestamp': timestamp[i],
                    'date': datetime.fromtimestamp(timestamp[i]).strftime('%Y-%m-%d'),
                    'open': quote.get('open', [])[i] if quote.get('open') else 0,
                    'high': quote.get('high', [])[i] if quote.get('high') else 0,
                    'low': quote.get('low', [])[i] if quote.get('low') else 0,
                    'close': quote.get('close', [])[i] if quote.get('close') else 0,
                    'volume': quote.get('volume', [])[i] if quote.get('volume') else 0,
                    'adjclose': adjclose.get('adjclose', [])[i] if adjclose.get('adjclose') else 0
                }
                klines.append(kline)
            
            return klines
    except Exception as e:
        print(f"获取 {symbol} K 线失败：{e}")
    
    return []


def get_sina_kline(symbol, scale='60', datalen='1024'):
    """
    从新浪财经获取 K 线数据（A 股/港股/美股）
    
    Args:
        symbol: 股票代码
        scale: K 线周期 (1,5,15,30,60 分钟 / 日 k=60/周 k=wk/月 k=mo)
        datalen: 数据条数
    
    Returns:
        K 线数据列表
    """
    # 转换股票代码格式
    if symbol.startswith('SH') or symbol.startswith('SZ'):
        code = symbol.lower()
    elif symbol.endswith('.HK'):
        code = 'hk' + symbol.replace('.HK', '')
    else:
        code = 'gb_' + symbol.lower()
    
    url = f"https://hq.sinajs.cn/list={code}"
    
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            content = resp.text
            if '=' in content:
                parts = content.split('=')[1].strip('"').split(',')
                if len(parts) >= 32:
                    # 新浪返回的是实时数据，不是历史 K 线
                    # 这里只返回当前数据
                    return [{
                        'date': datetime.now().strftime('%Y-%m-%d'),
                        'open': float(parts[1]) if parts[1] else 0,
                        'high': float(parts[4]) if parts[4] else 0,
                        'low': float(parts[5]) if parts[5] else 0,
                        'close': float(parts[3]) if parts[3] else 0,
                        'volume': float(parts[8]) if parts[8] else 0
                    }]
    except Exception as e:
        print(f"新浪获取 {symbol} 失败：{e}")
    
    return []


def calculate_indicators(klines):
    """
    计算技术指标
    
    Args:
        klines: K 线数据列表
    
    Returns:
        包含技术指标的 K 线数据
    """
    if not klines:
        return []
    
    # MA5, MA10, MA20, MA60
    for i in range(len(klines)):
        # MA5
        if i >= 4:
            klines[i]['ma5'] = sum(k['close'] for k in klines[i-4:i+1]) / 5
        # MA10
        if i >= 9:
            klines[i]['ma10'] = sum(k['close'] for k in klines[i-9:i+1]) / 10
        # MA20
        if i >= 19:
            klines[i]['ma20'] = sum(k['close'] for k in klines[i-19:i+1]) / 20
        # MA60
        if i >= 59:
            klines[i]['ma60'] = sum(k['close'] for k in klines[i-59:i+1]) / 60
        
        # VOL MA5, MA10
        if i >= 4:
            klines[i]['vol_ma5'] = sum(k['volume'] for k in klines[i-4:i+1]) / 5
        if i >= 9:
            klines[i]['vol_ma10'] = sum(k['volume'] for k in klines[i-9:i+1]) / 10
    
    return klines


def fetch_kline_for_portfolio(positions_file, period='3mo'):
    """
    为持仓中的所有股票获取 K 线数据
    
    Args:
        positions_file: 持仓 JSON 文件路径
        period: 时间范围
    
    Returns:
        K 线数据字典
    """
    with open(positions_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 提取持仓股票代码
    symbols = set()
    for pos in data.get('openPositions', {}).get('stocks', []):
        symbols.add(pos['symbol'])
    
    print(f"📈 获取 {len(symbols)} 只股票的 K 线数据...")
    
    klines_data = {
        'timestamp': datetime.now().isoformat(),
        'period': period,
        'symbols': {}
    }
    
    for symbol in symbols:
        print(f"  获取 {symbol}...")
        klines = get_yahoo_kline(symbol, period=period)
        if klines:
            klines = calculate_indicators(klines)
            klines_data['symbols'][symbol] = klines
            print(f"    ✅ {len(klines)} 条 K 线")
        else:
            print(f"    ❌ 获取失败")
    
    # 保存到文件
    output_file = Path(positions_file).parent / 'kline_data.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(klines_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ K 线数据已保存到：{output_file}")
    return output_file


def main():
    import sys
    
    if len(sys.argv) > 1:
        period = sys.argv[2] if len(sys.argv) > 2 else '3mo'
        fetch_kline_for_portfolio(sys.argv[1], period)
    else:
        # 默认获取几个示例股票
        symbols = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'QQQ']
        klines_data = {
            'timestamp': datetime.now().isoformat(),
            'period': '3mo',
            'symbols': {}
        }
        
        for symbol in symbols:
            print(f"获取 {symbol} K 线...")
            klines = get_yahoo_kline(symbol, period='3mo')
            if klines:
                klines = calculate_indicators(klines)
                klines_data['symbols'][symbol] = klines
        
        output_file = Path(__file__).parent.parent / 'data' / 'kline_data.json'
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(klines_data, f, ensure_ascii=False, indent=2)
        
        print(f"✅ K 线数据已保存到：{output_file}")


if __name__ == "__main__":
    main()
