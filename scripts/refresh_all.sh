#!/bin/bash

# IB 仪表盘数据自动刷新脚本
# 功能：
# 1. 从 IB 拉取最新持仓数据
# 2. 获取实时行情
# 3. 获取 K 线数据
# 4. 检查期权到期并发送提醒
# 5. 发送每日摘要

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$DASHBOARD_DIR/data"

echo "🚀 开始刷新 IB 仪表盘数据..."
echo "📂 工作目录：$DASHBOARD_DIR"
echo ""

# 1. 从 IB 拉取数据
QUERY_ID="1460982"
TOKEN="168000387267012036122595"
IB_FLEX_URL="https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=${QUERY_ID}&t=${TOKEN}&v=3"

echo "📥 1. 从 IB 拉取持仓数据..."
curl -s -A "Python/3.11" "$IB_FLEX_URL" > "$DATA_DIR/ib_statement.xml"

if [ -s "$DATA_DIR/ib_statement.xml" ]; then
    echo "   ✅ IB 数据下载成功"
    
    # 转换为 JSON
    python3 "$SCRIPT_DIR/ib_to_json.py" "$DATA_DIR/ib_statement.xml" "$DATA_DIR/sample_data.json"
    echo "   ✅ JSON 转换完成"
else
    echo "   ❌ IB 数据下载失败，使用现有数据"
fi

echo ""

# 2. 获取实时行情
echo "📈 2. 获取实时行情..."
python3 "$SCRIPT_DIR/fetch_quotes.py" "$DATA_DIR/sample_data.json"
echo ""

# 3. 获取 K 线数据
echo "📊 3. 获取 K 线数据..."
python3 "$SCRIPT_DIR/kline_chart.py" "$DATA_DIR/sample_data.json" "3mo"
echo ""

# 4. 检查期权到期
echo "⏰ 4. 检查期权到期..."
python3 "$SCRIPT_DIR/option_alerts.py" "$DATA_DIR/sample_data.json"
echo ""

# 5. 发送每日摘要（可选，仅在交易日发送）
DAY_OF_WEEK=$(date +%u)
if [ $DAY_OF_WEEK -le 5 ]; then  # 周一到周五
    echo "📰 5. 发送每日摘要..."
    python3 "$SCRIPT_DIR/option_alerts.py" "$DATA_DIR/sample_data.json" --daily
else
    echo "📰 5. 跳过每日摘要（周末）"
fi

echo ""
echo "✅ 数据刷新完成！"
echo "🕐 完成时间：$(date '+%Y-%m-%d %H:%M:%S')"
