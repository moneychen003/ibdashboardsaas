/**
 * 功能开关配置
 * 
 * 给别人纯净版源码时，只需把 enablePromotion 设为 false，
 * 所有推广组件（弹窗、群聊按钮等）都不会渲染。
 */
export const FEATURES = {
  /** 是否启用推广组件：微信群聊弹窗、加入群聊按钮等 */
  enablePromotion: false,

  /** 弹窗配置 */
  promotion: {
    /** 群聊名称 */
    groupName: '陈前的投资日记粉丝群',
    /** 群聊副标题 */
    groupSubtitle: '微信扫描二维码进群',
    /** 底部说明 */
    footerText: '扫码加入群聊，与志同道合的朋友一起交流',
    /** 二维码图片路径（请放到 web/public/ 目录下） */
    qrCodePath: '/qrcode.png',
    /** 个人微信二维码路径 */
    wechatPersonalPath: '/wechat_personal.png',
    /** Telegram 群链接 */
    telegramUrl: 'https://t.me/+ZPLVLJfV0lBkMzZl',
    /** Discord 邀请链接 */
    discordUrl: 'https://discord.gg/YbyAww7kzm',
    /** 品牌标签 */
    brandLabel: '官方社区',
    /** 弹窗标题 */
    modalTitle: '欢迎加入官方微信群聊',
    /** 免费答疑文字 */
    freeSupportText: '免费答疑解惑',
    /** 自动弹出延迟（毫秒） */
    autoShowDelay: 1500,
    /** 今日不再提示的 localStorage key */
    noDisturbKey: 'modal_no_disturb_date',
  },
};
