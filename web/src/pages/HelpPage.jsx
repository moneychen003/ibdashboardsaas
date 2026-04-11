import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';

function Step({ n, title, children }) {
  return (
    <div className="mb-6 flex gap-4">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
        {n}
      </div>
      <div className="flex-1">
        <div className="mb-1 text-base font-semibold">{title}</div>
        <div className="text-sm leading-6 text-[var(--gray)]">{children}</div>
      </div>
    </div>
  );
}

function Tip({ children }) {
  return (
    <div className="my-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      💡 {children}
    </div>
  );
}

export default function HelpPage() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="mx-auto max-w-[800px]">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">新手教程</h1>
          <button
            onClick={() => navigate('/combined/overview')}
            className="rounded-lg border border-[var(--light-gray)] px-4 py-2 text-sm hover:border-black hover:bg-black hover:text-white"
          >
            ← 返回仪表盘
          </button>
        </div>

        <div className="rounded-xl border border-[var(--light-gray)] bg-white p-6 shadow-sm">
          <Step n={1} title="注册与登录">
            首次访问时，点击页面右上角的「登录」进入账号页面。如果还没有账号，点击「立即注册」，填写邮箱和密码即可完成注册。
            <br />
            登录成功后，系统会自动记住你的身份，7 天内无需重复登录。
          </Step>

          <Step n={2} title="了解 Demo 模式（示例数据）">
            如果你是新用户且尚未导入任何报表，系统会自动进入 <b>Demo 模式</b>。此时页面顶部会出现黄色提示条，展示的是预设的示例账户数据。
            <Tip>
              Demo 模式的目的是让你提前熟悉界面布局。所有图表、持仓、业绩数据都是模拟的，
              <b>导入真实 XML 报表后才会替换为你自己的账户信息</b>。
            </Tip>
          </Step>

          <Step n={3} title="从 IB 后台导出 XML 对账单">
            <Tip>
              <b>重要前提</b>：IB 中文界面下通常看不到 Flex Queries 功能，请先将账户界面语言切换为 <b>English</b>（设置路径：Settings → Display → Language）。
            </Tip>

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 font-semibold">1. 进入 Flex Queries 页面</div>
                <div className="text-sm text-[var(--gray)]">
                  登录 IB 网页端后，按以下路径点击菜单：
                </div>
                <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
                  <span>Performance & Reports</span>
                  <span className="text-blue-400">→</span>
                  <span>Flex Queries</span>
                  <span className="text-blue-400">→</span>
                  <span className="font-semibold">Activity Flex Query</span>
                </div>
              </div>

              <div>
                <div className="mb-2 font-semibold">2. 创建查询模板（首次使用）</div>
                <div className="text-sm text-[var(--gray)]">
                  如果你还没有任何 <b>Activity Flex Query</b> 模板，点击右侧的 <b>＋</b> 按钮新建一个。
                  <br />
                  <span className="font-medium text-amber-700">
                    注意：在 Sections (Select Multiple) 页面中，所有的 Section 都必须勾选；点击任意 Section 展开后，里面的每一项子字段也必须全部勾选（可点击顶部的 Select All 一键全选）。输出格式必须选择 XML。任何一项遗漏都会导致本系统解析缺失或报错。
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-2 font-semibold">3. 配置 General Configuration</div>
                <div className="text-sm text-[var(--gray)] mb-2">
                  在查询模板的 General Configuration 中，按下图设置（可点击右侧下拉框选择）：
                </div>
                <div className="rounded-lg border border-[var(--light-gray)] bg-white p-4 text-sm shadow-sm">
                  <div className="mb-3 border-b border-[var(--lighter-gray)] pb-2 font-semibold">General Configuration</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ConfigRow label="Date Format" value="yyyyMMdd" />
                    <ConfigRow label="Time Format" value="HHmmss" />
                    <ConfigRow label="Date/Time Separator" value="; (semi-colon)" />
                    <ConfigRow label="Profit and Loss" value="Default" />
                    <ConfigRow label="Include Canceled Trades?" value="No" />
                    <ConfigRow label="Include Currency Rates?" value="Yes" />
                    <ConfigRow label="Include Audit Trail Fields?" value="No" />
                    <ConfigRow label="Display Account Alias in Place of Account ID?" value="No" />
                    <ConfigRow label="Breakout by Day?" value="Yes" />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 font-semibold">4. 获取 Query ID 与 Token</div>
                <div className="text-sm text-[var(--gray)]">
                  保存模板后，系统会生成一个 <b>Query ID</b>（通常是一串数字，如 <code>1460982</code>）。
                  <br />
                  然后进入 <b>Flex Web Service</b> 页面，勾选 <b>Flex Web Service Status</b> 启用服务。在页面中间的 <b>Current Token</b> 一栏会显示一长串数字，这就是你的 <b>Token</b>。请务必点击页面下方的 <b>Save</b> 按钮保存，并将这串 Token 复制记录下来，后续填入本系统「设置 → IB 自动同步」中即可实现自动拉取。
                </div>
                <Tip>
                  在 <b>Flex Web Service → Valid for IP Address</b> 中，建议<b>留空</b>不填写任何 IP，然后点击 <b>Save</b>。如果填入了具体 IP，后续自动同步反而容易报权限错误。
                </Tip>
              </div>

              <div>
                <div className="mb-2 font-semibold">5. 下载 XML 文件</div>
                <div className="text-sm text-[var(--gray)]">
                  配置完成后，点击运行查询。IB 会生成 XML 文件，点击下载并保存到本地。
                  <br />
                  建议下载完整的<b>历史区间</b>（从开户日至今），这样本系统的业绩归因、持仓成本、交易排名等高级分析才会准确。
                </div>
                <Tip>
                  <b>跨年查询注意事项</b>：若你的账户是在 2023 年（或更早年份）开通的，<b>不要</b>在单次查询里直接设置「开户日 → 今天」这种跨年度长区间。IB Activity Flex Query 在首次跨年时容易出现返回空数据的情况。
                  <br />
                  正确的做法是<b>按自然年拆分</b>：
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>第一段：开户日（如 2023-03-01）→ 2023-12-31</li>
                    <li>第二段起：每年单独下载（如 2024-01-01 → 2024-12-31、2025-01-01 → 今天）</li>
                  </ul>
                  将所有年份的 XML 一次性上传到本系统，即可得到完整、准确的连续分析结果。
                </Tip>
              </div>
            </div>
          </Step>

          <Step n={4} title="上传到本系统">
            拿到 XML 文件后，回到本系统进行上传。方式有两种：
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <b>📤 上传 XML</b>：适合临时补传 1~3 个文件。点击后会弹出文件选择框，按住 <code>Ctrl / Cmd</code> 可同时选中多个 XML。
              </li>
              <li>
                <b>📁 上传文件夹</b>：适合批量导入历史数据。直接选择存放 XML 的文件夹，系统会自动过滤出所有 <code>.xml</code> 文件并逐个处理。
              </li>
            </ul>
            <Tip>
              建议一次性把历史 XML 都传完，数据越完整，收益率、持仓归因、交易排名等高级分析就越准确。上传完成后页面会自动刷新。
            </Tip>
          </Step>

          <Step n={5} title="切换账户与 Tab 导航">
            导入多个账户后，页面左上角会出现账户下拉框，你可以：
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>选择单个账户（如 U11181997）查看该账户的独立数据。</li>
              <li>选择 <b>Combined（合并视图）</b> 查看所有账户的汇总分析，包含跨账户的持仓去重、业绩合并、现金流归因等。</li>
            </ul>
            <div className="mt-3">
              顶部导航栏提供 5 大核心 Tab：
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded border border-[var(--light-gray)] px-3 py-2 text-sm">
                  <span className="font-semibold">📊 总览</span>
                  <div className="text-xs text-[var(--gray)]">NAV、收益曲线、资产配置、风险雷达、股息追踪</div>
                </div>
                <div className="rounded border border-[var(--light-gray)] px-3 py-2 text-sm">
                  <span className="font-semibold">💼 持仓</span>
                  <div className="text-xs text-[var(--gray)]">当前持仓、期权到期提醒、持仓归因、公司行动影响</div>
                </div>
                <div className="rounded border border-[var(--light-gray)] px-3 py-2 text-sm">
                  <span className="font-semibold">📈 业绩</span>
                  <div className="text-xs text-[var(--gray)]">TWR/MWR、交易热图、交易排名、费用侵蚀、择时归因</div>
                </div>
                <div className="rounded border border-[var(--light-gray)] px-3 py-2 text-sm">
                  <span className="font-semibold">📝 明细</span>
                  <div className="text-xs text-[var(--gray)]">交易流水、股息、公司行动、汇率、Wash Sale 预警</div>
                </div>
                <div className="rounded border border-[var(--light-gray)] px-3 py-2 text-sm">
                  <span className="font-semibold">📋 变动</span>
                  <div className="text-xs text-[var(--gray)]">持仓变动、当日交易、成本基差、卖出分析</div>
                </div>
              </div>
            </div>
          </Step>

          <Step n={6} title="使用系统设置">
            点击右上角「⚙️ 设置」可打开设置面板，常用功能包括：
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--gray)]">
              <li><b>系统状态</b>：查看最新导入时间、数据新鲜度、磁盘空间，并可一键刷新数据缓存。</li>
              <li><b>数据运维</b>：查看导入历史，运行数据质量检查。</li>
              <li><b>备份恢复</b>：手动创建备份或在出错时恢复到之前的备份点。</li>
              <li><b>账户与货币</b>：修改基础货币（默认 USD）、添加自定义汇率覆盖、管理账户别名与颜色。</li>
              <li><b>IB 自动同步</b>：配置 Flex Query 凭据，实现定时自动拉取最新报表（可选）。</li>
              <li><b>系统清理</b>：一键清理过期上传文件、日志与旧备份。</li>
            </ul>
            <Tip>普通用户只能看到与自己相关的设置项；「游客权限」等管理员功能仅对超级管理员可见。</Tip>
          </Step>

          <Step n={7} title="最佳实践与注意事项">
            <ul className="list-disc space-y-1 pl-5 text-[var(--gray)]">
              <li><b>浏览器缓存</b>：如果更新了数据但页面没变化，尝试按 <code>Ctrl + F5</code>（Windows）或 <code>Cmd + Shift + R</code>（Mac）强制刷新。</li>
              <li><b>XML 格式</b>：请确保上传的是 IB 官方「Activity Statement」XML，而非 PDF 或 CSV。</li>
              <li><b>数据延迟</b>：大文件处理可能需要几十秒，上传队列会显示「处理中」，请勿重复上传。</li>
              <li><b>期权识别</b>：持仓页中的期权会以原始代码（如 <code>XPEV  260417C00019500</code>）显示，方便对接外部行情 API。</li>
              <li><b>合并视图去重</b>：Combined 模式下，同一只股票的多个账户持仓会自动按币种折算后合并，避免重复计算。</li>
            </ul>
          </Step>
        </div>

        <div className="mt-6 text-center text-sm text-[var(--gray)]">
          仍有疑问？请联系管理员获取更多帮助。
        </div>
      </div>
    </Layout>
  );
}

function ConfigRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded border border-[var(--lighter-gray)] bg-[var(--lighter-gray)]/40 px-3 py-2">
      <span className="text-xs text-[var(--gray)]">{label}</span>
      <span className="text-xs font-medium text-black">{value}</span>
    </div>
  );
}
