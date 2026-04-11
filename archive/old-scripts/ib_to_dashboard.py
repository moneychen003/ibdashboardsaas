#!/usr/bin/env python3
"""
IB FlexQuery XML → JSON 转换器
支持多 Statement XML，提取真实历史净值和最新持仓
"""

import xml.etree.ElementTree as ET
import json
import sys
from datetime import datetime, timedelta
from collections import defaultdict


def parse_ib_xml(xml_file):
    """解析 IB XML 文件，支持多 Statement"""
    tree = ET.parse(xml_file)
    root = tree.getroot()
    
    # 获取所有 FlexStatement
    statements = root.findall('.//FlexStatement')
    if not statements:
        print("❌ 未找到 FlexStatement")
        return None
    
    print(f"   发现 {len(statements)} 个 FlexStatement")
    
    # ========== 提取历史净值 ==========
    nav_history = []
    for stmt in statements:
        to_date = stmt.get('toDate')
        change_in_nav = stmt.find('ChangeInNAV')
        if change_in_nav is not None and to_date:
            ending_value = float(change_in_nav.get('endingValue', 0))
            # 转换日期格式 YYYYMMDD -> YYYY-MM-DD
            formatted_date = f"{to_date[:4]}-{to_date[4:6]}-{to_date[6:]}"
            nav_history.append({
                'date': formatted_date,
                'nav': round(ending_value, 2)
            })
    
    # 按日期排序
    nav_history.sort(key=lambda x: x['date'])
    
    # ========== 用最后一个 Statement 作为最新快照 ==========
    latest_stmt = statements[-1]
    
    data = {
        'metadata': {},
        'accountInfo': {},
        'navHistory': nav_history,
        'openPositions': {
            'stocks': [],
            'etfs': [],
            'options': []
        },
        'performance': {},
        'optionEAE': [],
        'cashReport': []
    }
    
    # 元数据
    data['metadata'] = {
        'accountId': latest_stmt.get('accountId'),
        'fromDate': nav_history[0]['date'] if nav_history else latest_stmt.get('fromDate'),
        'toDate': nav_history[-1]['date'] if nav_history else latest_stmt.get('toDate'),
        'period': latest_stmt.get('period'),
        'whenGenerated': latest_stmt.get('whenGenerated'),
        'statementCount': len(statements)
    }
    
    # 业绩数据（最新一天）
    change_in_nav = latest_stmt.find('ChangeInNAV')
    if change_in_nav is not None:
        data['performance'] = {
            'startingValue': float(change_in_nav.get('startingValue', 0)),
            'endingValue': float(change_in_nav.get('endingValue', 0)),
            'mtm': float(change_in_nav.get('mtm', 0)),
            'realized': float(change_in_nav.get('realized', 0)),
            'depositsWithdrawals': float(change_in_nav.get('depositsWithdrawals', 0)),
            'dividends': float(change_in_nav.get('dividends', 0)),
            'interest': float(change_in_nav.get('interest', 0)),
            'commissions': float(change_in_nav.get('commissions', 0)),
            'withholdingTax': float(change_in_nav.get('withholdingTax', 0)),
            'otherFees': float(change_in_nav.get('otherFees', 0)),
            'netFxTrading': float(change_in_nav.get('netFxTrading', 0)),
            'fxTranslation': float(change_in_nav.get('fxTranslation', 0)),
            'twr': float(change_in_nav.get('twr', 0))
        }
    
    # 持仓数据（最新一天）
    for pos in latest_stmt.findall('.//OpenPosition'):
        symbol = pos.get('symbol', '')
        description = pos.get('description', '')
        position_value = float(pos.get('positionValue', 0))
        mark_price = float(pos.get('markPrice', 0))
        
        asset_type = 'STOCK'
        if 'ETF' in description.upper() or symbol in ['QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO', 'SGOV', 'SOXX', 'EWY', 'JEPI', 'BOXX']:
            asset_type = 'ETF'
        elif any(x in symbol for x in ['  ', 'P', 'C']) and len(symbol) > 6:
            asset_type = 'OPTION'
        
        position_data = {
            'symbol': symbol,
            'description': description,
            'positionValue': position_value,
            'markPrice': mark_price,
            'assetType': asset_type
        }
        
        if asset_type == 'ETF':
            data['openPositions']['etfs'].append(position_data)
        elif asset_type == 'OPTION':
            data['openPositions']['options'].append(position_data)
        else:
            data['openPositions']['stocks'].append(position_data)
    
    # 现金报告（最新一天）
    # IB 的 CashReport 可能在 CashReportCurrency 节点下
    for cash in latest_stmt.findall('.//CashReportCurrency'):
        currency = cash.get('currency')
        if currency:
            data['cashReport'].append({
                'currency': currency,
                'cash': float(cash.get('cash', 0))
            })
    
    # 兼容旧格式：直接在 CashReport 下的
    for cash in latest_stmt.findall('.//CashReport'):
        currency = cash.get('currency')
        if currency and currency not in [c['currency'] for c in data['cashReport']]:
            data['cashReport'].append({
                'currency': currency,
                'cash': float(cash.get('cash', 0))
            })
    
    # 期权行使/到期（OptionEAE）—— 从历史所有 Statement 汇总，还是只取最新的？
    # 期权事件是历史发生的，应该从所有 Statement 中去重汇总
    eae_dict = {}
    for stmt in statements:
        for opt in stmt.findall('.//OptionEAE'):
            def safe_float(val, default=0):
                try:
                    return float(val) if val else default
                except (ValueError, TypeError):
                    return default
            
            tx_type = opt.get('transactionType', '')
            symbol = opt.get('symbol', '')
            date = opt.get('date', '')
            
            if not tx_type or not symbol or not date:
                continue
            if tx_type not in ('Assignment', 'Exercise', 'Expiration'):
                continue
            
            key = f"{date}_{symbol}_{tx_type}"
            eae_dict[key] = {
                'symbol': symbol,
                'description': opt.get('description', ''),
                'underlyingSymbol': opt.get('underlyingSymbol', ''),
                'strike': safe_float(opt.get('strike')),
                'expiry': opt.get('expiry', ''),
                'putCall': opt.get('putCall', ''),
                'transactionType': tx_type,
                'quantity': safe_float(opt.get('quantity')),
                'tradePrice': safe_float(opt.get('tradePrice')),
                'markPrice': safe_float(opt.get('markPrice')),
                'mtmPnl': safe_float(opt.get('mtmPnl')),
                'date': date,
                'currency': opt.get('currency', '')
            }
    
    # 按日期排序
    data['optionEAE'] = sorted(eae_dict.values(), key=lambda x: x['date'])
    
    return data


def format_for_dashboard(data):
    """格式化为仪表盘可用的格式"""
    if not data:
        return None
    
    # 计算总值
    total_stocks = sum(p['positionValue'] for p in data['openPositions']['stocks'])
    total_etfs = sum(p['positionValue'] for p in data['openPositions']['etfs'])
    total_options = sum(p['positionValue'] for p in data['openPositions']['options'])
    
    # 现金
    total_cash = sum(c['cash'] for c in data['cashReport']) if data['cashReport'] else 0
    
    # 净值
    total_nav = total_stocks + total_etfs + total_options + total_cash
    
    # 盈亏
    perf = data.get('performance', {})
    total_gain = perf.get('endingValue', 0) - perf.get('startingValue', 0)
    total_gain_pct = perf.get('twr', 0) * 100
    
    # 使用真实的净值历史
    nav_history = data.get('navHistory', [])
    
    dashboard_data = {
        'accountId': data['metadata'].get('accountId'),
        'asOfDate': data['metadata'].get('toDate'),
        'generatedAt': data['metadata'].get('whenGenerated'),
        'historyRange': {
            'fromDate': data['metadata'].get('fromDate'),
            'toDate': data['metadata'].get('toDate'),
            'statementCount': data['metadata'].get('statementCount')
        },
        
        'summary': {
            'totalNav': total_nav,
            'stocks': total_stocks,
            'etfs': total_etfs,
            'options': total_options,
            'cash': total_cash,
            'totalGain': total_gain,
            'totalGainPct': total_gain_pct
        },
        
        'performance': {
            'startingValue': perf.get('startingValue', 0),
            'endingValue': perf.get('endingValue', 0),
            'mtm': perf.get('mtm', 0),
            'realized': perf.get('realized', 0),
            'dividends': perf.get('dividends', 0),
            'interest': perf.get('interest', 0),
            'commissions': perf.get('commissions', 0),
            'twr': perf.get('twr', 0)
        },
        
        'history': {
            'nav30Days': nav_history
        },
        
        'openPositions': {
            'stocks': data['openPositions']['stocks'],
            'etfs': data['openPositions']['etfs'],
            'options': data['openPositions']['options']
        },
        
        'optionEAE': data['optionEAE'],
        
        'cashReport': data['cashReport']
    }
    
    return dashboard_data


def main():
    if len(sys.argv) < 2:
        print("用法：python3 ib_to_dashboard.py <xml_file> [output_json]")
        print("示例：python3 ib_to_dashboard.py data/ib_history.xml data/dashboard_data.json")
        sys.exit(1)
    
    xml_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else 'data/dashboard_data.json'
    
    print(f"📥 读取 XML: {xml_file}")
    data = parse_ib_xml(xml_file)
    
    if not data:
        print("❌ 解析失败")
        sys.exit(1)
    
    print(f"✅ 解析成功")
    print(f"   账户：{data['metadata'].get('accountId')}")
    print(f"   期间：{data['metadata'].get('fromDate')} 至 {data['metadata'].get('toDate')}")
    print(f"   Statement 数：{data['metadata'].get('statementCount')}")
    print(f"   NAV 历史点数：{len(data['navHistory'])}")
    print(f"   股票持仓：{len(data['openPositions']['stocks'])} 只")
    print(f"   ETF 持仓：{len(data['openPositions']['etfs'])} 只")
    print(f"   期权事件：{len(data['optionEAE'])} 条")
    
    dashboard_data = format_for_dashboard(data)
    
    print(f"\n📊 仪表盘摘要:")
    print(f"   总净值：${dashboard_data['summary']['totalNav']:,.0f}")
    print(f"   股票：${dashboard_data['summary']['stocks']:,.0f}")
    print(f"   ETF: ${dashboard_data['summary']['etfs']:,.0f}")
    print(f"   期权：${dashboard_data['summary']['options']:,.0f}")
    print(f"   现金：${dashboard_data['summary']['cash']:,.0f}")
    print(f"   总盈亏：${dashboard_data['summary']['totalGain']:,.0f} ({dashboard_data['summary']['totalGainPct']:.2f}%)")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(dashboard_data, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 已保存：{output_file}")


if __name__ == '__main__':
    main()
