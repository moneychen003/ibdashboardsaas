# 🚀 IB 投资组合仪表盘 - 快速启动指南

## 5 分钟快速部署

### 1️⃣ 启动服务（30 秒）

```bash
cd /Users/mc/ib_dashboard

# 启动 HTTP 服务器
python3 -m http.server 8080 &

# 或使用启动脚本
./start.sh
```

**访问:** http://localhost:8080

---

### 2️⃣ 获取数据（2 分钟）

```bash
# 获取 K 线数据（必需）
python3 scripts/kline_chart.py

# 获取实时行情（可选）
python3 scripts/fetch_quotes.py data/sample_data.json
```

---

### 3️⃣ 配置 IB 数据（可选）

如果你有 IB FlexQuery:

```bash
# 编辑刷新脚本，替换为你的 API URL
nano scripts/refresh_all.sh

# 运行完整刷新
./scripts/refresh_all.sh
```

**获取 IB FlexQuery URL:**
1. 登录 IB 账户管理
2. 报告 → Flex 查询
3. 选择你的查询模板
4. 点击"创建链接"
5. 复制 URL 到 `refresh_all.sh`

---

### 4️⃣ 配置 Telegram（可选）

Telegram 已预配置，测试：

```bash
python3 scripts/option_alerts.py --test
```

如果失败（代理问题），编辑脚本：
```bash
nano scripts/option_alerts.py
# 修改 TELEGRAM_CONFIG['proxy'] 为你的代理地址
```

---

### 5️⃣ 配置多账户（可选）

编辑账户配置：
```bash
nano data/accounts_config.json
```

添加你的账户：
```json
{
  "accounts": [
    {
      "id": "account1",
      "name": "主账户",
      "accountId": "U12672188",
      "dataFile": "sample_data.json",
      "color": "#6366f1"
    },
    {
      "id": "account2",
      "name": "IRA 账户",
      "accountId": "UXXXXXXXX",
      "dataFile": "ira_data.json",
      "color": "#10b981"
    }
  ]
}
```

---

## ✅ 功能验证

打开浏览器访问 http://localhost:8080，检查：

- [ ] 顶部显示账户净值 ¥2,649,071
- [ ] 4 个统计卡片（股票/期权/现金/盈亏）
- [ ] 净值趋势图表
- [ ] 资产分布（6 个类别）
- [ ] 期权到期提醒（9 个）
- [ ] 持仓表格（22 只股票 + 9 只期权）
- [ ] 点击 "📈 K 线" 按钮弹出图表
- [ ] 筛选功能正常

---

## 🤖 设置自动刷新

### Cron 定时任务

```bash
crontab -e
```

添加以下内容：

```bash
# 每个交易日 8:30 刷新全部数据
30 8 * * 1-5 /Users/mc/ib_dashboard/scripts/refresh_all.sh >> /tmp/ib_dashboard.log 2>&1

# 每天 9:00 发送期权到期提醒
0 9 * * * python3 /Users/mc/ib_dashboard/scripts/option_alerts.py /Users/mc/ib_dashboard/data/sample_data.json

# 每小时更新实时行情（交易时段）
0 9-16 * * 1-5 python3 /Users/mc/ib_dashboard/scripts/fetch_quotes.py /Users/mc/ib_dashboard/data/sample_data.json
```

---

## 📱 移动端访问

### 局域网访问
1. 查看本机 IP:
```bash
ifconfig | grep "inet "
```

2. 在手机浏览器访问:
```
http://你的 IP:8080
```

### 特性
- 完美适配手机屏幕
- 底部导航栏（总览/持仓/业绩/设置）
- 触摸友好的按钮和表格
- 横屏/竖屏自动适配

---

## 🔧 常用命令

### 查看服务状态
```bash
ps aux | grep "http.server"
```

### 重启服务
```bash
pkill -f "http.server 8080"
cd /Users/mc/ib_dashboard
python3 -m http.server 8080 &
```

### 查看日志
```bash
tail -f /tmp/ib_dashboard.log
```

### 测试所有功能
```bash
# K 线数据
python3 scripts/kline_chart.py

# 实时行情
python3 scripts/fetch_quotes.py

# 期权提醒
python3 scripts/option_alerts.py data/sample_data.json

# 完整刷新
./scripts/refresh_all.sh
```

---

## 📊 数据结构说明

### sample_data.json 主要字段

```json
{
  "accountInfo": {
    "accountId": "U12672188",
    "currency": "CNH"
  },
  "netAssetValue": {
    "total": 2649071,      // 总净值
    "cash": 425321,        // 现金
    "equity": 2898105,     // 股票市值
    "options": -249034     // 期权市值
  },
  "openPositions": {
    "stocks": [...],       // 股票持仓
    "options": [...]       // 期权持仓
  },
  "categoryBreakdown": {
    "中概股": {"value": 1503256, "pct": 51.9},
    ...
  },
  "history": {
    "nav30Days": [...]     // 30 天净值历史
  }
}
```

---

## 🎨 自定义主题

编辑 `index.html`，修改 CSS 变量：

```css
:root {
    --primary: #6366f1;      /* 主色调（紫色） */
    --primary-dark: #4f46e5; /* 深色 */
    --secondary: #8b5cf6;    /* 辅助色 */
    --success: #10b981;      /* 盈利颜色（绿色） */
    --danger: #ef4444;       /* 亏损颜色（红色） */
}
```

**推荐配色:**
- 蓝色系：`#3b82f6` → `#2563eb`
- 绿色系：`#10b981` → `#059669`
- 橙色系：`#f59e0b` → `#d97706`

---

## 📞 技术支持

### 故障排查

**问题:** 页面空白
```bash
# 检查服务是否运行
ps aux | grep "http.server"

# 检查端口是否占用
lsof -i :8080

# 查看错误日志
cat /tmp/ib_dashboard.log
```

**问题:** 数据不更新
```bash
# 清除浏览器缓存
# 或强制刷新 Cmd+Shift+R

# 检查数据文件时间戳
ls -la data/*.json
```

**问题:** K 线图表不显示
```bash
# 重新获取 K 线数据
python3 scripts/kline_chart.py

# 检查数据文件
cat data/kline_data.json | python3 -m json.tool | head
```

### 获取帮助

1. 查看文档:
   - README.md - 用户文档
   - IMPLEMENTATION.md - 实现细节
   - FEATURES_TEST.md - 功能测试

2. 查看示例数据:
```bash
cat data/sample_data.json | python3 -m json.tool
```

3. 测试 API:
```bash
# 测试新浪行情
curl "https://hq.sinajs.cn/list=gb_xpev"

# 测试 Yahoo K 线
curl "https://query1.finance.yahoo.com/v8/finance/chart/XPEV?period=3mo&interval=1d"
```

---

## 🎯 下一步

1. **配置 IB 自动拉取** - 替换示例数据为真实账户
2. **设置 Cron 任务** - 自动刷新数据
3. **配置 Telegram** - 接收期权提醒
4. **添加更多账户** - 多账户管理
5. **自定义主题** - 调整配色方案

---

**部署时间:** 约 5 分钟  
**难度:** ⭐⭐☆☆☆（简单）

**祝你使用愉快！** 🎉
