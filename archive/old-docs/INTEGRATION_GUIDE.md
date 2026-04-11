# IB 数据集成指南

## 📊 数据流程

```
IB FlexQuery API
    ↓ (XML)
scripts/ib_to_dashboard.py
    ↓ (JSON)
data/dashboard_data.json
    ↓ (加载)
app.js → 仪表盘页面
```

---

## 🚀 快速开始

### 1️⃣ 从 IB 导出数据

**方式 A：API 自动拉取**（推荐）
```bash
cd /Users/mc/ib_dashboard
./scripts/fetch_ib_data.sh
```

**方式 B：手动下载**
1. 登录 IB 账户管理
2. 报告 → Flex 查询
3. 运行 Query #1460982
4. 下载 XML 文件
5. 保存到 `data/ibkr-YYYYMMDD-HHMMSS.xml`

---

### 2️⃣ 转换为 JSON

```bash
python3 scripts/ib_to_dashboard.py data/ibkr-20260408-113624.xml data/dashboard_data.json
```

**输出示例:**
```
✅ 解析成功
   账户：U12672188
   期间：20250408 至 20260407
   股票持仓：12 只
   ETF 持仓：10 只
   期权事件：29 条

📊 仪表盘摘要:
   总净值：$2,608,168
   股票：$1,897,176
   ETF: $961,027
   期权：$-250,035
   总盈亏：$13,402,295 (4684.42%)
```

---

### 3️⃣ 刷新仪表盘

**方式 A：完整刷新**
```bash
./scripts/refresh_all.sh
```

**方式 B：手动刷新**
```bash
# 1. 拉取 IB 数据
./scripts/fetch_ib_data.sh

# 2. 转换为 JSON
python3 scripts/ib_to_dashboard.py data/ibkr-*.xml data/dashboard_data.json

# 3. 获取行情
python3 scripts/fetch_quotes.py

# 4. 重启服务
pkill -f "python3 -m http.server 8080"
python3 -m http.server 8080
```

---

## 📁 JSON 数据结构

```json
{
  "accountId": "U12672188",
  "asOfDate": "20260407",
  "generatedAt": "20260408;113624",
  
  "summary": {
    "totalNav": 2608167.93,      // 总净值
    "stocks": 1897176.36,        // 股票总值
    "etfs": 961026.72,           // ETF 总值
    "options": -250035.15,       // 期权空头市值
    "cash": 0.0,                 // 现金
    "totalGain": 13402294.85,    // 总盈亏
    "totalGainPct": 4684.42      // 总盈亏%
  },
  
  "performance": {
    "startingValue": 4349080.60,  // 期初净值
    "endingValue": 17751375.46,   // 期末净值
    "mtm": 2635136.08,            // 未实现盈亏
    "realized": 0.0,              // 已实现盈亏
    "dividends": 169864.71,       // 分红收入
    "interest": 7218.97,          // 利息收入
    "commissions": -16687.46,     // 佣金
    "twr": 46.84                  // 时间加权收益率
  },
  
  "openPositions": {
    "stocks": [                   // 股票持仓
      {
        "symbol": "XPEV",
        "description": "XPENG INC - ADR",
        "positionValue": 1026312.0,
        "markPrice": 17.22,
        "assetType": "STOCK"
      }
    ],
    "etfs": [                     // ETF 持仓
      {
        "symbol": "QQQ",
        "description": "INVESCO QQQ TRUST SERIES 1",
        "positionValue": 443325.34,
        "markPrice": 588.59,
        "assetType": "ETF"
      }
    ],
    "options": [                  // 期权持仓
      {
        "symbol": "...",
        "description": "...",
        "positionValue": -xxx,
        "markPrice": xxx,
        "assetType": "OPTION"
      }
    ]
  },
  
  "optionEAE": [                  // 期权行使/到期事件
    {
      "symbol": "AAPL  250620P00225000",
      "underlyingSymbol": "AAPL",
      "strike": 225,
      "expiry": "20250620",
      "putCall": "P",
      "transactionType": "Assignment",
      "quantity": 10,
      "mtmPnl": 21125.4,
      "date": "20250605"
    }
  ],
  
  "cashReport": [                 // 现金报告
    {
      "currency": "CNH",
      "cash": 425322.0
    }
  ]
}
```

---

## 🔧 自动化脚本

### 一键刷新脚本
```bash
#!/bin/bash
# /Users/mc/ib_dashboard/scripts/auto_refresh.sh

set -e

echo "🔄 开始刷新 IB 数据..."

# 1. 拉取 IB 数据
echo "📥 拉取 IB 数据..."
./scripts/fetch_ib_data.sh

# 2. 转换为 JSON
echo "🔄 转换数据..."
LATEST_XML=$(ls -t data/ibkr-*.xml | head -1)
python3 scripts/ib_to_dashboard.py "$LATEST_XML" data/dashboard_data.json

# 3. 获取实时行情
echo "📈 获取行情..."
python3 scripts/fetch_quotes.py

# 4. 获取 K 线数据
echo "📊 获取 K 线..."
python3 scripts/kline_chart.py

# echo "✅ 刷新完成！"
# echo "访问：http://localhost:8080"
```

### Cron 定时任务
```bash
crontab -e

# 每个交易日早上 8:30 刷新
30 8 * * 1-5 /Users/mc/ib_dashboard/scripts/auto_refresh.sh

# 每个交易日晚上 8:30 刷新（盘后）
30 20 * * 1-5 /Users/mc/ib_dashboard/scripts/auto_refresh.sh
```

---

## 🌐 前端集成

### app.js 加载数据
```javascript
// 加载 IB 数据
async function loadIBData() {
    try {
        const response = await fetch('data/dashboard_data.json');
        const ibData = await response.json();
        
        // 更新仪表盘
        updateSummary(ibData.summary);
        updatePositions(ibData.openPositions);
        updatePerformance(ibData.performance);
        updateOptionEAE(ibData.optionEAE);
        
        console.log('✅ IB 数据加载成功');
    } catch (error) {
        console.error('❌ 加载 IB 数据失败:', error);
    }
}

// 页面加载时调用
document.addEventListener('DOMContentLoaded', loadIBData);
```

---

## 📋 数据字段映射

| IB XML 字段 | JSON 字段 | 仪表盘显示 |
|------------|----------|-----------|
| `FlexStatement.accountId` | `accountId` | 账户号码 |
| `FlexStatement.toDate` | `asOfDate` | 数据日期 |
| `OpenPosition.positionValue` | `summary.stocks/etfs` | 持仓市值 |
| `ChangeInNAV.endingValue` | `performance.endingValue` | 期末净值 |
| `ChangeInNAV.twr` | `performance.twr` | 收益率 |
| `ChangeInNAV.dividends` | `performance.dividends` | 分红收入 |
| `OptionEAE` | `optionEAE` | 期权事件 |

---

## ⚠️ 注意事项

### 1. 数据延迟
- IB 数据是 T+1（隔夜更新）
- 当天交易次日才能看到
- 实时行情需要额外 API

### 2. 货币转换
- IB 默认基础货币：CNH（离岸人民币）
- 持仓可能包含多币种（USD/HKD等）
- 转换脚本会自动按 IB 汇率折算

### 3. 期权数据
- 期权空头显示为负值
- 需要额外计算到期天数
- 建议配合 `option_alerts.py` 使用

### 4. 性能优化
- XML 文件可能很大（~10MB）
- 建议定期清理旧文件
- JSON 缓存避免重复解析

---

## 🐛 故障排查

### 问题 1：XML 解析失败
```
❌ 解析失败：not well-formed XML
```
**解决:**
- 检查 XML 文件是否完整下载
- 确认 IB API 请求成功（非 1019 错误）
- 重新拉取数据

### 问题 2：数据为 0
```
📊 总净值：$0
```
**解决:**
- 检查 IB Query 配置（日期范围/数据项）
- 确认账户有持仓数据
- 查看 XML 中是否有 `<OpenPosition>` 节点

### 问题 3：期权数据缺失
**解决:**
- IB Query 需勾选"OptionEAE"数据项
- 检查 XML 中是否有`<OptionEAE>`节点
- 确认过去 365 天有期权交易

---

## 📊 当前配置

| 项目 | 值 |
|------|-----|
| **Query ID** | 1460982 |
| **Token** | 168000387267012036122595 |
| **日期范围** | 最近 365 天（滚动） |
| **账户** | U12672188 |
| **基础货币** | CNH |
| **刷新频率** | 手动 / 定时（Cron） |

---

## 🎯 下一步优化

1. **实时行情集成**
   - 雪球 API（中国股票）
   - Yahoo Finance（美股）
   - 新浪财经（港股）

2. **图表增强**
   - 净值历史趋势图
   - 持仓分布饼图
   - 盈亏时间序列

3. **提醒功能**
   - 期权到期 Telegram 通知
   - 大额波动预警
   - 财报日历

4. **多账户支持**
   - 合并多个 IB 账户
   - 家庭总资产视图
   - 账户间对比

---

**最后更新:** 2026-04-08  
**数据状态:** ✅ 正常（ibkr-20260408-113624.xml）
