"""本地 HTTP 服务：只监听 127.0.0.1，提供 JSON API 与前端静态文件。"""
import csv
import io
import json
import mimetypes
import re
import traceback
from datetime import date as Date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import __version__, backup, config, db, importer, ledger, parsers, quotes, reports

ROUTES = []


# 会回显到页面的查询参数，一律校验格式
_QUERY_FORMATS = {
    "year": re.compile(r"\d{4}"),
    "month": re.compile(r"\d{4}-\d{2}"),
    "period": re.compile(r"\d{4}(-\d{2})?"),
}


class ApiError(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), fn))
        return fn
    return deco


def _num(v, name="金额"):
    try:
        if isinstance(v, str):
            v = v.replace(",", "").replace("−", "-").replace("¥", "").strip()
        return float(v)
    except (TypeError, ValueError):
        raise ApiError(f"{name}不是有效数字")


def _date(v):
    try:
        return Date.fromisoformat(str(v).strip()).isoformat()
    except ValueError:
        raise ApiError("日期格式应为 YYYY-MM-DD")


def _copy_date(src_date, target_month):
    day = int(src_date[8:10])
    last = int(reports.month_end(target_month)[8:])
    return f"{target_month}-{min(day, last):02d}"


# ---------- 基础 ----------

@route("GET", "/api/meta")
def meta(conn, q, body):
    return {
        "version": __version__, "today": Date.today().isoformat(),
        "db": str(config.DB_PATH),
        "categories": ledger.categories(conn),
        "l1": {"income": db.INCOME_L1, "expense": db.EXPENSE_L1},
        "accounts": db.rows(conn.execute("SELECT * FROM accounts ORDER BY sort, id")),
        "instruments": list(ledger.instruments(conn).values()),
    }


@route("GET", "/api/overview")
def overview(conn, q, body):
    return reports.overview(conn)


# ---------- 账单与流水 ----------

def _check_flow(conn, b):
    typ = b.get("type")
    if typ not in ("income", "expense", "transfer"):
        raise ApiError("类型应为收入、支出或转账")
    cat = b.get("category_id") or None
    if typ == "transfer":
        cat = None
    elif cat:
        c = conn.execute("SELECT kind FROM categories WHERE id=?", (cat,)).fetchone()
        if not c:
            raise ApiError("分类不存在")
        if c[0] != typ:
            raise ApiError("分类与收支类型不一致")
    return typ, cat


@route("GET", "/api/bills")
def bills(conn, q, body):
    month = q.get("month") or Date.today().strftime("%Y-%m")
    flows = ledger.month_flows(conn, month)
    batch = db.one(conn.execute("SELECT * FROM batches ORDER BY id DESC LIMIT 1"))
    if batch:
        batch["files"] = json.loads(batch["files"])
    return {
        "month": month, "flows": flows, "summary": ledger.summarize(flows),
        "totals": ledger.category_totals(flows), "batch": batch,
        "counts": {
            "all": len(flows),
            "income": sum(1 for f in flows if f["type"] == "income"),
            "expense": sum(1 for f in flows if f["type"] == "expense"),
            "transfer": sum(1 for f in flows if f["type"] == "transfer"),
            "unknown": sum(1 for f in flows if f.get("cat_name") == "???"),
        },
    }


@route("GET", "/api/flows")
def flows_query(conn, q, body):
    sql = ("SELECT f.*, c.l1, c.name AS cat_name FROM flows f LEFT JOIN categories c ON c.id=f.category_id "
           "WHERE f.date LIKE ?")
    args = [q.get("period", "") + "%"]
    if q.get("category_id"):
        sql += " AND f.category_id=?"
        args.append(int(q["category_id"]))
    if q.get("l1"):
        sql += " AND c.l1=?"
        args.append(q["l1"])
    if q.get("type"):
        sql += " AND f.type=?"
        args.append(q["type"])
    if q.get("consume"):
        sql += " AND f.type='expense' AND (c.l1 IS NULL OR c.l1 != '工资减扣')"
    return {"items": db.rows(conn.execute(sql + " ORDER BY f.date, f.id", args))}


@route("POST", "/api/flows")
def flow_create(conn, q, b):
    typ, cat = _check_flow(conn, b)
    ts = db.now()
    cur = conn.execute(
        "INSERT INTO flows(date,amount,type,category_id,source,merchant,description,tag,created,updated)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (_date(b["date"]), round(_num(b["amount"]), 2), typ, cat, "manual",
         (b.get("merchant") or "").strip(), (b.get("description") or "").strip(), "", ts, ts))
    conn.commit()
    return {"id": cur.lastrowid}


@route("PUT", r"/api/flows/(\d+)")
def flow_update(conn, q, b, fid):
    f = db.one(conn.execute("SELECT * FROM flows WHERE id=?", (fid,)))
    if not f:
        raise ApiError("流水不存在", 404)
    if f["trade_id"]:
        raise ApiError("这笔流水由交易自动生成，请在持仓页修改对应交易")
    typ, cat = _check_flow(conn, b)
    conn.execute(
        "UPDATE flows SET date=?, amount=?, type=?, category_id=?, merchant=?, description=?, updated=? WHERE id=?",
        (_date(b["date"]), round(_num(b["amount"]), 2), typ, cat, (b.get("merchant") or "").strip(),
         (b.get("description") or "").strip(), db.now(), fid))
    conn.commit()
    return {"ok": True}


@route("POST", "/api/flows/batch")
def flow_batch(conn, q, b):
    ids = [int(i) for i in b.get("ids", [])]
    if not ids:
        raise ApiError("没有选中流水")
    marks = ",".join("?" * len(ids))
    auto = conn.execute(f"SELECT COUNT(*) FROM flows WHERE id IN ({marks}) AND trade_id IS NOT NULL",
                        ids).fetchone()[0]
    action = b.get("action")
    if action != "copy_next" and auto:
        raise ApiError("选中的流水里有交易自动生成的，不能批量修改或删除")
    ts = db.now()
    if action == "delete":
        conn.execute(f"DELETE FROM flows WHERE id IN ({marks})", ids)
    elif action == "set_category":
        c = db.one(conn.execute("SELECT * FROM categories WHERE id=?", (b.get("category_id"),)))
        if not c:
            raise ApiError("分类不存在")
        conn.execute(f"UPDATE flows SET type=?, category_id=?, updated=? WHERE id IN ({marks})",
                     [c["kind"], c["id"], ts, *ids])
    elif action == "set_type":
        typ = b.get("type")
        if typ not in ("income", "expense", "transfer"):
            raise ApiError("类型无效")
        if typ == "transfer":
            conn.execute(f"UPDATE flows SET type='transfer', category_id=NULL, updated=? WHERE id IN ({marks})",
                         [ts, *ids])
        else:
            conn.execute(
                f"UPDATE flows SET type=?, category_id=CASE WHEN category_id IN "
                f"(SELECT id FROM categories WHERE kind=?) THEN category_id ELSE NULL END, updated=? "
                f"WHERE id IN ({marks})", [typ, typ, ts, *ids])
    elif action == "copy_next":
        n = 0
        for f in db.rows(conn.execute(f"SELECT * FROM flows WHERE id IN ({marks})", ids)):
            target = reports.month_add(f["date"][:7], 1)
            _insert_copy(conn, f, target, f["amount"], ts)
            n += 1
        conn.commit()
        return {"copied": n}
    else:
        raise ApiError("未知操作")
    conn.commit()
    return {"ok": True}


def _insert_copy(conn, f, target, amount, ts):
    src_m = int(f["date"][5:7])
    conn.execute(
        "INSERT INTO flows(date,amount,type,category_id,source,merchant,description,tag,created,updated)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (_copy_date(f["date"], target), round(amount, 2),
         "income" if f["trade_id"] else f["type"], f["category_id"], "copy",
         f["merchant"], f["description"], f"复制自 {src_m} 月", ts, ts))


@route("GET", "/api/copy")
def copy_list(conn, q, b):
    month = q["month"]
    src = reports.month_add(month, -1)
    items = ledger.month_flows(conn, src)
    target = ledger.month_flows(conn, month)
    have = {(t["merchant"], t["category_id"]) for t in target}
    for f in items:
        f["target_date"] = _copy_date(f["date"], month)
        f["clamped"] = int(f["date"][8:]) != int(f["target_date"][8:])
        f["exists"] = (f["merchant"], f["category_id"]) in have
    items.sort(key=lambda f: (f["date"], f["id"]))
    return {"month": month, "source": src, "items": items}


@route("POST", "/api/copy")
def copy_do(conn, q, b):
    month = b["month"]
    ts = db.now()
    n = 0
    for it in b.get("items", []):
        f = db.one(conn.execute("SELECT * FROM flows WHERE id=?", (int(it["id"]),)))
        if not f:
            continue
        _insert_copy(conn, f, month, _num(it.get("amount", f["amount"])), ts)
        n += 1
    conn.commit()
    return {"copied": n}


# ---------- 导入 ----------

@route("POST", "/api/import/preview")
def import_preview(conn, q, b):
    return importer.preview(conn, b.get("files", []))


@route("POST", "/api/import/confirm")
def import_confirm(conn, q, b):
    for r in b.get("rows", []):
        r["date"] = _date(r["date"])
        _check_flow(conn, r)
    return importer.confirm(conn, b.get("files", []), b.get("rows", []))


@route("POST", "/api/import/undo")
def import_undo(conn, q, b):
    batch = db.one(conn.execute("SELECT * FROM batches WHERE id=?", (b.get("batch_id"),)))
    if not batch or not batch["backup"]:
        raise ApiError("找不到这次导入的备份")
    conn.close()
    backup.restore(batch["backup"])
    return {"ok": True}


# ---------- 账户 / 标的 / 交易 ----------

CURRENCIES = ("CNY", "HKD", "USD", "CRYPTO")


@route("POST", "/api/accounts")
def account_create(conn, q, b):
    name = (b.get("name") or "").strip()
    if not name:
        raise ApiError("请填写账户名称")
    cur_ = b.get("currency", "CNY")
    if cur_ not in CURRENCIES:
        raise ApiError("币种无效")
    kind = b.get("kind", "manual")
    sort = conn.execute("SELECT COALESCE(MAX(sort),0)+1 FROM accounts").fetchone()[0]
    c = conn.execute("INSERT INTO accounts(name,kind,currency,note,sort,created) VALUES (?,?,?,?,?,?)",
                     (name, kind, cur_, b.get("note", ""), sort, db.now()))
    conn.commit()
    return {"id": c.lastrowid}


@route("PUT", r"/api/accounts/(\d+)")
def account_update(conn, q, b, aid):
    a = db.one(conn.execute("SELECT * FROM accounts WHERE id=?", (aid,)))
    if not a:
        raise ApiError("账户不存在", 404)
    name = (b.get("name", a["name"]) or "").strip()
    cur_ = b.get("currency", a["currency"])
    if cur_ not in CURRENCIES:
        raise ApiError("币种无效")
    conn.execute("UPDATE accounts SET name=?, currency=?, note=?, disabled=? WHERE id=?",
                 (name or a["name"], cur_, b.get("note", a["note"]), int(b.get("disabled", a["disabled"])), aid))
    conn.commit()
    return {"ok": True}


def _check_inst(b):
    if not (b.get("code") or "").strip() or not (b.get("name") or "").strip():
        raise ApiError("请填写代码和名称")
    if b.get("category") not in ("stock", "etf", "fund", "crypto"):
        raise ApiError("类别无效")
    if b.get("currency") not in ("CNY", "HKD", "USD", "USDT"):
        raise ApiError("计价币种无效")


def _resolve_account(conn, b):
    if b.get("account_id"):
        return int(b["account_id"])
    na = b.get("new_account") or {}
    if not (na.get("name") or "").strip():
        raise ApiError("请选择或新建所属投资账户")
    return account_create(conn, {}, {"name": na["name"], "currency": na.get("currency", "CNY"),
                                     "kind": "investment"})["id"]


@route("GET", r"/api/instruments/(\d+)")
def inst_get(conn, q, b, iid):
    i = db.one(conn.execute("SELECT * FROM instruments WHERE id=?", (iid,)))
    if not i:
        raise ApiError("标的不存在", 404)
    return i


@route("POST", "/api/instruments")
def inst_create(conn, q, b):
    _check_inst(b)
    with db.lock():
        aid = _resolve_account(conn, b)
        c = conn.execute(
            "INSERT INTO instruments(code,name,category,currency,connect,account_id,created) VALUES (?,?,?,?,?,?,?)",
            (b["code"].strip(), b["name"].strip(), b["category"], b["currency"], int(bool(b.get("connect"))),
             aid, db.now()))
        iid = c.lastrowid
        op = b.get("opening")
        if op:
            if _num(op["qty"], "数量") <= 0:
                raise ApiError("期初数量应大于 0")
            if _num(op["amount"]) < 0:
                raise ApiError("期初成本不能为负数")
            conn.execute(
                "INSERT INTO trades(date,kind,instrument_id,qty,amount,opening,created) VALUES (?,?,?,?,?,1,?)",
                (_date(op.get("date") or Date.today().isoformat()), "buy", iid, _num(op["qty"], "数量"),
                 _num(op["amount"]), db.now()))
            ledger.regenerate_auto_flows(conn)
        conn.commit()
    return {"id": iid}


@route("PUT", r"/api/instruments/(\d+)")
def inst_update(conn, q, b, iid):
    i = db.one(conn.execute("SELECT * FROM instruments WHERE id=?", (iid,)))
    if not i:
        raise ApiError("标的不存在", 404)
    merged = {**i, **b}
    _check_inst(merged)
    with db.lock():
        if b.get("account_id") or b.get("new_account"):
            aid = _resolve_account(conn, {"account_id": b.get("account_id"), "new_account": b.get("new_account")})
        else:
            aid = i["account_id"]
        conn.execute(
            "UPDATE instruments SET code=?, name=?, category=?, currency=?, connect=?, account_id=?, disabled=? WHERE id=?",
            (merged["code"].strip(), merged["name"].strip(), merged["category"], merged["currency"],
             int(bool(merged.get("connect"))), aid, int(bool(merged.get("disabled"))), iid))
        ledger.regenerate_auto_flows(conn)
        conn.commit()
    return {"ok": True}


@route("POST", "/api/instruments/convert")
def inst_convert(conn, q, b):
    """P-1d：手填账户转为标的，录期初买入并停用原账户。"""
    acc = db.one(conn.execute("SELECT * FROM accounts WHERE id=? AND kind='manual'", (b.get("manual_account_id"),)))
    if not acc:
        raise ApiError("请选择要转换的手填账户")
    if acc["disabled"]:  # 已转换过（转换会停用原账户），防止重复转换
        raise ApiError("这个手填账户已经停用，可能已经转换过了")
    b.setdefault("opening", {"date": b.get("date"), "qty": b.get("qty"), "amount": b.get("amount")})
    res = inst_create(conn, q, b)
    conn.execute("UPDATE accounts SET disabled=1 WHERE id=?", (acc["id"],))
    conn.commit()
    return res


@route("POST", "/api/lookup")
def lookup(conn, q, b):
    return {"result": quotes.lookup(b.get("code", ""), b.get("category", "stock"), b.get("currency", "CNY"))}


@route("GET", r"/api/trades/(\d+)")
def trade_get(conn, q, b, tid):
    t = db.one(conn.execute("SELECT * FROM trades WHERE id=?", (tid,)))
    if not t:
        raise ApiError("交易不存在", 404)
    return t


def _trade_values(b):
    kind = b.get("kind")
    if kind not in ("buy", "sell", "fx_buy", "fx_sell"):
        raise ApiError("交易类型无效")
    vals = {"date": _date(b.get("date")), "kind": kind, "qty": _num(b.get("qty"), "数量"),
            "amount": _num(b.get("amount")), "opening": int(bool(b.get("opening"))) if kind in ("buy", "fx_buy") else 0,
            "instrument_id": None, "currency": None, "note": b.get("note", "")}
    if vals["qty"] <= 0:
        raise ApiError("数量应大于 0")
    if vals["amount"] < 0:  # 负的买入成本 / 卖出所得会让成本与投资净投入算错
        raise ApiError("金额不能为负数")
    if kind in ("buy", "sell"):
        if not b.get("instrument_id"):
            raise ApiError("请选择标的")
        vals["instrument_id"] = int(b["instrument_id"])
    else:
        if b.get("currency") not in ("HKD", "USD"):
            raise ApiError("请选择币种")
        vals["currency"] = b["currency"]
    return vals


def _write_trade(conn, vals, tid=None):
    cols = ["date", "kind", "instrument_id", "currency", "qty", "amount", "opening", "note"]
    if tid:
        conn.execute(f"UPDATE trades SET {', '.join(c + '=?' for c in cols)} WHERE id=?",
                     [vals[c] for c in cols] + [tid])
        return tid
    c = conn.execute(f"INSERT INTO trades({', '.join(cols)}, created) VALUES ({', '.join('?' * len(cols))}, ?)",
                     [vals[c] for c in cols] + [db.now()])
    return c.lastrowid


def _check_oversell(conn):
    bad = ledger.oversold(conn)
    if bad:
        raise ApiError(f"{bad['date']} 卖出「{bad['name']}」{bad['qty']:g}，超过当时的持仓 "
                       f"{bad['oversold']:g}。请先补录或修改之前的买入。")


@route("POST", "/api/trades/preview")
def trade_preview(conn, q, b):
    """在事务里试算，返回这笔交易前后的持仓与盈亏，然后回滚。"""
    vals = _trade_values(b)
    tid = int(b["id"]) if b.get("id") else None
    with db.lock():
        before = ledger.replay(conn)
        try:
            new_id = _write_trade(conn, vals, tid)
            after = ledger.replay(conn)
        finally:
            conn.rollback()

    def state(rep, key, is_fx):
        insts, pos, fx, _ = rep
        if is_fx:
            f = fx.get(key)
            return {"bal": f["bal"], "avg": f["avg"]} if f else {"bal": 0, "avg": 0}
        p = pos.get(key)
        return {"qty": p["qty"], "avg": p["avg"], "cost": p["cost"], "realized": p["realized"]} if p else None

    is_fx = vals["kind"].startswith("fx")
    key = vals["currency"] if is_fx else vals["instrument_id"]
    res = after[3].get(new_id, {})
    return {"before": state(before, key, is_fx), "after": state(after, key, is_fx), "result": res}


@route("POST", "/api/trades")
def trade_create(conn, q, b):
    vals = _trade_values(b)
    with db.lock():
        tid = _write_trade(conn, vals)
        _check_oversell(conn)
        ledger.regenerate_auto_flows(conn)
        conn.commit()
    return {"id": tid}


@route("PUT", r"/api/trades/(\d+)")
def trade_update(conn, q, b, tid):
    vals = _trade_values(b)
    with db.lock():
        _write_trade(conn, vals, int(tid))
        _check_oversell(conn)
        ledger.regenerate_auto_flows(conn)
        conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/trades/(\d+)")
def trade_delete(conn, q, b, tid):
    with db.lock():
        conn.execute("DELETE FROM trades WHERE id=?", (tid,))
        _check_oversell(conn)
        ledger.regenerate_auto_flows(conn)
        conn.commit()
    return {"ok": True}


@route("GET", "/api/holdings")
def holdings(conn, q, b):
    return reports.holdings(conn)


# ---------- 盘点 ----------

@route("GET", "/api/stocktake")
def stocktake(conn, q, b):
    return reports.stocktake(conn, q.get("month") or reports.default_stock_month())


@route("POST", "/api/stocktake/prices")
def stocktake_prices(conn, q, b):
    ids = [int(i) for i in b.get("instrument_ids", [])]
    insts = [i for i in ledger.instruments(conn).values() if i["id"] in ids]
    return {"prices": quotes.prices(insts) if insts else {}, "rates": quotes.rates()}


@route("POST", "/api/stocktake")
def stocktake_save(conn, q, b):
    b["date"] = _date(b.get("date"))
    if not re.fullmatch(r"\d{4}-\d{2}", b.get("month", "")):
        raise ApiError("盘点月份无效")
    return reports.save_stocktake(conn, b, backup.create)


# ---------- 报表 ----------

@route("GET", "/api/bs")
def bs(conn, q, b):
    months = reports.snapshot_months(conn)
    month = q.get("month") or (months[-1] if months else None)
    return {"months": months, "month": month,
            "detail": reports.snapshot_detail(conn, month) if month else None}


@route("GET", "/api/is")
def income_statement(conn, q, b):
    return reports.income_statement(conn, q.get("year") or str(Date.today().year))


@route("GET", "/api/cf")
def cash_flow(conn, q, b):
    return reports.cash_flow(conn, q.get("year") or str(Date.today().year))


@route("GET", "/api/cf/drill")
def cf_drill(conn, q, b):
    return reports.cf_drill(conn, q["period"], q.get("row", "balance"))


# ---------- 分类 / 备份 / 导出 ----------

@route("POST", "/api/categories")
def cat_create(conn, q, b):
    l1 = b.get("l1")
    if l1 not in db.L1_KIND:
        raise ApiError("一级分类不存在")
    name = (b.get("name") or "").strip()
    if not name:
        raise ApiError("请填写二级分类名称")
    if conn.execute("SELECT 1 FROM categories WHERE l1=? AND name=?", (l1, name)).fetchone():
        raise ApiError("同名二级分类已存在")
    sort = conn.execute("SELECT COALESCE(MAX(sort),0)+1 FROM categories WHERE l1=?", (l1,)).fetchone()[0]
    conn.execute("UPDATE categories SET sort=sort+1 WHERE sort>=?", (sort,))
    c = conn.execute("INSERT INTO categories(kind,l1,name,sort) VALUES (?,?,?,?)",
                     (db.L1_KIND[l1], l1, name, sort))
    conn.commit()
    return {"id": c.lastrowid}


@route("PUT", r"/api/categories/(\d+)")
def cat_update(conn, q, b, cid):
    c = db.one(conn.execute("SELECT * FROM categories WHERE id=?", (cid,)))
    if not c:
        raise ApiError("分类不存在", 404)
    if c["auto"]:
        raise ApiError("自动生成的分类不能修改")
    name = (b.get("name") or "").strip()
    if not name:
        raise ApiError("名称不能为空")
    conn.execute("UPDATE categories SET name=? WHERE id=?", (name, cid))
    conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/categories/(\d+)")
def cat_delete(conn, q, b, cid):
    c = db.one(conn.execute("SELECT * FROM categories WHERE id=?", (cid,)))
    if not c:
        raise ApiError("分类不存在", 404)
    if c["auto"]:
        raise ApiError("自动生成的分类不能删除")
    n = conn.execute("SELECT COUNT(*) FROM flows WHERE category_id=?", (cid,)).fetchone()[0]
    if n:
        raise ApiError(f"「{c['name']}」还有 {n} 笔流水，请先把它们改到别的分类")
    conn.execute("DELETE FROM categories WHERE id=?", (cid,))
    conn.commit()
    return {"ok": True}


@route("GET", "/api/backups")
def backups(conn, q, b):
    return {"items": backup.listing(), "dir": str(config.BACKUP_DIR)}


@route("POST", "/api/backups/restore")
def backups_restore(conn, q, b):
    conn.close()
    try:
        backup.restore(b["file"])
    except FileNotFoundError:
        raise ApiError("备份文件不存在", 404)
    return {"ok": True}


def export_csv(conn):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["日期", "类型", "一级分类", "二级分类", "金额", "来源", "商户", "商品说明", "订单号", "标签"])
    names = {"income": "收入", "expense": "支出", "transfer": "转账"}
    for f in conn.execute("SELECT f.*, c.l1, c.name AS cat FROM flows f LEFT JOIN categories c "
                          "ON c.id=f.category_id ORDER BY f.date, f.id"):
        w.writerow([f["date"], names.get(f["type"], f["type"]), f["l1"] or "", f["cat"] or "",
                    f"{f['amount']:.2f}", parsers.SOURCE_NAMES.get(f["source"], f["source"]),
                    f["merchant"], f["description"], f["order_no"] or "", f["tag"]])
    return ("﻿" + out.getvalue()).encode("utf-8")


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "FinanceX"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, ctype="application/json; charset=utf-8", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"))

    def _forbidden_reason(self, method):
        """拒绝其他网站发来的请求：只监听 127.0.0.1 挡不住浏览器里的恶意网页。"""
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if (self.headers.get("Host") or "").lower() not in allowed:  # 防 DNS 重绑定
            return "Host 不被允许"
        if method == "GET":
            return None
        origin = self.headers.get("Origin")
        if origin is not None and origin.lower() not in {f"http://{h}" for h in allowed}:
            return "跨站请求被拒绝"
        if self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
            return "跨站请求被拒绝"
        # 要求 JSON：跨站网页发 application/json 必须先预检，而本服务不响应预检
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if int(self.headers.get("Content-Length") or 0) and ctype != "application/json":
            return "请求须为 JSON"
        if method == "POST" and ctype != "application/json":
            return "请求须为 JSON"
        return None

    def _handle(self, method):
        reason = self._forbidden_reason(method)
        if reason:
            return self._json(403, {"error": reason})
        url = urlparse(self.path)
        path = url.path
        if not path.startswith("/api/"):
            if method != "GET":
                return self._json(405, {"error": "method not allowed"})
            return self._static(path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        for k, rx in _QUERY_FORMATS.items():
            if k in q and q[k] != "" and not rx.fullmatch(q[k]):
                return self._json(400, {"error": f"参数 {k} 格式无效"})
        if path == "/api/export.csv":
            conn = db.connect()
            try:
                data = export_csv(conn)
            finally:
                conn.close()
            name = f"financex-flows-{Date.today().isoformat()}.csv"
            return self._send(200, data, "text/csv; charset=utf-8",
                              {"Content-Disposition": f'attachment; filename="{name}"'})
        body = {}
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            try:
                body = json.loads(self.rfile.read(n).decode("utf-8"))
            except ValueError:
                return self._json(400, {"error": "请求格式错误"})
        for m, rx, fn in ROUTES:
            if m != method:
                continue
            mt = rx.match(path)
            if not mt:
                continue
            conn = db.connect()
            try:
                return self._json(200, fn(conn, q, body, *[int(g) for g in mt.groups()]))
            except ApiError as e:
                conn.rollback()
                return self._json(e.status, {"error": str(e)})
            except Exception as e:
                traceback.print_exc()
                try:
                    conn.rollback()
                except Exception:
                    pass
                return self._json(500, {"error": f"服务器错误：{e}"})
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
        return self._json(404, {"error": "接口不存在"})

    def _static(self, path):
        if path in ("/", "/index.html"):
            path = "/index.html"
        target = (config.STATIC_DIR / path.lstrip("/")).resolve()
        if config.STATIC_DIR.resolve() not in target.parents or not target.is_file():
            target = config.STATIC_DIR / "index.html"
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        if target.suffix == ".js":
            ctype = "text/javascript; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")


def serve(port=None):
    httpd = ThreadingHTTPServer((config.HOST, port or config.PORT), Handler)
    httpd.daemon_threads = True
    return httpd
