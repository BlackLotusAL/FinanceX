"""总览、盘点、持仓与三张报表的数据。"""
import calendar
import json
from collections import defaultdict
from datetime import date as Date

from . import db, ledger

GROUPS = ["CNY", "HKD", "USD", "CRYPTO"]


def month_add(month, n):
    y, m = int(month[:4]), int(month[5:7])
    m += n
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


def month_end(month):
    y, m = int(month[:4]), int(month[5:7])
    return f"{month}-{calendar.monthrange(y, m)[1]:02d}"


def default_stock_month(today=None):
    today = today or Date.today()
    return month_add(today.strftime("%Y-%m"), -1)


def rate_of(cur, rates):
    if cur == "CNY":
        return 1.0
    if cur in ("CRYPTO", "USDT"):
        return rates.get("USD")
    return rates.get(cur)


# ---------- 快照 ----------

def snapshot_months(conn):
    return [r[0] for r in conn.execute("SELECT month FROM snapshots ORDER BY month")]


def snapshot_detail(conn, month):
    snap = db.one(conn.execute("SELECT * FROM snapshots WHERE month=?", (month,)))
    if not snap:
        return None
    rates = json.loads(snap["rates"])
    groups = {g: {"currency": g, "items": [], "total": 0.0} for g in GROUPS}
    missing = 0
    for b in conn.execute(
            "SELECT b.*, a.name, a.currency, a.note, a.disabled FROM snap_balances b "
            "JOIN accounts a ON a.id=b.account_id WHERE b.month=? ORDER BY a.sort, a.id", (month,)):
        r = rate_of(b["currency"], rates)
        val = b["balance"]
        cny = val * r if (val is not None and r) else None
        if cny is None:
            missing += 1
        groups[b["currency"]]["items"].append({
            "kind": "account", "account_id": b["account_id"], "name": b["name"], "note": b["note"],
            "currency": b["currency"], "value": val, "cny": cny})
        groups[b["currency"]]["total"] += cny or 0
    for p in conn.execute(
            "SELECT p.*, i.code, i.name, i.currency, i.connect, i.category, a.name AS account_name "
            "FROM snap_positions p JOIN instruments i ON i.id=p.instrument_id "
            "JOIN accounts a ON a.id=i.account_id WHERE p.month=? ORDER BY a.id, i.id", (month,)):
        inst = dict(p)
        g = ledger.group_of(inst)
        r = rate_of(inst["currency"], rates)
        mv = p["qty"] * p["price"] if p["price"] is not None else None
        cny = mv * r if (mv is not None and r) else None
        if cny is None:
            missing += 1
        book = ledger.book_currency(inst)
        if mv is None:
            pnl = None
        elif book == "CNY":
            pnl = (cny or 0) - p["cost"]
        else:
            pnl = mv - p["cost"]
        groups[g]["items"].append({
            "kind": "position", "instrument_id": p["instrument_id"], "name": p["name"],
            "code": p["code"], "qty": p["qty"], "price": p["price"], "currency": inst["currency"],
            "connect": inst["connect"], "value": mv, "cny": cny, "cost": p["cost"],
            "pnl": pnl, "pnl_currency": book, "price_note": p["price_note"]})
        groups[g]["total"] += cny or 0
    net = sum(g["total"] for g in groups.values())
    n_acc = conn.execute("SELECT COUNT(*) FROM snap_balances WHERE month=?", (month,)).fetchone()[0]
    n_pos = conn.execute("SELECT COUNT(*) FROM snap_positions WHERE month=?", (month,)).fetchone()[0]
    return {"month": month, "date": snap["date"], "rates": rates, "rate_note": snap["rate_note"],
            "groups": [groups[g] for g in GROUPS], "net": net, "missing": missing,
            "accounts": n_acc, "positions": n_pos}


def overview(conn):
    months = snapshot_months(conn)
    if not months:
        return {"empty": True, "default_month": default_stock_month()}
    vals = {m: snapshot_detail(conn, m) for m in months}
    latest = months[-1]
    cur = vals[latest]

    def totals(d):
        return {g["currency"]: g["total"] for g in d["groups"]}

    prev_m = month_add(latest, -1)
    prev = vals.get(prev_m)
    year = latest[:4]
    base_m = f"{int(year) - 1}-12"
    if base_m not in vals:
        this_year = [m for m in months if m.startswith(year)]
        base_m = this_year[0] if this_year else None
    base = vals.get(base_m) if base_m and base_m != latest else None

    series = []
    m = months[0]
    while m <= latest:
        d = vals.get(m)
        series.append({"month": m, "groups": totals(d) if d else None, "net": d["net"] if d else None})
        m = month_add(m, 1)
    return {
        "empty": False, "month": latest, "net": cur["net"], "groups": totals(cur),
        "prev": {"month": prev_m, "net": prev["net"], "groups": totals(prev)} if prev else None,
        "base": {"month": base_m, "net": base["net"]} if base else None,
        "series": series, "date": cur["date"], "rates": cur["rates"],
        "accounts": cur["accounts"], "positions": cur["positions"],
        "default_month": default_stock_month(),
    }


# ---------- 盘点 ----------

def stocktake(conn, month):
    snap = db.one(conn.execute("SELECT * FROM snapshots WHERE month=?", (month,)))
    saved_bal = {r["account_id"]: r["balance"] for r in conn.execute(
        "SELECT * FROM snap_balances WHERE month=?", (month,))}
    saved_pos = {r["instrument_id"]: dict(r) for r in conn.execute(
        "SELECT * FROM snap_positions WHERE month=?", (month,))}
    prev_snap = conn.execute("SELECT month FROM snapshots WHERE month < ? ORDER BY month DESC LIMIT 1",
                             (month,)).fetchone()
    prev_month = prev_snap[0] if prev_snap else None
    prev_bal = {}
    if prev_month:
        prev_bal = {r["account_id"]: r["balance"] for r in conn.execute(
            "SELECT * FROM snap_balances WHERE month=?", (prev_month,))}
    accounts = []
    for a in conn.execute("SELECT * FROM accounts WHERE kind='manual' ORDER BY sort, id"):
        a = dict(a)
        if a["disabled"] and a["id"] not in saved_bal:
            continue
        a["prev"] = prev_bal.get(a["id"])
        a["value"] = saved_bal.get(a["id"]) if snap else None
        a["in_snapshot"] = a["id"] in saved_bal
        accounts.append(a)
    disabled = db.rows(conn.execute(
        "SELECT * FROM accounts WHERE kind='manual' AND disabled=1 ORDER BY sort, id"))

    insts, pos = ledger.holdings_at(conn, month_end(month))
    positions = []
    for iid, inst in insts.items():
        p = pos[iid]
        saved = saved_pos.get(iid)
        if not saved and (inst["disabled"] or p["qty"] <= ledger.EPS):
            continue
        positions.append({
            "instrument_id": iid, "code": inst["code"], "name": inst["name"],
            "category": inst["category"], "currency": inst["currency"], "connect": inst["connect"],
            "account_id": inst["account_id"], "account_name": inst["account_name"],
            "group": ledger.group_of(inst),
            "qty": saved["qty"] if saved else p["qty"],
            "cost": saved["cost"] if saved else p["cost"],
            "price": saved["price"] if saved else None,
            "price_note": saved["price_note"] if saved else "",
        })
    positions.sort(key=lambda x: (x["account_id"], x["instrument_id"]))

    dm = default_stock_month()
    months = []
    snaps = set(snapshot_months(conn))
    m = dm
    for _ in range(36):
        months.append({"month": m, "snapshot": m in snaps})
        m = month_add(m, -1)
    for s in snaps:
        if s not in [x["month"] for x in months]:
            months.append({"month": s, "snapshot": True})
    months.sort(key=lambda x: x["month"], reverse=True)
    return {
        "month": month, "default_month": dm, "months": months,
        "snapshot": {"date": snap["date"], "rates": json.loads(snap["rates"]),
                     "rate_note": snap["rate_note"]} if snap else None,
        "prev_month": prev_month, "accounts": accounts, "disabled": disabled,
        "positions": positions,
    }


def save_stocktake(conn, data, backup_fn):
    month = data["month"]
    with db.lock():
        exists = conn.execute("SELECT 1 FROM snapshots WHERE month=?", (month,)).fetchone()
        if exists:
            backup_fn("stocktake")
        ts = db.now()
        rates = {k: float(v) for k, v in (data.get("rates") or {}).items()
                 if k in ("USD", "HKD") and v not in (None, "")}
        conn.execute("DELETE FROM snap_balances WHERE month=?", (month,))
        conn.execute("DELETE FROM snap_positions WHERE month=?", (month,))
        conn.execute(
            "INSERT INTO snapshots(month,date,rates,rate_note,created,updated) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(month) DO UPDATE SET date=excluded.date, rates=excluded.rates, "
            "rate_note=excluded.rate_note, updated=excluded.updated",
            (month, data["date"], json.dumps(rates), data.get("rate_note", ""), ts, ts))
        for b in data.get("balances", []):
            v = b.get("balance")
            conn.execute("INSERT INTO snap_balances(month,account_id,balance) VALUES (?,?,?)",
                         (month, b["account_id"], None if v in (None, "") else float(v)))
        for p in data.get("positions", []):
            v = p.get("price")
            conn.execute(
                "INSERT INTO snap_positions(month,instrument_id,qty,price,cost,price_note) VALUES (?,?,?,?,?,?)",
                (month, p["instrument_id"], float(p["qty"]), None if v in (None, "") else float(v),
                 float(p.get("cost") or 0), p.get("price_note", "")))
        conn.commit()
    return {"month": month, "overwritten": bool(exists)}


# ---------- 持仓 ----------

def holdings(conn):
    insts, pos, fx, _ = ledger.replay(conn)
    year = str(Date.today().year)
    accounts = {}
    realized_year = realized_all = 0.0
    for iid, inst in insts.items():
        p = pos[iid]
        book = ledger.book_currency(inst)
        if book == "CNY":
            realized_year += p["realized_years"].get(year, 0.0)
            realized_all += p["realized"]
        acc = accounts.setdefault(inst["account_id"], {
            "account_id": inst["account_id"], "name": inst["account_name"], "items": []})
        acc["items"].append({
            **inst, "qty": p["qty"], "avg": p["avg"], "cost": p["cost"],
            "realized": p["realized"], "book": book,
            "has_sell": any(t["kind"] == "sell" for t in p["trades"]),
            "trades": p["trades"]})
    acc_rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM accounts WHERE kind='investment'")}
    out_acc = []
    for aid, acc in accounts.items():
        acc["note"] = acc_rows.get(aid, {}).get("note", "")
        out_acc.append(acc)
    for aid, a in acc_rows.items():  # 空的投资账户也显示
        if aid not in accounts and not a["disabled"]:
            out_acc.append({"account_id": aid, "name": a["name"], "note": a["note"], "items": []})
    out_acc.sort(key=lambda a: a["account_id"])

    latest = conn.execute("SELECT month FROM snapshots ORDER BY month DESC LIMIT 1").fetchone()
    actual = {}
    if latest:
        for r in conn.execute(
                "SELECT a.currency, SUM(b.balance) FROM snap_balances b JOIN accounts a ON a.id=b.account_id "
                "WHERE b.month=? AND a.currency IN ('HKD','USD') GROUP BY a.currency", (latest[0],)):
            actual[r[0]] = r[1]
    manual = db.rows(conn.execute(
        "SELECT * FROM accounts WHERE kind='manual' AND disabled=0 ORDER BY sort, id"))
    return {
        "accounts": out_acc,
        "count": sum(len(a["items"]) for a in out_acc),
        "realized_year": realized_year, "realized_all": realized_all, "year": year,
        "fx": [{"currency": c, "bal": f["bal"], "avg": f["avg"], "trades": f["trades"]}
               for c, f in sorted(fx.items())],
        "actual_fx": actual, "actual_month": latest[0] if latest else None,
        "manual_accounts": manual,
    }


# ---------- 利润表 / 现金流量表 ----------

def _year_months(conn, year):
    r = conn.execute("SELECT MAX(substr(date,6,2)) FROM flows WHERE substr(date,1,4)=?", (year,)).fetchone()
    t = conn.execute("SELECT MAX(substr(date,6,2)) FROM trades WHERE substr(date,1,4)=?", (year,)).fetchone()
    last = max(int(r[0] or 0), int(t[0] or 0))
    return list(range(1, last + 1))


def years(conn):
    ys = {r[0] for r in conn.execute("SELECT DISTINCT substr(date,1,4) FROM flows")}
    ys |= {r[0] for r in conn.execute("SELECT DISTINCT substr(date,1,4) FROM trades")}
    ys.add(str(Date.today().year))
    return sorted(ys, reverse=True)


def income_statement(conn, year):
    months = _year_months(conn, year)
    flows = db.rows(conn.execute(
        "SELECT f.*, c.l1 FROM flows f LEFT JOIN categories c ON c.id=f.category_id "
        "WHERE substr(f.date,1,4)=? AND f.type != 'transfer'", (year,)))
    cells = defaultdict(lambda: [0.0] * 12)
    by_month = defaultdict(list)
    for f in flows:
        m = int(f["date"][5:7])
        by_month[m].append(f)
        if f["category_id"]:
            cells[f["category_id"]][m - 1] += f["amount"]
    summary = {m: ledger.summarize(by_month[m]) for m in months}
    total = ledger.summarize(flows)
    return {"year": year, "months": months, "categories": ledger.categories(conn),
            "cells": {k: v for k, v in cells.items()}, "summary": summary, "total": total,
            "years": years(conn)}


def cash_flow(conn, year):
    months = _year_months(conn, year)
    _, _, _, results = ledger.replay(conn)
    inv = defaultdict(float)
    for t in conn.execute("SELECT id, date FROM trades WHERE substr(date,1,4)=?", (year,)):
        inv[int(t["date"][5:7])] += results.get(t["id"], {}).get("inv", 0.0)
    flows = db.rows(conn.execute(
        "SELECT f.*, c.l1 FROM flows f LEFT JOIN categories c ON c.id=f.category_id "
        "WHERE substr(f.date,1,4)=? AND f.type != 'transfer'", (year,)))
    by_month = defaultdict(list)
    for f in flows:
        by_month[int(f["date"][5:7])].append(f)
    rows = [{"month": m, "balance": ledger.summarize(by_month[m])["balance"], "inv": round(inv[m], 2)}
            for m in months]
    return {"year": year, "months": months, "rows": rows,
            "total": {"balance": round(sum(r["balance"] for r in rows), 2),
                      "inv": round(sum(r["inv"] for r in rows), 2)},
            "years": years(conn)}


def cf_drill(conn, period, row):
    """period: YYYY-MM 或 YYYY。"""
    if row == "inv":
        insts, _, _, results = ledger.replay(conn)
        out = []
        for t in conn.execute("SELECT * FROM trades WHERE date LIKE ? ORDER BY date, id", (period + "%",)):
            t = dict(t)
            res = results.get(t["id"], {})
            inst = insts.get(t["instrument_id"]) if t["instrument_id"] else None
            out.append({**t, **res, "name": inst["name"] if inst else "", "code": inst["code"] if inst else "",
                        "book": ledger.book_currency(inst) if inst else "CNY",
                        "inst_currency": inst["currency"] if inst else t["currency"]})
        return {"row": "inv", "items": out}
    flows = db.rows(conn.execute(
        "SELECT f.*, c.l1, c.name AS cat_name FROM flows f LEFT JOIN categories c ON c.id=f.category_id "
        "WHERE f.date LIKE ? AND f.type != 'transfer' ORDER BY f.date, f.id", (period + "%",)))
    return {"row": "balance", "items": flows}
