"""导入预览与入账：订单号拦截、疑似重复、按商户预填。"""
import base64
import json
from datetime import date as Date

from . import backup, db, parsers


def _days(a, b):
    return abs((Date.fromisoformat(a) - Date.fromisoformat(b)).days)


def prefill(conn, merchant):
    r = conn.execute(
        "SELECT type, category_id FROM flows WHERE merchant = ? AND trade_id IS NULL "
        "ORDER BY date DESC, id DESC LIMIT 1", (merchant,)).fetchone()
    return dict(r) if r else None


def preview(conn, files):
    out_files, rows, errors = [], [], []
    for f in files:
        name = f["name"]
        try:
            data = base64.b64decode(f["data"])
            kind, parsed = parsers.parse(name, data)
        except parsers.ParseError as e:
            errors.append({"file": name, "error": str(e)})
            continue
        except Exception as e:  # 文件损坏等
            errors.append({"file": name, "error": f"解析失败：{e}"})
            continue
        enc = ""
        if kind == "alipay":
            try:
                data.decode("utf-8")
                enc = "UTF-8"
            except UnicodeDecodeError:
                enc = "GBK"
        out_files.append({"name": name, "source": kind, "count": len(parsed), "encoding": enc})
        for p in parsed:
            p["file"] = name
            rows.append(p)

    existing = {(r[0], r[1]) for r in conn.execute(
        "SELECT source, order_no FROM flows WHERE order_no IS NOT NULL")}
    seen = set()
    for i, r in enumerate(rows):
        r["id"] = i
        r["state"] = "skipped" if r["skipped"] else "ok"
        r["pair"] = None
        r["note"] = ""
        if r["state"] == "ok" and r["order_no"]:
            key = (r["source"], r["order_no"])
            if key in existing or key in seen:
                r["state"] = "duplicate"
            seen.add(key)

    # 疑似重复：信用卡 vs 支付宝 / 微信，收支类型相同、金额相同、日期差 ≤ 1 天
    # （收入和支出金额都存正数，不比类型会把报销收入和同额消费误配成一对）
    live = [r for r in rows if r["state"] == "ok" and r["type"] != "transfer"]
    cards = [r for r in live if r["source"] == "abc"]
    wallets = [r for r in live if r["source"] in ("alipay", "wechat")]
    used = set()
    for c in cards:
        for w in wallets:
            if w["id"] in used:
                continue
            if w["type"] == c["type"] and abs(w["amount"] - c["amount"]) < 0.005 \
                    and _days(w["date"], c["date"]) <= 1:
                used.add(w["id"])
                c["state"], w["state"] = "suspect_drop", "suspect_keep"
                c["pair"], w["pair"] = w["id"], c["id"]
                break
    db_wallet = db.rows(conn.execute(
        "SELECT id, date, amount, type, source, merchant FROM flows WHERE type != 'transfer' "
        "AND source IN ('alipay','wechat','abc')"))
    for r in live:
        if r["state"] != "ok":
            continue
        other = ("alipay", "wechat") if r["source"] == "abc" else ("abc",)
        for f in db_wallet:
            if f["source"] in other and f["type"] == r["type"] and abs(f["amount"] - r["amount"]) < 0.005 \
                    and _days(f["date"], r["date"]) <= 1:
                if r["source"] == "abc":
                    r["state"] = "suspect_drop"
                    r["note"] = f"与已入账的 {parsers.SOURCE_NAMES[f['source']]}「{f['merchant']}」疑似重复"
                else:
                    # 信用卡那笔已经入账，这一侧默认不导入，否则同一笔消费会计两次
                    r["state"] = "suspect_drop"
                    r["note"] = f"与已入账的信用卡「{f['merchant']}」疑似重复，默认不导入"
                break

    for r in rows:
        r["checked"] = r["state"] in ("ok", "suspect_keep")
        r["category_id"] = None
        r["prefilled"] = False
        if r["state"] in ("skipped", "duplicate"):
            continue
        p = prefill(conn, r["merchant"])
        if p:
            r["type"] = p["type"]
            r["category_id"] = p["category_id"] if p["type"] != "transfer" else None
            r["prefilled"] = True
    for f in out_files:
        f["skipped"] = sum(1 for r in rows if r["file"] == f["name"] and r["state"] == "skipped")
    stats = {
        "parsed": len(rows),
        "skipped": sum(1 for r in rows if r["state"] == "skipped"),
        "duplicate": sum(1 for r in rows if r["state"] == "duplicate"),
        "suspect": sum(1 for r in rows if r["state"] == "suspect_drop"),
    }
    return {"files": out_files, "rows": rows, "errors": errors, "stats": stats}


def confirm(conn, files, rows):
    with db.lock():
        bpath = backup.create("import")
        ts = db.now()
        cur = conn.execute("INSERT INTO batches(created, files, count, backup) VALUES (?,?,?,?)",
                           (ts, json.dumps(files, ensure_ascii=False), 0, str(bpath)))
        batch_id = cur.lastrowid
        n = 0
        for r in rows:
            if r.get("order_no") and conn.execute(
                    "SELECT 1 FROM flows WHERE source=? AND order_no=?",
                    (r["source"], r["order_no"])).fetchone():
                continue
            typ = r["type"]
            cat = r.get("category_id") if typ != "transfer" else None
            conn.execute(
                "INSERT INTO flows(date,amount,type,category_id,source,order_no,merchant,description,"
                "raw,batch_id,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (r["date"], round(float(r["amount"]), 2), typ, cat, r["source"], r.get("order_no"),
                 r.get("merchant", ""), r.get("description", ""),
                 json.dumps(r.get("raw") or {}, ensure_ascii=False), batch_id, ts, ts))
            n += 1
        conn.execute("UPDATE batches SET count=? WHERE id=?", (n, batch_id))
        conn.commit()
    return {"batch_id": batch_id, "count": n}
