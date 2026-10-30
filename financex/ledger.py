"""持仓、购汇与自动生成流水的计算。

所有记账规则见 PRD「统计口径」：
- 持仓按移动加权平均成本；卖出时 已实现盈亏 = 到手金额 − 数量 × 平均成本。
- 购汇：新成本 =（购汇余额 × 旧成本 + 支付人民币）÷（购汇余额 + 获得外币）。
- 结汇：本金 = min(数量, 购汇余额) × 平均成本；汇兑损益 = 收到人民币 − 本金；余额最低为 0。
- 投资净投入 = 人民币买入 + 购汇支出 − 人民币标的卖出部分的成本 − 结汇本金（期初不计）。
"""
from collections import defaultdict

from . import db

EPS = 1e-9


def book_currency(inst):
    """记账（结算）币种：人民币标的与港股通为 CNY，其余按原币。"""
    if inst["connect"] or inst["currency"] == "CNY":
        return "CNY"
    return inst["currency"]


def group_of(inst):
    """归入总览的四个币种分组。"""
    if inst["connect"] or inst["currency"] == "CNY":
        return "CNY"
    if inst["currency"] == "USDT":
        return "CRYPTO"
    return inst["currency"]


def instruments(conn, include_disabled=True):
    sql = ("SELECT i.*, a.name AS account_name FROM instruments i "
           "JOIN accounts a ON a.id = i.account_id")
    if not include_disabled:
        sql += " WHERE i.disabled = 0"
    return {r["id"]: dict(r) for r in conn.execute(sql + " ORDER BY i.id")}


def replay(conn, until=None):
    """按日期顺序重放所有交易。until 为 YYYY-MM-DD（含）。"""
    insts = instruments(conn)
    pos = {iid: {"qty": 0.0, "cost": 0.0, "avg": 0.0, "realized": 0.0,
                 "realized_years": defaultdict(float), "trades": []} for iid in insts}
    fx = defaultdict(lambda: {"bal": 0.0, "avg": 0.0, "trades": []})
    results = {}
    sql = "SELECT * FROM trades"
    args = ()
    if until:
        sql += " WHERE date <= ?"
        args = (until,)
    for t in conn.execute(sql + " ORDER BY date, id", args):
        t = dict(t)
        res = {"realized": None, "inv": 0.0, "principal": None, "pnl": None}
        if t["kind"] in ("buy", "sell"):
            inst = insts.get(t["instrument_id"])
            if inst is None:
                continue
            p = pos[inst["id"]]
            cny_book = book_currency(inst) == "CNY"
            if t["kind"] == "buy":
                p["qty"] += t["qty"]
                p["cost"] += t["amount"]
                p["avg"] = p["cost"] / p["qty"] if p["qty"] > EPS else p["avg"]
                if cny_book and not t["opening"]:
                    res["inv"] = t["amount"]
            else:
                if t["qty"] > p["qty"] * (1 + 1e-9) + 1e-6:
                    res["oversold"] = p["qty"]
                cost_sold = t["qty"] * p["avg"]
                realized = t["amount"] - cost_sold
                p["qty"] -= t["qty"]
                p["cost"] -= cost_sold
                if p["qty"] <= EPS:
                    p["qty"], p["cost"] = 0.0, 0.0
                p["realized"] += realized
                p["realized_years"][t["date"][:4]] += realized
                res["realized"] = realized
                res["cost_sold"] = cost_sold
                if cny_book:
                    res["inv"] = -cost_sold
            res["qty_after"] = p["qty"]
            res["avg_after"] = p["avg"]
            p["trades"].append({**t, **res})
        else:
            cur = t["currency"]
            f = fx[cur]
            if t["kind"] == "fx_buy":
                total = f["bal"] + t["qty"]
                f["avg"] = (f["bal"] * f["avg"] + t["amount"]) / total if total > EPS else f["avg"]
                f["bal"] = total
                if not t["opening"]:
                    res["inv"] = t["amount"]
            else:
                principal = min(t["qty"], f["bal"]) * f["avg"]
                res["principal"] = principal
                res["pnl"] = t["amount"] - principal
                res["inv"] = -principal
                f["bal"] = max(0.0, f["bal"] - t["qty"])
            res["bal_after"] = f["bal"]
            res["avg_after"] = f["avg"]
            f["trades"].append({**t, **res})
        results[t["id"]] = res
    return insts, pos, dict(fx), results


def oversold(conn):
    """按日期重放，返回第一笔卖出数量超过当时持仓的交易；没有则返回 None。"""
    insts, pos, _, _ = replay(conn)
    bad = [{**t, "name": insts[iid]["name"]} for iid, p in pos.items()
           for t in p["trades"] if t.get("oversold") is not None]
    bad.sort(key=lambda t: (t["date"], t["id"]))
    return bad[0] if bad else None


def regenerate_auto_flows(conn):
    """卖出（人民币标的）与结汇自动生成的流水，交易改动后整体重算。"""
    insts, pos, fx, results = replay(conn)
    realized_cat = db.category_id(conn, *db.AUTO_REALIZED)
    fx_cat = db.category_id(conn, *db.AUTO_FX)
    conn.execute("DELETE FROM flows WHERE trade_id IS NOT NULL")
    ts = db.now()
    for t in conn.execute("SELECT * FROM trades ORDER BY date, id").fetchall():
        res = results.get(t["id"])
        if not res:
            continue
        if t["kind"] == "sell":
            inst = insts[t["instrument_id"]]
            if book_currency(inst) != "CNY":
                continue
            conn.execute(
                "INSERT INTO flows(date,amount,type,category_id,source,merchant,description,trade_id,created,updated)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (t["date"], round(res["realized"], 2), "income", realized_cat, "sell",
                 f"卖出 {inst['name']}", "交易自动生成", t["id"], ts, ts))
        elif t["kind"] == "fx_sell":
            conn.execute(
                "INSERT INTO flows(date,amount,type,category_id,source,merchant,description,trade_id,created,updated)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (t["date"], round(res["pnl"], 2), "income", fx_cat, "fx",
                 f"结汇 {t['currency']} {t['qty']:,.2f}", "交易自动生成", t["id"], ts, ts))


def holdings_at(conn, date):
    """某日（含）的持仓数量与成本，用于盘点。"""
    insts, pos, _, _ = replay(conn, until=date)
    return insts, pos


# ---------- 收支统计 ----------

def categories(conn):
    return db.rows(conn.execute("SELECT * FROM categories ORDER BY sort, id"))


def month_flows(conn, month):
    return db.rows(conn.execute(
        "SELECT f.*, c.l1, c.name AS cat_name FROM flows f "
        "LEFT JOIN categories c ON c.id = f.category_id "
        "WHERE substr(f.date,1,7) = ? ORDER BY f.date DESC, f.id DESC", (month,)))


def summarize(flows):
    """收入、支出（工资减扣 / 消费支出）、结余、储蓄率。"""
    income = sum(f["amount"] for f in flows if f["type"] == "income")
    expense = sum(f["amount"] for f in flows if f["type"] == "expense")
    deduct = sum(f["amount"] for f in flows if f["type"] == "expense" and f.get("l1") == "工资减扣")
    has_salary = any(f["type"] == "income" and f.get("l1") == "工资收入" for f in flows)
    balance = income - expense
    rate = (balance / income) if (has_salary and income > EPS) else None
    return {"income": round(income, 2), "expense": round(expense, 2),
            "deduct": round(deduct, 2), "consume": round(expense - deduct, 2),
            "balance": round(balance, 2), "rate": rate}


def category_totals(flows):
    out = defaultdict(float)
    for f in flows:
        if f["type"] != "transfer" and f["category_id"]:
            out[f["category_id"]] += f["amount"]
    return out
