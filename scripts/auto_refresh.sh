#!/bin/bash

# IB 仪表盘一键刷新脚本
# 自动完成：拉取 IB 数据 → 导入 SQLite → 生成 JSON → 获取行情 → 获取 K 线

set -e

# 切换到脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "========================================"
echo "🔄 IB 仪表盘数据刷新"
echo "========================================"
echo "📂 工作目录：$PROJECT_DIR"
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ========== 1. 拉取 IB 数据 ==========
echo -e "${BLUE}[1/5]${NC} 📥 拉取 IB FlexQuery 数据..."

# Load credentials from config/.env
set -a
if [ -f "$PROJECT_DIR/config/.env" ]; then
  source "$PROJECT_DIR/config/.env"
fi
set +a

QUERY_ID="${IB_QUERY_ID:-1460982}"
TOKEN="${IB_TOKEN:-168000387267012036122595}"
IB_URL="https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=${QUERY_ID}&t=${TOKEN}&v=3"

# 尝试拉取（最多重试 3 次）
MAX_RETRIES=3
RETRY_DELAY=15
SUCCESS=false
DAILY_XML=""

for i in $(seq 1 $MAX_RETRIES); do
    echo "   尝试 $i/$MAX_RETRIES..."
    
    RESPONSE=$(curl -s -A "Python/3.11" --max-time 120 "$IB_URL" 2>&1)
    
    # 检查是否成功
    if echo "$RESPONSE" | grep -q "FlexQueryResponse"; then
        TIMESTAMP=$(date +%Y%m%d-%H%M%S)
        DAILY_XML="data/ib_daily-${TIMESTAMP}.xml"
        echo "$RESPONSE" > "$DAILY_XML"
        echo -e "   ${GREEN}✅ 拉取成功：$DAILY_XML${NC}"
        SUCCESS=true
        break
    elif echo "$RESPONSE" | grep -q "ErrorCode>1019"; then
        echo -e "   ${YELLOW}⏳ 报表生成中，等待 ${RETRY_DELAY} 秒...${NC}"
        sleep $RETRY_DELAY
    elif echo "$RESPONSE" | grep -q "ErrorCode>1018"; then
        echo -e "   ${YELLOW}⚠️  请求限流，等待 ${RETRY_DELAY} 秒...${NC}"
        sleep $RETRY_DELAY
    else
        echo -e "   ${RED}❌ 未知错误${NC}"
        echo "$RESPONSE" | head -3
        break
    fi
done

if [ "$SUCCESS" = false ]; then
    echo -e "${YELLOW}⚠️ IB 数据拉取失败，跳过导入，使用现有数据库${NC}"
fi

echo ""

# ========== 2. 导入 PostgreSQL ==========
echo -e "${BLUE}[2/5]${NC} 🗄️  导入 PostgreSQL 数据库..."

DEFAULT_USER_ID="${DEFAULT_USER_ID:-5800d4ba-84f1-453b-9238-101462eaf139}"

if [ "$SUCCESS" = true ] && [ -n "$DAILY_XML" ]; then
    if python3 scripts/xml_to_postgres.py "$DEFAULT_USER_ID" "$DAILY_XML"; then
        echo -e "   ${GREEN}✅ 导入成功${NC}"
    else
        echo -e "   ${RED}❌ 导入失败${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  跳过导入${NC}"
fi

echo ""

# ========== 3. 生成 Dashboard JSON ==========
echo -e "${BLUE}[3/5]${NC} 🔄 生成仪表盘 JSON..."

if python3 scripts/generate_dashboards.py; then
    echo -e "   ${GREEN}✅ 生成成功${NC}"
else
    echo -e "   ${RED}❌ 生成失败${NC}"
    exit 1
fi

echo ""

# ========== 4. 获取实时行情 ==========
echo -e "${BLUE}[4/5]${NC} 📈 获取实时行情..."

if python3 scripts/fetch_quotes.py 2>&1 | grep -q "✅"; then
    echo -e "   ${GREEN}✅ 行情更新完成${NC}"
else
    echo -e "   ${YELLOW}⚠️  行情获取部分失败${NC}"
fi

echo ""

# ========== 5. 获取 K 线数据 ==========
echo -e "${BLUE}[5/5]${NC} 📊 获取 K 线数据..."

if python3 scripts/kline_chart.py 2>&1 | grep -q "✅"; then
    echo -e "   ${GREEN}✅ K 线更新完成${NC}"
else
    echo -e "   ${YELLOW}⚠️  K 线获取部分失败${NC}"
fi

# ========== Backup cleanup: keep last 15 ==========
echo "🧹 清理旧备份..."
cd "$BACKUP_DIR"
ls -1dt */ 2>/dev/null | tail -n +16 | xargs -r rm -rf
cd "$PROJECT_DIR"

echo ""
echo "========================================"
echo -e "${GREEN}✅ 刷新完成！${NC}"
echo "========================================"
echo ""

echo "📊 数据摘要:"
DASHBOARD_JSON="data/dashboard_combined.json"
if [ -f "$DASHBOARD_JSON" ]; then
    python3 -c "
import json
with open('$DASHBOARD_JSON') as f:
    data = json.load(f)
    hr = data.get('historyRange', {})
    print(f'   视图：{data[\"accountId\"]}')
    print(f'   数据范围：{hr.get(\"fromDate\", \"-\")} ~ {hr.get(\"toDate\", \"-\")}')
    print(f'   总交易日：{hr.get(\"totalDays\", 0)} 天')
    print(f'   净值：¥{data[\"summary\"][\"totalNav\"]:,.0f}')
    rs = data.get('rangeSummaries', {})
    for k, v in rs.items():
        if v.get('days', 0) > 0:
            print(f'   {k}: {v[\"days\"]}天 收益 ¥{v[\"gain\"]:,.0f} ({v[\"gainPct\"]:.2f}%)')
"
fi

echo ""
echo "🌐 访问：http://localhost:8080"
echo ""
