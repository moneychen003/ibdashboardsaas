# IB FlexQuery 配置说明

## ✅ 已配置的账户信息

| 项目 | 值 |
|------|-----|
| **Query ID** | 1460982 |
| **Token** | 168000387267012036122595 |
| **API URL** | https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement |

---

## 📥 数据拉取状态

### 当前状态：⏳ 等待报表生成

IB FlexQuery 首次请求或数据量大时需要较长时间生成报表。

**后台脚本:** `scripts/fetch_ib_data.sh`
- 最多重试 30 次
- 每次间隔 15 秒
- 总计最多等待 7.5 分钟

**查看进度:**
```bash
tail -f /tmp/ib_fetch.log
```

**输出文件:**
```
/Users/mc/ib_dashboard/data/ib_statement.xml
```

---

## 🔧 手动拉取

### 方式 1：使用脚本（推荐）
```bash
cd /Users/mc/ib_dashboard
./scripts/fetch_ib_data.sh
```

### 方式 2：直接 curl
```bash
curl -s -A "Python/3.11" \
  "https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=1460982&t=168000387267012036122595&v=3" \
  > data/ib_statement.xml
```

### 方式 3：转换为 JSON
```bash
# 等 XML 生成完成后
python3 scripts/ib_to_json.py data/ib_statement.xml data/sample_data.json
```

---

## ⚠️ 常见问题

### 错误 1019: Statement generation in progress
**原因:** IB 正在生成报表，需要等待

**解决:**
- 等待 1-5 分钟后重试
- 使用自动重试脚本 `fetch_ib_data.sh`

### 错误 1018: Invalid Token
**原因:** Token 无效或过期

**解决:**
1. 登录 IB 账户管理
2. 报告 → Flex 查询
3. 重新生成 Token
4. 更新 `scripts/fetch_ib_data.sh` 中的 TOKEN

### 错误 1017: Invalid Query ID
**原因:** Query ID 不存在

**解决:**
1. 登录 IB 账户管理
2. 报告 → Flex 查询
3. 确认查询模板已创建
4. 复制正确的 Query ID

### 连接超时
**原因:** 网络问题或 IB 服务器繁忙

**解决:**
- 检查网络连接
- 等待几分钟后重试
- 增加 curl 超时时间

---

## 📊 IB FlexQuery 配置检查清单

登录 IB 账户管理 → 报告 → Flex 查询，确认：

- [ ] 查询模板已创建
- [ ] 已勾选需要的数据项：
  - [ ] Account Information
  - [ ] OpenPositions
  - [ ] NetAssetValue (NAV) in Base
  - [ ] RealizedAndUnrealizedPerformanceSummaryInBase
  - [ ] CashReport
  - [ ] OptionExercises, Assignments and Expirations
  - [ ] MutualFundDividendDetails
  - [ ] CommissionDetails
- [ ] 已启用 Web Service 访问
- [ ] Token 已生成且在有效期内
- [ ] Query ID 正确复制

---

## 🤖 自动化配置

### Cron 定时任务
```bash
crontab -e

# 每个交易日早上 8:00 拉取数据
0 8 * * 1-5 /Users/mc/ib_dashboard/scripts/fetch_ib_data.sh && \
  python3 /Users/mc/ib_dashboard/scripts/ib_to_json.py \
  /Users/mc/ib_dashboard/data/ib_statement.xml \
  /Users/mc/ib_dashboard/data/sample_data.json
```

### 完整刷新流程
```bash
./scripts/refresh_all.sh
```

这个脚本会：
1. 从 IB 拉取最新数据
2. 转换为 JSON 格式
3. 获取实时行情
4. 获取 K 线数据
5. 检查期权到期

---

## 📝 测试命令

### 测试连接
```bash
curl -s -A "Python/3.11" \
  "https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=1460982&t=168000387267012036122595&v=3" \
  | head -5
```

**成功响应:**
```xml
<FlexQueryResponse queryName="..." type="AF">
<FlexStatements count="1">
```

**生成中:**
```xml
<FlexStatementResponse timestamp='...'>
<Status>Warn</Status>
<ErrorCode>1019</ErrorCode>
<ErrorMessage>Statement generation in progress...</ErrorMessage>
```

---

## 🔐 安全提示

- ⚠️ **不要公开分享 Token**
- ⚠️ Token 有访问账户全部数据的权限
- ⚠️ 定期更换 Token
- ✅ 使用只读权限的 Token
- ✅ 限制 IP 访问（如果可能）

---

**最后更新:** 2026-04-08  
**配置状态:** ⏳ 等待报表生成
