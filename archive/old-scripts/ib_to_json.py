#!/usr/bin/env python3
"""
IB FlexQuery XML 转 JSON 工具
将 Interactive Brokers 的 FlexQuery XML 响应转换为前端可用的 JSON 格式
"""

import xml.etree.ElementTree as ET
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

def parse_xml(xml_file):
    """解析 IB FlexQuery XML 文件"""
    tree = ET.parse(xml_file)
    root = tree.getroot()
    
    data = {
        "accountInfo": {},
        "netAssetValue": {},
        "cashReport": [],
        "forexBalances": [],
        "openPositions": {"stocks": [], "options": []},
        "complexPositions": [],
        "priorPeriodPositions": {},
        "performanceSummary": {},
        "dividends": {"totalReceived": 0, "details": []},
        "fees": {},
        "securitiesLent": {},
        "optionExercises": [],
        "pendingExercises": [],
        "categoryBreakdown": {},
        "currencyBreakdown": {},
        "history": {"nav30Days": []}
    }
    
    # 查找 FlexStatement
    statement = root.find(".//FlexStatement")
    if statement is None:
        print("❌ 未找到 FlexStatement")
        return data
    
    # 账户信息
    account_info = statement.find("AccountInformation")
    if account_info is not None:
        data["accountInfo"] = {
            "accountId": account_info.get("accountId", ""),
            "accountName": root.get("queryName", ""),
            "currency": statement.get("period", "")[:3] or "CNH",
            "fromDate": statement.get("fromDate", ""),
            "toDate": statement.get("toDate", ""),
            "whenGenerated": statement.get("whenGenerated", "")
        }
    
    # 处理持仓数据
    positions = statement.find("OpenPositions")
    if positions is not None:
        for pos in positions.findall("OpenPosition"):
            symbol = pos.get("symbol", "")
            asset_class = pos.get("assetClass", "")
            position_type = pos.get("positionType", "")
            
            try:
                quantity = float(pos.get("quantity", 0) or 0)
                cost_basis = float(pos.get("costBasisPrice", 0) or 0)
                market_price = float(pos.get("marketPrice", 0) or 0)
                market_value = float(pos.get("marketValue", 0) or 0)
            except ValueError:
                continue
            
            item = {
                "symbol": symbol,
                "description": pos.get("description", ""),
                "quantity": quantity,
                "costBasis": cost_basis,
                "marketPrice": market_price,
                "marketValue": market_value,
                "unrealizedPL": float(pos.get("unrealizedPL", 0) or 0),
                "unrealizedPLPct": float(pos.get("unrealizedPLPct", 0) or 0),
            }
            
            if asset_class == "OPT":
                # 期权
                item["type"] = pos.get("positionType", "Put")
                item["strike"] = float(pos.get("strike", 0) or 0)
                item["expiry"] = pos.get("expiry", "")
                
                # 计算到期天数
                try:
                    expiry_date = datetime.strptime(item["expiry"], "%Y-%m-%d")
                    item["daysToExpiry"] = (expiry_date - datetime.now()).days
                except:
                    item["daysToExpiry"] = 0
                
                item["breakEven"] = item["strike"] - item["marketPrice"] if item["type"] == "Put" else item["strike"] + item["marketPrice"]
                item["inTheMoney"] = (market_price > item["strike"]) if item["type"] == "Call" else (market_price < item["strike"])
                
                data["openPositions"]["options"].append(item)
            else:
                # 股票/ETF
                item["weight"] = 0  # 后续计算
                data["openPositions"]["stocks"].append(item)
    
    # 计算权重
    total_equity = sum(p["marketValue"] for p in data["openPositions"]["stocks"])
    for pos in data["openPositions"]["stocks"]:
        pos["weight"] = round(pos["marketValue"] / total_equity * 100, 1) if total_equity > 0 else 0
    
    # 分类统计
    categories = {
        "中概股": ["XPEV", "LI", "BABA", "XIACY", "MPNGY", "TCOM"],
        "指数 ETF": ["QQQ", "QQQM", "QQQI", "SPY", "SPYM", "VOO", "JEPI"],
        "科技/半导体": ["MU", "HY9H", "SOXX", "COIN", "MSFT", "NVDA", "AVGO"],
        "现金等价物": ["SGOV"],
    }
    
    category_values = {name: 0 for name in categories}
    category_values["其他"] = 0
    
    for pos in data["openPositions"]["stocks"]:
        matched = False
        for cat, symbols in categories.items():
            if pos["symbol"] in symbols:
                category_values[cat] += pos["marketValue"]
                matched = True
                break
        if not matched:
            category_values["其他"] += pos["marketValue"]
    
    # 添加期权空头
    options_total = sum(p["marketValue"] for p in data["openPositions"]["options"])
    category_values["期权空头"] = options_total
    
    total_value = sum(category_values.values())
    data["categoryBreakdown"] = {
        name: {"value": round(value, 2), "pct": round(value / abs(total_value) * 100, 1) if total_value != 0 else 0}
        for name, value in category_values.items()
    }
    
    # 业绩摘要
    perf_summary = statement.find("RealizedAndUnrealizedPerformanceSummaryInBase")
    if perf_summary is not None:
        data["performanceSummary"] = {
            "realizedPL": float(perf_summary.get("realizedPnL", 0) or 0),
            "unrealizedPL": float(perf_summary.get("unrealizedPnL", 0) or 0),
            "totalPL": float(perf_summary.get("totalPnL", 0) or 0),
            "mtmToday": 0,
            "mtmMonth": 0,
            "mtmYear": 0
        }
        data["performanceSummary"]["totalPLPct"] = round(
            data["performanceSummary"]["totalPL"] / abs(data["performanceSummary"]["totalPL"] - data["performanceSummary"]["unrealizedPL"]) * 100, 2
        ) if data["performanceSummary"]["totalPL"] - data["performanceSummary"]["unrealizedPL"] != 0 else 0
    
    # 现金报告
    cash_report = statement.find("CashReport")
    if cash_report is not None:
        for cash in cash_report.findall("CashBalance"):
            data["cashReport"].append({
                "currency": cash.get("currency", ""),
                "amount": float(cash.get("amount", 0) or 0)
            })
    
    # 分红
    dividends = statement.find("MutualFundDividendDetails")
    if dividends is not None:
        for div in dividends.findall("MutualFundDividendDetail"):
            data["dividends"]["details"].append({
                "symbol": div.get("symbol", ""),
                "amount": float(div.get("amount", 0) or 0),
                "exDate": div.get("exDate", ""),
                "payDate": div.get("payDate", "")
            })
        data["dividends"]["totalReceived"] = sum(d["amount"] for d in data["dividends"]["details"])
    
    # 费用
    data["fees"] = {
        "commissionTotal": 0,
        "borrowFeesTotal": 0,
        "salesTaxTotal": 0,
        "routingCommissions": 0
    }
    
    commission_details = statement.find("CommissionDetails")
    if commission_details is not None:
        for comm in commission_details.findall("CommissionDetail"):
            data["fees"]["commissionTotal"] += float(comm.get("amount", 0) or 0)
    
    # 生成历史净值（模拟）
    base_nav = sum(p["marketValue"] for p in data["openPositions"]["stocks"])
    base_nav += sum(p["marketValue"] for p in data["openPositions"]["options"])
    if data["cashReport"]:
        base_nav += data["cashReport"][0]["amount"]
    
    # 生成 30 天历史数据
    today = datetime.now()
    for i in range(30, -1, -1):
        date = today - timedelta(days=i)
        # 添加一些随机波动
        import random
        random.seed(i)
        fluctuation = 1 + random.uniform(-0.05, 0.05)
        nav = base_nav * fluctuation
        data["history"]["nav30Days"].append({
            "date": date.strftime("%Y-%m-%d"),
            "nav": round(nav, 2)
        })
    
    return data


def main():
    if len(sys.argv) < 2:
        print("用法：python ib_to_json.py <xml_file> [output_json]")
        print("示例：python ib_to_json.xml data/ib_statement.xml data/portfolio.json")
        sys.exit(1)
    
    xml_file = Path(sys.argv[1])
    output_file = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/portfolio.json")
    
    if not xml_file.exists():
        print(f"❌ 文件不存在：{xml_file}")
        sys.exit(1)
    
    print(f"📄 解析 XML: {xml_file}")
    data = parse_xml(xml_file)
    
    # 确保输出目录存在
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    # 写入 JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 转换完成：{output_file}")
    print(f"📊 账户：{data['accountInfo'].get('accountId', 'N/A')}")
    print(f"💰 股票持仓：{len(data['openPositions']['stocks'])} 只")
    print(f"📉 期权持仓：{len(data['openPositions']['options'])} 只")


if __name__ == "__main__":
    main()
