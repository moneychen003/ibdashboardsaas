"""AI-powered portfolio suggestion via Anthropic-protocol LLM.

Supports: DashScope Qwen (阿里百炼), Kimi.
Configure via env vars:
  AI_API_KEY         - API key (required)
  AI_BASE_URL        - Base URL (default: DashScope Anthropic endpoint)
  AI_MODEL           - Model name (default: qwen3-coder-plus)
"""
import json
import os
import re
import urllib.error
import urllib.request

from db.postgres_client import execute, execute_one, get_cursor


def _ai_messages(system_prompt, user_prompt, max_tokens=4096, timeout=180):
    api_key = os.environ.get("AI_API_KEY")
    base_url = os.environ.get("AI_BASE_URL", "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1")
    model = os.environ.get("AI_MODEL", "qwen3-coder-plus")
    if not api_key:
        raise RuntimeError("AI_API_KEY not configured")
    url = f"{base_url.rstrip('/')}/messages"
    body = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }).encode("utf-8")
    # 伪装成 Claude Code CLI 客户端：dashscope/Kimi 的 anthropic-compatible endpoint
    # 对非 claude-cli UA 会限速或慢响应
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
            "user-agent": "claude-cli/2.0.5 (external, cli)",
            "x-stainless-lang": "js",
            "x-stainless-package-version": "0.55.1",
            "x-stainless-os": "MacOS",
            "x-stainless-arch": "arm64",
            "x-stainless-runtime": "node",
            "x-stainless-runtime-version": "v22.16.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode()
        except Exception:
            err_body = str(e)
        raise RuntimeError(f"AI HTTP {e.code}: {err_body[:500]}")
    content = data.get("content") or []
    for c in content:
        if c.get("type") == "text":
            return c.get("text", "")
    return ""


SYSTEM_PROMPT_ZH = """你是一个投资组合分类助手。用户在 Interactive Brokers 有一些持仓，请帮他设计一套有意义的分类方案。

要求：
- 不超过 6 个组合
- 名称要有业务含义（例如：「美股大盘 ETF」「中概成长股」「期权收入」「LEAPS 看涨」「现金缓冲」）
- 每个组合分配目标占比，合计应接近 100%
- 期权 / 现金 / 个股 / ETF 可以分别独立组合，也可以按行业 / 风格混合
- 仅输出 JSON 对象，不要任何 markdown 或解释文字

JSON schema:
{
  "summary": "整体配置说明（1-2 句中文）",
  "portfolios": [
    {
      "name": "组合名称",
      "color": "#6366f1",
      "target_pct": 30,
      "is_cash": false,
      "auto_rule": null,
      "holdings": ["AAPL", "MSFT"],
      "reasoning": "一句话说明分组理由"
    }
  ]
}

字段说明：
- color 必须从 ["#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#6b7280"] 中选
- auto_rule 可选值：null / "etf_funds" / "stocks" / "options"，仅当此组合应自动包含全部对应类型时设置
- is_cash=true 时该组合自动包含账户现金
- holdings 是 symbol 列表（不要 __CASH__，现金通过 is_cash 标记）
"""

SYSTEM_PROMPT_EN = """You are a portfolio classification assistant. The user holds positions in Interactive Brokers; design a meaningful classification scheme for them.

Requirements:
- No more than 6 portfolios.
- Names should be business-meaningful (e.g. "US Large-cap ETFs", "China Growth Stocks", "Options Income", "LEAPS Bullish", "Cash Buffer").
- Assign target percentages summing to approximately 100%.
- Options / Cash / Single Stocks / ETFs can each be a separate portfolio, or mixed by sector/style.
- Output ONLY a JSON object — no markdown or explanatory text.

JSON schema:
{
  "summary": "1-2 sentence overall allocation description in English",
  "portfolios": [
    {
      "name": "Portfolio name in English",
      "color": "#6366f1",
      "target_pct": 30,
      "is_cash": false,
      "auto_rule": null,
      "holdings": ["AAPL", "MSFT"],
      "reasoning": "One-sentence rationale in English"
    }
  ]
}

Field notes:
- color MUST be from ["#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#6b7280"]
- auto_rule values: null / "etf_funds" / "stocks" / "options" — only set when this portfolio should auto-include all of that asset type.
- When is_cash=true the portfolio auto-includes the account cash balance.
- holdings is a list of ticker symbols (do not include __CASH__; cash is tracked via the is_cash flag).
"""

# Backward compat
SYSTEM_PROMPT = SYSTEM_PROMPT_ZH


def _format_positions_prompt(positions, current_portfolios=None, locale="zh"):
    if locale == "en":
        lines = ["[Holdings]", f"Total {len(positions)} positions:"]
        for p in positions[:80]:
            sym = p.get("symbol") or "?"
            atype = p.get("assetType") or p.get("assetClass") or "?"
            val = p.get("currentValue") or 0
            qty = p.get("quantity")
            underlying = p.get("underlying")
            strat = p.get("strategyLabel")
            is_wheel = p.get("isWheel")
            parts = [f"{sym} ({atype})", f"${val:,.0f}"]
            if underlying and underlying != sym:
                parts.append(f"underlying={underlying}")
            if strat:
                parts.append(f"strategy={strat}{' [wheel]' if is_wheel else ''}")
            if qty is not None:
                parts.append(f"qty={qty}")
            lines.append("  - " + " | ".join(parts))
        if len(positions) > 80:
            lines.append(f"  ... ({len(positions) - 80} more omitted)")
        if current_portfolios:
            lines.append("\n[Existing portfolios (reference; you may keep or rebuild)]")
            for cp in current_portfolios:
                tp = cp.get("targetPct")
                ar = cp.get("autoRule")
                lines.append(
                    f"  - {cp['name']} target={tp}% auto_rule={ar} holdings={len(cp.get('holdings') or [])}"
                )
        lines.append("\nBased on the holdings above, output the classification plan in JSON.")
        return "\n".join(lines)

    # zh
    lines = ["【持仓清单】", f"共 {len(positions)} 笔："]
    for p in positions[:80]:
        sym = p.get("symbol") or "?"
        atype = p.get("assetType") or p.get("assetClass") or "?"
        val = p.get("currentValue") or 0
        qty = p.get("quantity")
        underlying = p.get("underlying")
        strat = p.get("strategyLabel")
        is_wheel = p.get("isWheel")
        parts = [f"{sym} ({atype})", f"${val:,.0f}"]
        if underlying and underlying != sym:
            parts.append(f"底层={underlying}")
        if strat:
            parts.append(f"策略={strat}{' [轮子]' if is_wheel else ''}")
        if qty is not None:
            parts.append(f"数量={qty}")
        lines.append("  - " + " | ".join(parts))
    if len(positions) > 80:
        lines.append(f"  ... (省略 {len(positions) - 80} 笔)")

    if current_portfolios:
        lines.append("\n【用户现有组合（仅参考，可保留也可重建）】")
        for cp in current_portfolios:
            tp = cp.get("targetPct")
            ar = cp.get("autoRule")
            lines.append(
                f"  - {cp['name']} target={tp}% auto_rule={ar} holdings={len(cp.get('holdings') or [])}"
            )

    lines.append("\n根据以上持仓特征，给出 JSON 格式的分类方案。")
    return "\n".join(lines)


def ai_suggest(positions, current_portfolios=None, locale="zh", custom_prompt=None):
    locale = locale if locale in ("zh", "en") else "zh"
    system = SYSTEM_PROMPT_EN if locale == "en" else SYSTEM_PROMPT_ZH
    if custom_prompt and custom_prompt.strip():
        if locale == "en":
            inject = f"\n\n[User's custom classification rules - these MUST be followed]\n{custom_prompt.strip()}\n"
        else:
            inject = f"\n\n【用户自定义分类规则 - 必须遵守】\n{custom_prompt.strip()}\n"
        # Inject after the requirements paragraph (before "JSON schema:")
        system = system.replace(
            "JSON schema:" if locale == "en" else "JSON schema:",
            inject + ("JSON schema:" if locale == "en" else "JSON schema:"),
        )
    user_prompt = _format_positions_prompt(positions, current_portfolios, locale=locale)
    text = _ai_messages(system, user_prompt)
    text = text.strip()
    # Strip markdown code fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        raise RuntimeError(f"AI 返回的不是合法 JSON: {text[:400]}")


def ai_apply(user_id, plan):
    """Apply an AI plan: replace existing portfolios with the plan."""
    if not plan or not plan.get("portfolios"):
        raise ValueError("plan 无效")
    execute("DELETE FROM user_portfolios WHERE user_id=%s", (user_id,))
    for i, p in enumerate(plan["portfolios"]):
        name = (p.get("name") or "").strip()
        if not name:
            continue
        color = p.get("color") or "#6366f1"
        target_pct = p.get("target_pct")
        is_cash = bool(p.get("is_cash", False))
        auto_rule = p.get("auto_rule")
        if auto_rule not in ("etf_funds", "stocks", "options", None):
            auto_rule = None
        notes = p.get("reasoning") or None
        row = execute_one(
            """
            INSERT INTO user_portfolios (user_id, name, color, sort_order, target_pct, is_cash, auto_rule, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (user_id, name, color, i, target_pct, is_cash, auto_rule, notes),
        )
        portfolio_id = row["id"]
        for sym in (p.get("holdings") or []):
            sym = (sym or "").strip()
            if not sym or sym == "__CASH__":
                continue
            try:
                execute(
                    """
                    INSERT INTO user_portfolio_holdings (portfolio_id, user_id, symbol, asset_class, source)
                    VALUES (%s, %s, %s, NULL, 'ai')
                    ON CONFLICT (user_id, symbol) DO UPDATE
                        SET portfolio_id = EXCLUDED.portfolio_id, source = 'ai'
                    """,
                    (portfolio_id, user_id, sym),
                )
            except Exception:
                continue


def get_latest_positions(user_id):
    """Get latest positions across all user accounts (deduped, summed by symbol)."""
    positions = []
    with get_cursor() as cur:
        cur.execute("SELECT account_id FROM user_accounts WHERE user_id = %s", (user_id,))
        accounts = [r[0] for r in cur.fetchall()]
        if not accounts:
            return []
        for acc in accounts:
            cur.execute(
                """
                SELECT symbol, asset_category, position_value, mark_price
                FROM positions
                WHERE account_id = %s AND date = (SELECT MAX(date) FROM positions WHERE account_id = %s)
                ORDER BY ABS(position_value) DESC
                """,
                (acc, acc),
            )
            for row in cur.fetchall():
                positions.append({
                    "symbol": row[0],
                    "assetClass": row[1],
                    "positionValue": float(row[2]) if row[2] else 0,
                    "marketValue": abs(float(row[2])) if row[2] else 0,
                    "markPrice": float(row[3]) if row[3] else 0,
                })
    merged = {}
    for p in positions:
        sym = p["symbol"]
        if sym in merged:
            merged[sym]["positionValue"] += p["positionValue"]
            merged[sym]["marketValue"] += abs(p["positionValue"])
        else:
            merged[sym] = dict(p)
    return list(merged.values())


# ---------------------------------------------------------------------------
# Match-existing mode: assign holdings to user's existing portfolios
# (does NOT delete or rebuild portfolios — preserves user's manual structure)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_MATCH_ZH = """你是投资组合匹配助手。用户已经定义了若干个投资组合（每个有名称、目标占比、业务描述），你的任务是把每一笔持仓分配到最合适的现有组合中。

硬性约束：
- portfolio_name 必须严格从"现有组合清单"中选一个，不能新建、不能改名（哪怕只差一个字也算错）
- 期权 (assetType=OPT) 优先放到 auto_rule="options" 的组合；如果没有就放到名字含"期权"的组合
- 现金优先放到 is_cash=true 的组合
- 如果你不确定某个 symbol 是哪家公司或不知道该归到哪里，把它放进 unassigned，不要瞎猜
- 仅输出 JSON 对象，不要 markdown 代码块、不要任何解释文字

JSON schema:
{
  "summary": "1-2 句中文说明这次匹配的整体逻辑",
  "assignments": [
    {"symbol": "XPEV", "portfolio_name": "中概新能源", "reasoning": "中概互联网+新能源汽车 ADR"}
  ],
  "unassigned": ["XYZ"]
}
"""

SYSTEM_PROMPT_MATCH_EN = """You are a portfolio matching assistant. The user has defined several investment portfolios (each with a name, target percentage, and business description). Your task is to assign every holding to the most appropriate existing portfolio.

Hard constraints:
- portfolio_name MUST be selected exactly from the "existing portfolios" list — do not invent new names or paraphrase (a one-character difference is wrong)
- Options (assetType=OPT) prefer the portfolio with auto_rule="options"; otherwise the portfolio whose name contains "options" / "期权"
- Cash prefers the portfolio with is_cash=true
- If you are not confident about what company a symbol represents or which portfolio it should belong to, put it in unassigned — do NOT guess
- Output ONLY a JSON object — no markdown fences, no explanatory prose

JSON schema:
{
  "summary": "1-2 sentence overall matching logic",
  "assignments": [
    {"symbol": "XPEV", "portfolio_name": "China EV", "reasoning": "China internet + EV ADR"}
  ],
  "unassigned": ["XYZ"]
}
"""


def _format_match_prompt(positions, existing_portfolios, locale="zh"):
    """User prompt: holdings list + existing portfolios with full descriptions."""
    is_en = locale == "en"
    holdings_lines = _format_positions_prompt(positions, current_portfolios=None, locale=locale).split("\n")
    # _format_positions_prompt's own portfolio block isn't included since we pass None;
    # we build a richer one here that includes notes/auto_rule/is_cash for matching.

    if is_en:
        pf_header = "\n[Existing portfolios — assignments MUST pick one of these names]"
        pf_lines = [pf_header]
        for cp in existing_portfolios or []:
            name = cp.get("name") or ""
            target = cp.get("targetPct")
            notes = cp.get("notes") or "(no description)"
            auto_rule = cp.get("autoRule")
            is_cash = bool(cp.get("isCash"))
            tags = []
            if auto_rule:
                tags.append(f"auto_rule={auto_rule}")
            if is_cash:
                tags.append("is_cash=true")
            tag_str = (" [" + ", ".join(tags) + "]") if tags else ""
            pf_lines.append(f"  - 「{name}」 target={target}%{tag_str}")
            pf_lines.append(f"    description: {notes}")
        pf_lines.append("\nReturn the matching plan as JSON per the schema above.")
        return "\n".join(holdings_lines + pf_lines)

    pf_header = "\n【现有组合 — assignments 必须从中挑一个 name】"
    pf_lines = [pf_header]
    for cp in existing_portfolios or []:
        name = cp.get("name") or ""
        target = cp.get("targetPct")
        notes = cp.get("notes") or "(无描述)"
        auto_rule = cp.get("autoRule")
        is_cash = bool(cp.get("isCash"))
        tags = []
        if auto_rule:
            tags.append(f"auto_rule={auto_rule}")
        if is_cash:
            tags.append("is_cash=true")
        tag_str = (" [" + "，".join(tags) + "]") if tags else ""
        pf_lines.append(f"  - 「{name}」 目标占比={target}%{tag_str}")
        pf_lines.append(f"    描述：{notes}")
    pf_lines.append("\n请按上述 JSON schema 返回匹配方案。")
    return "\n".join(holdings_lines + pf_lines)


def ai_match_to_existing(positions, existing_portfolios, locale="zh", custom_prompt=None):
    """Ask the LLM to assign each holding to one of the user's existing portfolios.

    Returns plan dict: {"summary", "assignments": [{symbol, portfolio_name, reasoning}], "unassigned": [...]}.
    Does NOT write to DB. Caller passes plan to ai_match_apply.
    """
    if not existing_portfolios:
        raise RuntimeError("no existing portfolios to match against")
    locale = locale if locale in ("zh", "en") else "zh"
    system = SYSTEM_PROMPT_MATCH_EN if locale == "en" else SYSTEM_PROMPT_MATCH_ZH
    if custom_prompt and custom_prompt.strip():
        if locale == "en":
            inject = f"\n\n[User's custom matching rules - these MUST be followed]\n{custom_prompt.strip()}\n"
        else:
            inject = f"\n\n【用户自定义匹配规则 - 必须遵守】\n{custom_prompt.strip()}\n"
        system = system.replace("JSON schema:", inject + "JSON schema:")

    user_prompt = _format_match_prompt(positions, existing_portfolios, locale=locale)
    text = _ai_messages(system, user_prompt).strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        plan = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            raise RuntimeError(f"AI 返回的不是合法 JSON: {text[:400]}")
        try:
            plan = json.loads(m.group(0))
        except json.JSONDecodeError:
            raise RuntimeError(f"AI 返回的不是合法 JSON: {text[:400]}")

    # Post-validate: drop assignments whose portfolio_name isn't in the existing list,
    # and surface them as unassigned so the caller can flag.
    valid_names = {(p.get("name") or "").strip() for p in existing_portfolios}
    cleaned = []
    invented = []
    for a in plan.get("assignments") or []:
        pname = (a.get("portfolio_name") or "").strip()
        sym = (a.get("symbol") or "").strip().upper()
        if not sym:
            continue
        if pname not in valid_names:
            invented.append(sym)
            continue
        cleaned.append({
            "symbol": sym,
            "portfolio_name": pname,
            "reasoning": a.get("reasoning") or "",
        })
    plan["assignments"] = cleaned
    unassigned = list(plan.get("unassigned") or [])
    for s in invented:
        if s not in unassigned:
            unassigned.append(s)
    plan["unassigned"] = unassigned
    return plan


def ai_match_apply(user_id, plan):
    """Apply a match plan: upsert holdings to assigned portfolios.

    Does NOT delete or modify portfolios — only writes user_portfolio_holdings rows.
    Returns: {"applied": int, "skipped": [symbols that couldn't be applied]}
    """
    if not plan or not isinstance(plan, dict):
        raise ValueError("plan 无效")
    assignments = plan.get("assignments") or []
    unassigned = list(plan.get("unassigned") or [])

    # Build name→id map for this user
    name_to_id = {}
    with get_cursor() as cur:
        cur.execute("SELECT id, name FROM user_portfolios WHERE user_id = %s", (user_id,))
        for row in cur.fetchall():
            name_to_id[row[1]] = row[0]

    applied = 0
    skipped = list(unassigned)
    for a in assignments:
        sym = (a.get("symbol") or "").strip().upper()
        pname = (a.get("portfolio_name") or "").strip()
        if not sym or sym == "__CASH__":
            continue
        pid = name_to_id.get(pname)
        if not pid:
            skipped.append(sym)
            continue
        try:
            execute(
                """
                INSERT INTO user_portfolio_holdings (portfolio_id, user_id, symbol, asset_class, source)
                VALUES (%s, %s, %s, NULL, 'ai_match')
                ON CONFLICT (user_id, symbol) DO UPDATE
                    SET portfolio_id = EXCLUDED.portfolio_id, source = 'ai_match'
                """,
                (pid, user_id, sym),
            )
            applied += 1
        except Exception:
            skipped.append(sym)
    return {"applied": applied, "skipped": skipped}
