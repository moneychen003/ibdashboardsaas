import { useEffect, useState } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import { useT } from '../lib/i18n';

const STORAGE_KEY = 'onboarded_v1';

export default function OnboardingModal() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {}
  }, []);

  function close() {
    setOpen(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
  }

  if (!open) return null;

  const STEPS = [
    {
      title: t('欢迎使用 IB Dashboard'),
      icon: '👋',
      body: t('一个把 IB 持仓 + 收益 + 期权策略可视化的工具。我用 5 步带你了解。'),
    },
    {
      title: t('1️⃣ 上传 IB Flex Query XML'),
      icon: '📤',
      body: t('点右上角「上传」，导入 IB Activity Flex Query 生成的 XML。详细配置看「帮助」页。'),
    },
    {
      title: t('2️⃣ 浏览 8 个 Tab'),
      icon: '📊',
      body: t('总览（NAV/收益）/ 持仓 / 业绩 / 明细 / 变动 / 税务 / 战绩 / 组合 — 各自不同维度的数据。'),
    },
    {
      title: t('3️⃣ 创建自定义组合'),
      icon: '⭐',
      body: t('在「组合」tab 用「⚡ 规则整理」一键创建定投/现金/期权/个股 4 类组合，或「🤖 AI 整理」让 Kimi 推荐方案。'),
    },
    {
      title: t('4️⃣ 绑定 Telegram 接收通知'),
      icon: '🔔',
      body: t('在「设置 → Telegram 机器人」绑定 @ibdashboard_bot，每日 22:00 接收 NAV 播报，每 15 分钟接收新成交推送。'),
    },
    {
      title: t('5️⃣ 看 Wheel 追踪和 AI 整理'),
      icon: '🎡',
      body: t('如果你跑 wheel 策略，组合 tab 底部会显示每个 underlying 的累计 P&L + 接股次数 + 年化。「AI 整理」按钮接 Kimi 推荐分类方案。准备好了！'),
    },
  ];

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 print:hidden" onClick={close}>
      <div className="bg-white rounded-3xl p-8 w-[520px] max-w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2">
          <div className="text-5xl">{cur.icon}</div>
          <button onClick={close} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <h2 className="text-xl font-medium mb-3">{cur.title}</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">{cur.body}</p>
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i === step ? 'bg-violet-600' : i < step ? 'bg-violet-300' : 'bg-gray-200'}`} />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="px-3 py-1.5 text-sm text-gray-500 disabled:opacity-30 hover:text-gray-700"
          >
            <ArrowLeft size={14} className="inline mr-1" />{t('上一步')}
          </button>
          <button
            onClick={close}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            {t('跳过')}
          </button>
          <button
            onClick={() => isLast ? close() : setStep((s) => s + 1)}
            className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700"
          >
            {isLast ? t('开始使用') : <>{t('下一步')} <ArrowRight size={14} className="inline ml-1" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
