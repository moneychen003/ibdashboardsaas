"""Translate raw upload/import exception messages into user-friendly Chinese guidance.

Used by:
  - scripts/xml_to_postgres.py (run_import 异常)
  - server_*.py (api_upload_xml / api_job_status)

Output format: 多行字符串，前端用 `whitespace-pre-line` 直接渲染。
  原因：xxx
  建议：xxx
  原始消息：xxx  (兜底分支才带)
"""

# 各错误类别 → (原因, 建议)
_FRIENDLY = {
    "EMPTY_FILE": (
        "上传的文件是空的（0 字节）",
        "请检查浏览器下载是否完整，重新从 IBKR 网页下载 Flex Query XML 后再上传",
    ),
    "WRONG_EXTENSION": (
        "文件名必须以 .xml 结尾",
        "如果你下载的是压缩包（.zip / .gz）请先解压；不要把 XML 改名成 .txt 或其他后缀",
    ),
    "NO_FILE": (
        "未选中文件",
        "请重新点击「上传 XML」按钮选择文件",
    ),
    "TOO_LARGE": (
        "文件超过单次上传上限（50 MB）",
        "1）若你导出的是数年的全量历史，建议在 Flex Query 配置里按月/季度切片分多次上传；2）联系站长可临时调整该用户的上限",
    ),
    "FLEX_IN_PROGRESS": (
        "这是 IB 返回的「报表生成中」状态页，不是真正的报表",
        "回到 IBKR 网页等 1–3 分钟，等出现『Click here to download…』链接后再下载，刷新页面重新点 Run/Download",
    ),
    "NO_FLEXSTATEMENT": (
        "XML 里找不到 <FlexStatement> 节点（不是有效的 Activity Statement）",
        "1）确认你下载的是 Activity Flex Query 而不是 Trade Confirmation 或 Cash Report；2）确认 Flex Query 配置里勾选了 NAV / Open Positions / Trades / Cash Report 等核心 sections",
    ),
    "XML_MALFORMED": (
        "XML 文件结构损坏或格式不规范",
        "1）确认文件直接从 IBKR Flex Query 下载，未被 Word / 记事本等编辑器打开过；2）压缩包请先完整解压；3）如果是手机微信传过来的，可能被压缩破坏，请改用电脑下载并直接上传",
    ),
    "DB_PERMISSION": (
        "数据库权限异常（站点配置问题）",
        "这不是你能解决的，请联系站长。错误信息已记录到日志",
    ),
    "DB_DUPLICATE": (
        "数据冲突（可能同一份 XML 已经导入过）",
        "到「设置 → 上传记录」检查是否已存在相同时间段的报表；如需覆盖请联系站长",
    ),
    "DB_CONNECT": (
        "服务器内部短暂不可用（数据库 / Redis 连接异常）",
        "稍等 1 分钟后重试；如果连续多次失败请联系站长",
    ),
    "TIMEOUT": (
        "处理超时（10 分钟未完成）",
        "1）文件可能过大，建议把 Flex Query 拆成更小时间段；2）服务器繁忙时偶发，稍后重试",
    ),
    "RETENTION_OVERFLOW": (
        "保留策略时间溢出（站点配置 bug）",
        "联系站长修复 enforce_history_retention 月数上限",
    ),
}


def _classify(raw_msg: str) -> str:
    """根据 raw exception 文本分类。"""
    if not raw_msg:
        return ""
    m = raw_msg.lower()

    if "no_flexstatement_found" in m:
        return "NO_FLEXSTATEMENT"
    if "empty_file" in m or "file is empty" in m:
        return "EMPTY_FILE"
    if "flex_in_progress" in m:
        return "FLEX_IN_PROGRESS"

    if "request entity too large" in m or "413" in raw_msg or "max_content_length" in m:
        return "TOO_LARGE"

    if "datetimefieldoverflow" in m or "interval out of range" in m:
        return "RETENTION_OVERFLOW"

    if "must be owner" in m or "permission denied for" in m or "role " in m:
        return "DB_PERMISSION"

    if "duplicate key" in m or "unique constraint" in m or "already exists" in m:
        return "DB_DUPLICATE"

    if "could not connect" in m or "connection refused" in m or "connection reset" in m:
        return "DB_CONNECT"

    if (
        "not well-formed" in m
        or "no element found" in m
        or "syntaxerror" in m
        or "mismatched tag" in m
        or "invalid token" in m
        or "unclosed token" in m
        or "xmlsyntaxerror" in m
        or "parseerror" in m
        or "junk after document element" in m
        or "unbound prefix" in m
        or "undefined entity" in m
    ):
        return "XML_MALFORMED"

    if "timeout" in m or "timed out" in m or "exceeded maximum execution time" in m:
        return "TIMEOUT"

    return ""


def translate(raw_msg: str, *, file_size: int = None) -> str:
    """Return multi-line Chinese error string for the user."""
    # 文件级先验（先查具体硬条件，再看异常文本）
    if file_size == 0:
        cat = "EMPTY_FILE"
    else:
        cat = _classify(raw_msg or "")

    if cat in _FRIENDLY:
        cause, action = _FRIENDLY[cat]
        return f"原因：{cause}\n建议：{action}"

    # 兜底
    raw = (raw_msg or "(无)").strip()
    if len(raw) > 300:
        raw = raw[:300] + "…"
    return (
        "原因：处理 XML 时发生未识别错误\n"
        "建议：稍后重试；多次失败请联系站长，附上文件名和这条错误\n"
        f"原始消息：{raw}"
    )


def translate_validation(code: str, **kwargs) -> str:
    """For pre-import validation in Flask routes (no exception caught)."""
    if code in _FRIENDLY:
        cause, action = _FRIENDLY[code]
        return f"原因：{cause}\n建议：{action}"
    return f"原因：未知校验失败（code={code}）\n建议：联系站长"
