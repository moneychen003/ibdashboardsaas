# IB 投资组合仪表盘 - 完整功能实现

## ✅ 已实现的 5 大功能

### 1️⃣ 实时行情接入

**文件:** `scripts/fetch_quotes.py`

**功能:**
- 支持雪球、Yahoo Finance、新浪财经 3 个数据源
- A 股/港股/美股全覆盖
- 自动更新持仓市价和盈亏

**使用方法:**
```bash
# 获取关注列表行情
python scripts/fetch_quotes.py

# 根据持仓文件获取行情
python scripts/fetch_quotes.py data/sample_data.json
```

**数据源对比:**
| 数据源 | 支持市场 | 需要 Cookie | 稳定性 |
|--------|---------|------------|--------|
| 新浪财经 | A 股/港股/美股 | ❌ | ⭐⭐⭐⭐ |
| Yahoo Finance | 美股/港股 | ❌ | ⭐⭐⭐⭐ |
| 雪球 | A 股/港股/美股 | ✅ | ⭐⭐⭐⭐ |

**配置:**
编辑 `scripts/fetch_quotes.py` 添加雪球 Cookie：
```python
XUEQIU_COOKIES = {
    'xq_a_token': 'your_token',
    'xq_id_token': 'your_id_token',
    # ...
}
```

---

### 2️⃣ 成本基础导入

**文件:** `scripts/ib_to_json.py`

**功能:**
- 从 IB FlexQuery XML 自动提取成本价
- 支持 FIFO/摊薄成本计算
- 自动计算未实现盈亏

**IB 配置步骤:**

1. 登录 IB 账户管理 → 报告 → Flex 查询
2. 创建新查询模板，勾选：
   - ✅ Account Information
   - ✅ OpenPositions
   - ✅ RealizedAndUnrealizedPerformanceSummaryInBase
   - ✅ CashReport
3. 生成 XML 并下载
4. 转换为 JSON:
```bash
python scripts/ib_to_json.py data/ib_statement.xml data/sample_data.json
```

**自动拉取:**
在 `scripts/refresh_all.sh` 中配置你的 FlexQuery URL：
```bash
IB_FLEX_URL="https://gdcdyn.interactivebrokers.com/...&q=YOUR_QUERY_ID&t=YOUR_TOKEN&v=3"
```

---

### 3️⃣ K 线图表（技术分析）

**文件:** 
- `scripts/kline_chart.py` - 数据获取
- `app.js` - 前端图表渲染

**功能:**
- 支持 1 天/5 天/1 月/3 月/6 月/1 年/YTD 多种周期
- 蜡烛图显示
- MA5/MA10/MA20/MA60 均线指标
- 点击持仓即可查看

**使用方法:**
```bash
# 获取持仓股票的 K 线数据
python scripts/kline_chart.py data/sample_data.json 3mo

# 获取指定股票
python scripts/kline_chart.py
```

**前端使用:**
1. 在持仓表格中点击 "📈 K 线" 按钮
2. 弹出 K 线图表模态框
3. 切换不同周期查看历史走势

**技术指标:**
- MA5: 5 日均线（蓝色）
- MA10: 10 日均线（黄色）
- MA20: 20 日均线（紫色）
- MA60: 60 日均线（绿色）

---

### 4️⃣ 期权到期提醒（Telegram）

**文件:** `scripts/option_alerts.py`

**功能:**
- 自动监控持仓期权到期日
- 提前 30/14/7/3/1 天发送提醒
- 每日持仓摘要推送
- 实值/虚值状态标识

**Telegram 配置:**
已配置（从 MEMORY.md）：
- Bot: `@cqclawd_bot`
- Chat ID: `5496550509`
- Proxy: `http://127.0.0.1:7899`

**使用方法:**
```bash
# 检查期权到期
python scripts/option_alerts.py data/sample_data.json

# 发送每日摘要
python scripts/option_alerts.py data/sample_data.json --daily

# 发送测试消息
python scripts/option_alerts.py --test
```

**提醒示例:**
```
🚨【紧急提醒】期权到期提醒

以下期权将在 1 天 后到期：

📌 XPEV Put 30
   数量：4 张
   到期：2026-04-17
   现价：$12.84 | 盈亏平衡：$27.16
   状态：○ 虚值

⏰ 更新时间：2026-04-16 09:30
💡 提示：请考虑是否平仓、展期或行权
```

**定时任务:**
```bash
# 每天 9:00 检查
crontab -e
0 9 * * * python /Users/mc/ib_dashboard/scripts/option_alerts.py /Users/mc/ib_dashboard/data/sample_data.json
```

---

### 5️⃣ 多账户支持

**文件:** 
- `data/accounts_config.json` - 账户配置
- `app.js` - 前端账户切换

**功能:**
- 支持多个 IB 账户切换
- 每个账户独立数据文件
- 账户颜色标识
- 快速切换查看

**配置方法:**

编辑 `data/accounts_config.json`:
```json
{
  "accounts": [
    {
      "id": "account1",
      "name": "主账户",
      "accountId": "U12672188",
      "dataFile": "sample_data.json",
      "color": "#6366f1",
      "isDefault": true
    },
    {
      "id": "account2",
      "name": "IRA 账户",
      "accountId": "U12345678",
      "dataFile": "ira_data.json",
      "color": "#10b981",
      "isDefault": false
    }
  ]
}
```

**使用方法:**
1. 点击顶部导航栏的账户名称
2. 下拉菜单选择要查看的账户
3. 页面自动刷新显示该账户数据

---

## 🤖 自动化任务

### 完整刷新脚本

**文件:** `scripts/refresh_all.sh`

**功能:**
1. 从 IB 拉取最新持仓
2. 获取实时行情
3. 获取 K 线数据
4. 检查期权到期
5. 发送每日摘要

**使用方法:**
```bash
./scripts/refresh_all.sh
```

### Cron 定时任务

```bash
# 编辑 crontab
crontab -e

# 每个交易日早上 8:30 刷新
30 8 * * 1-5 /Users/mc/ib_dashboard/scripts/refresh_all.sh >> /tmp/ib_dashboard.log 2>&1

# 每天 9:00 发送期权提醒
0 9 * * * python /Users/mc/ib_dashboard/scripts/option_alerts.py /Users/mc/ib_dashboard/data/sample_data.json

# 每小时获取实时行情
0 * * * 1-5 python /Users/mc/ib_dashboard/scripts/fetch_quotes.py /Users/mc/ib_dashboard/data/sample_data.json
```

---

## 📊 数据流程图

```
IB FlexQuery API
      ↓
  XML 下载
      ↓
ib_to_json.py 转换
      ↓
sample_data.json ←── fetch_quotes.py (实时行情)
      ↓                  ↓
app.js 读取           kline_chart.py
      ↓                  ↓
  前端渲染 ←─────── kline_data.json
      ↓
  用户界面
      ↓
option_alerts.py → Telegram 通知
```

---

## 🎯 功能清单

| 功能 | 状态 | 文件 |
|------|------|------|
| 实时行情 | ✅ | `fetch_quotes.py` |
| 成本导入 | ✅ | `ib_to_json.py` |
| K 线图表 | ✅ | `kline_chart.py` + `app.js` |
| 期权提醒 | ✅ | `option_alerts.py` |
| 多账户 | ✅ | `accounts_config.json` + `app.js` |
| 自动刷新 | ✅ | `refresh_all.sh` |
| Telegram | ✅ | 已集成 |
| Cron 任务 | ✅ | 文档已提供 |

---

## 🚀 快速部署

### 1. 初始化
```bash
cd /Users/mc/ib_dashboard

# 获取 K 线数据
python scripts/kline_chart.py

# 获取实时行情
python scripts/fetch_quotes.py
```

### 2. 配置 IB 数据
```bash
# 编辑 refresh_all.sh，替换 IB_FLEX_URL
nano scripts/refresh_all.sh

# 运行一次完整刷新
./scripts/refresh_all.sh
```

### 3. 设置 Cron
```bash
crontab -e
# 添加定时任务（见上文）
```

### 4. 测试 Telegram
```bash
python scripts/option_alerts.py --test
```

### 5. 启动服务
```bash
# 如果服务已停止，重新启动
pkill -f "http.server 8080"
cd /Users/mc/ib_dashboard
nohup python3 -m http.server 8080 > /tmp/ib_dashboard.log 2>&1 &
```

---

## 📱 访问方式

- **本地:** http://localhost:8080
- **局域网:** http://你的IP:8080
- **移动端:** 完美适配，底部导航栏

---

## 🔧 故障排查

### 行情获取失败
```bash
# 测试新浪财经
curl "https://hq.sinajs.cn/list=gb_xpev"

# 测试 Yahoo
curl "https://query1.finance.yahoo.com/v8/finance/chart/XPEV"
```

### Telegram 发送失败
```bash
# 测试代理
curl -x http://127.0.0.1:7899 https://api.telegram.org

# 测试 Bot
curl -x http://127.0.0.1:7899 "https://api.telegram.org/bot8587848312:AAEPsIMg-MD8mdPhMIpKL3G5ZmuqUj3Tvgs/getMe"
```

### K 线数据为空
```bash
# 手动获取
python scripts/kline_chart.py
cat data/kline_data.json | head
```

---

## 📄 文件清单

```
ib_dashboard/
├── index.html                    # 主页面（多账户 + K 线模态框）
├── app.js                        # 前端逻辑（增强版）
├── start.sh                      # 启动脚本
├── README.md                     # 用户文档
├── IMPLEMENTATION.md             # 本文档
├── data/
│   ├── sample_data.json          # 主账户数据
│   ├── accounts_config.json      # 多账户配置
│   ├── realtime_quotes.json      # 实时行情
│   └── kline_data.json           # K 线数据
└── scripts/
    ├── ib_to_json.py             # IB XML 转 JSON
    ├── fetch_quotes.py           # 实时行情获取
    ├── kline_chart.py            # K 线数据获取
    ├── option_alerts.py          # 期权提醒
    └── refresh_all.sh            # 完整刷新脚本
```

---

**最后更新:** 2026-04-08  
**作者:** mc + Copaw
