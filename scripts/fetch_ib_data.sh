#!/bin/bash

# IB FlexQuery 数据拉取脚本
# 支持自动重试，直到报表生成完成

QUERY_ID="1460982"
TOKEN="168000387267012036122595"
OUTPUT_FILE="/Users/mc/ib_dashboard/data/ib_statement.xml"
MAX_RETRIES=30
RETRY_DELAY=15

IB_URL="https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=${QUERY_ID}&t=${TOKEN}&v=3"

echo "📥 开始拉取 IB FlexQuery 数据..."
echo "   Query ID: ${QUERY_ID}"
echo "   输出文件：${OUTPUT_FILE}"
echo ""

for i in $(seq 1 $MAX_RETRIES); do
    echo "尝试 $i/$MAX_RETRIES..."
    
    # 拉取数据
    RESPONSE=$(curl -s -A "Python/3.11" --max-time 120 "$IB_URL" 2>&1)
    
    # 检查是否包含错误码 1019（生成中）
    if echo "$RESPONSE" | grep -q "ErrorCode>1019"; then
        echo "   ⏳ 报表正在生成，等待 ${RETRY_DELAY} 秒后重试..."
        sleep $RETRY_DELAY
        continue
    fi
    
    # 检查是否成功（包含 FlexQueryResponse 或 FlexStatement）
    if echo "$RESPONSE" | grep -q "FlexStatement"; then
        echo "   ✅ 拉取成功！"
        echo "$RESPONSE" > "$OUTPUT_FILE"
        echo ""
        echo "📄 数据已保存到：$OUTPUT_FILE"
        
        # 显示基本信息
        ACCOUNT_ID=$(echo "$RESPONSE" | grep -o 'accountId="[^"]*"' | head -1 | cut -d'"' -f2)
        FROM_DATE=$(echo "$RESPONSE" | grep -o 'fromDate="[^"]*"' | head -1 | cut -d'"' -f2)
        TO_DATE=$(echo "$RESPONSE" | grep -o 'toDate="[^"]*"' | head -1 | cut -d'"' -f2)
        
        echo "📊 账户：$ACCOUNT_ID"
        echo "📅 期间：$FROM_DATE 至 $TO_DATE"
        exit 0
    fi
    
    # 其他错误
    echo "   ❌ 未知错误:"
    echo "$RESPONSE" | head -5
    exit 1
done

echo "❌ 超过最大重试次数，报表生成超时"
exit 1
