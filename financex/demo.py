"""生成演示数据：python -m financex.demo（写入 FINANCEX_DB，默认 data/demo.db）。

数据参照设计稿的示例（2025.01 – 2026.09，2025.04 未盘点），仅用于体验，不要用于真实记账。
"""
import json
import os
import random
import shutil
import sys
from pathlib import Path

if "FINANCEX_DB" not in os.environ:
    os.environ["FINANCEX_DB"] = str(Path(__file__).resolve().parent.parent / "data" / "demo.db")

from . import backup, config, db, ledger, reports  # noqa: E402

rnd = random.Random(20261007)


def months(start, end):
    m = start
    while m <= end:
        yield m
        m = reports.month_add(m, 1)


def main():
    if config.DB_PATH.name == "wealthx.db":
        sys.exit("拒绝覆盖正式数据库 data/wealthx.db。请用 demo.bat 或设置 FINANCEX_DB。")
    if config.DB_PATH.exists():
        config.DB_PATH.unlink()
    if config.BACKUP_DIR.exists():
        shutil.rmtree(config.BACKUP_DIR)
    conn = db.connect()
    db.init(conn)
    cat = {f"{r['l1']}·{r['name']}": r["id"] for r in conn.execute("SELECT * FROM categories")}
    ts = db.now()

    def account(name, kind, cur, note=""):
        return conn.execute("INSERT INTO accounts(name,kind,currency,note,sort,created) VALUES (?,?,?,?,?,?)",
                            (name, kind, cur, note, 0, ts)).lastrowid

    manual = {
        "招商银行 活期": account("招商银行 活期", "manual", "CNY"),
        "余额宝": account("余额宝", "manual", "CNY"),
        "微信 零钱通": account("微信 零钱通", "manual", "CNY"),
        "公积金 个人账户": account("公积金 个人账户", "manual", "CNY"),
        "饰品 UUYP": account("饰品 UUYP", "manual", "CNY"),
        "支付宝 债券型基金": account("支付宝 债券型基金", "manual", "CNY"),
        "借款 · 张三": account("借款 · 张三", "manual", "CNY", "借出"),
        "ZA Bank HKD": account("ZA Bank HKD", "manual", "HKD"),
        "ZA Bank USD": account("ZA Bank USD", "manual", "USD"),
        "中国银行 美元货币基金": account("中国银行 美元货币基金", "manual", "USD"),
        "OKX 活期 USDT": account("OKX 活期 USDT", "manual", "CRYPTO"),
        "Binance 活期 USDT": account("Binance 活期 USDT", "manual", "CRYPTO"),
    }
    em = account("东方财富", "investment", "CNY", "A 股 · ETF · 港股通")
    af = account("支付宝 基金", "investment", "CNY", "场外基金")
    za = account("ZA Bank 证券", "investment", "HKD", "港股 · 美股")
    okx = account("OKX", "investment", "CRYPTO", "加密货币 · USDT 计价")

    def inst(code, name, category, cur, acc, connect=0):
        return conn.execute(
            "INSERT INTO instruments(code,name,category,currency,connect,account_id,created) VALUES (?,?,?,?,?,?,?)",
            (code, name, category, cur, connect, acc, ts)).lastrowid

    I = {
        "hs300": inst("510300", "沪深300ETF", "etf", "CNY", em),
        "gold": inst("518880", "黄金ETF", "etf", "CNY", em),
        "tencent": inst("00700", "腾讯控股 · 港股通", "stock", "HKD", em, 1),
        "cmb": inst("600036", "招商银行", "stock", "CNY", em),
        "efd": inst("005827", "易方达蓝筹精选", "fund", "CNY", af),
        "tracker": inst("02800", "盈富基金", "etf", "HKD", za),
        "voo": inst("VOO", "标普500 ETF", "etf", "USD", za),
        "btc": inst("BTC-USDT", "BTC", "crypto", "USDT", okx),
        "eth": inst("ETH-USDT", "ETH", "crypto", "USDT", okx),
        "doge": inst("DOGE-USDT", "DOGE", "crypto", "USDT", okx),
    }

    def trade(date, kind, qty, amount, inst_key=None, currency=None, opening=0):
        conn.execute("INSERT INTO trades(date,kind,instrument_id,currency,qty,amount,opening,created) VALUES (?,?,?,?,?,?,?,?)",
                     (date, kind, I[inst_key] if inst_key else None, currency, qty, amount, opening, ts))

    trade("2025-01-02", "buy", 15000, 57150, "hs300", opening=1)
    trade("2025-03-01", "buy", 6000, 31200, "gold", opening=1)
    trade("2026-02-14", "buy", 4000, 25000, "gold")
    trade("2026-06-18", "sell", 2000, 13420, "gold")
    trade("2025-01-02", "buy", 300, 115560, "tencent", opening=1)
    trade("2026-04-10", "sell", 100, 43790, "tencent")
    trade("2025-11-20", "buy", 300, 9000, "cmb")
    trade("2025-12-10", "sell", 200, 10380, "cmb")
    trade("2026-09-12", "sell", 100, 3600, "cmb")
    trade("2025-01-02", "buy", 10601.10, 17002.04, "efd", opening=1)
    trade("2026-09-03", "buy", 1799.42, 3000, "efd")
    trade("2025-01-02", "buy", 2500, 46550, "tracker", opening=1)
    trade("2026-03-16", "sell", 500, 10550, "tracker")
    trade("2025-06-10", "buy", 30, 15372, "voo")
    trade("2025-01-02", "buy", 0.06, 3870, "btc", opening=1)
    trade("2025-01-02", "buy", 0.8, 2360, "eth", opening=1)
    trade("2026-05-20", "sell", 0.2, 1002, "eth")
    trade("2025-01-02", "buy", 3000, 960, "doge", opening=1)
    trade("2025-01-02", "fx_buy", 31300, 28500, currency="HKD", opening=1)
    trade("2026-09-18", "fx_buy", 10850, 10000, currency="HKD")
    trade("2026-01-05", "fx_buy", 1400, 10000, currency="USD")
    trade("2026-09-22", "fx_sell", 300, 2190, currency="USD")
    # 每月定投 / 买入（人民币标的）
    for m, amt in (("2026-01", 8000), ("2026-03", 5000), ("2026-05", 4000), ("2026-07", 6000), ("2026-08", 3500)):
        nav = 1.55 + rnd.random() * 0.1
        trade(f"{m}-08", "buy", round(amt / nav, 2), amt, "efd")

    # ---------- 流水 ----------
    def flow(date, amount, typ, c=None, merchant="", desc="", source="alipay", tag="", order=True, batch=None):
        conn.execute(
            "INSERT INTO flows(date,amount,type,category_id,source,order_no,merchant,description,tag,batch_id,created,updated)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (date, round(amount, 2), typ, cat[c] if c else None, source,
             f"D{rnd.randrange(10**12):012d}" if order and source in ("alipay", "wechat", "abc") else None,
             merchant, desc, tag, batch, ts, ts))

    eat = [("老乡鸡", "午餐"), ("食堂", "三餐"), ("永和大王", "早餐"), ("真功夫", "午餐")]
    take = [("美团外卖", "黄焖鸡米饭"), ("饿了么", "麻辣烫"), ("美团外卖", "猪脚饭")]
    for m in months("2025-01", "2026-10"):
        last = int(reports.month_end(m)[8:])
        d = lambda day: f"{m}-{min(day, last):02d}"  # noqa: E731
        if m == "2026-10":
            for day in range(1, 27, 3):
                flow(d(day), rnd.uniform(15, 40), "expense", "餐饮食品·三餐", *rnd.choice(eat), source="wechat")
            continue
        batch = None
        if m == "2026-09":
            batch = conn.execute("INSERT INTO batches(created,files,count,backup) VALUES (?,?,?,?)", (
                "2026-10-05 20:31:00", json.dumps([
                    {"name": "支付宝交易明细 2026-09.csv", "source": "alipay", "count": 189},
                    {"name": "微信支付账单 2026-09.xlsx", "source": "wechat", "count": 64},
                    {"name": "农行信用卡 9 月对账单.pdf", "source": "abc", "count": 22}], ensure_ascii=False),
                0, "")).lastrowid
            demo_batch = batch
        perf = 18000 if m == "2026-02" else rnd.choice([5200, 5600, 5800, 6000, 6200, 6400])
        tax = 9620 if m == "2026-02" else round(1100 + rnd.random() * 650, -1)
        tag = "复制自 %d 月" % int(reports.month_add(m, -1)[5:]) if m >= "2026-01" else ""
        flow(d(15), 24000, "income", "工资收入·基本工资", "某某科技有限公司", f"{int(m[5:])} 月基本工资", "copy", tag)
        flow(d(15), perf, "income", "工资收入·绩效工资", "某某科技有限公司", f"{int(m[5:])} 月绩效工资", "copy", tag)
        if m == "2026-02":
            flow(d(10), 40000, "income", "工资收入·年终奖", "某某科技有限公司", "2025 年终奖", "manual")
        flow(d(15), 2100, "expense", "工资减扣·社保", "社会保险", "个人缴纳", "copy", tag)
        flow(d(15), 1800, "expense", "工资减扣·公积金", "住房公积金", "个人缴存", "copy", tag)
        flow(d(15), tax, "expense", "工资减扣·个人所得税", "个人所得税", "预扣", "copy", tag)
        for day in (10, 20, 30):
            flow(d(day), rnd.uniform(52, 58), "income", "投资收益·利息", "余额宝", "收益发放", batch=batch)
        flow(d(27), 4200, "expense", "住房物业·房租", "房东 王先生", f"{int(reports.month_add(m, 1)[5:])} 月房租", "wechat", batch=batch)
        flow(d(5), 120, "expense", "住房物业·网络费", "中国电信", "宽带", batch=batch)
        flow(d(8), rnd.uniform(180, 300), "expense", "住房物业·水电费", "国家电网", "电费", batch=batch)
        for _ in range(rnd.randint(28, 36)):
            flow(d(rnd.randint(1, 28)), rnd.uniform(18, 75), "expense", "餐饮食品·三餐", *rnd.choice(eat), source=rnd.choice(["alipay", "wechat"]), batch=batch)
        for _ in range(rnd.randint(18, 26)):
            flow(d(rnd.randint(1, 28)), rnd.uniform(25, 52), "expense", "餐饮食品·外卖", *rnd.choice(take), source="wechat", batch=batch)
        for _ in range(rnd.randint(1, 3)):
            flow(d(rnd.randint(1, 28)), rnd.uniform(150, 360), "expense", "餐饮食品·外出聚餐", "深圳市百事德餐饮", "堂食 2 人", batch=batch)
        for _ in range(rnd.randint(6, 10)):
            flow(d(rnd.randint(1, 28)), rnd.uniform(12, 38), "expense", "餐饮食品·饮料零食", "瑞幸咖啡", "生椰拿铁", source="wechat", batch=batch)
        for _ in range(rnd.randint(12, 18)):
            flow(d(rnd.randint(1, 28)), rnd.choice([4, 5, 6, 7]), "expense", "交通出行·地铁", "深圳地铁", "乘车", source="wechat", batch=batch)
        for _ in range(rnd.randint(3, 8)):
            flow(d(rnd.randint(1, 28)), rnd.uniform(18, 60), "expense", "交通出行·打车", "滴滴出行", "快车", batch=batch)
        if rnd.random() < 0.5:
            flow(d(rnd.randint(1, 28)), rnd.uniform(300, 560), "expense", "交通出行·高铁", "中国铁路 12306", "深圳北—广州南", batch=batch)
        if m in ("2025-02", "2026-02", "2025-10"):
            flow(d(3), rnd.uniform(1100, 1700), "expense", "交通出行·飞机", "携程旅行", "机票", batch=batch)
        for _ in range(rnd.randint(2, 6)):
            flow(d(rnd.randint(1, 28)), rnd.uniform(40, 260), "expense", "实体商品·日用百货", "盒马鲜生", "日用品", batch=batch)
        if rnd.random() < 0.6:
            flow(d(rnd.randint(1, 28)), rnd.uniform(160, 900), "expense", "实体商品·服饰装扮", "某电商旗舰店", "衣服", batch=batch)
        if m in ("2025-06", "2026-06"):
            flow(d(18), 6999, "expense", "实体商品·电子产品", "Apple Store", "iPad Air", source="abc", batch=batch)
        flow(d(28), 145, "expense", "数字订阅·AI 与开发", "OPENAI *CHATGPT", "ChatGPT Plus", "abc", batch=batch)
        flow(d(12), rnd.choice([110, 145, 150]), "expense", "数字订阅·AI 与开发", "ANTHROPIC", "Claude Pro", "abc", batch=batch)
        flow(d(24), 11, "expense", "数字订阅·影音娱乐", "App Store", "Apple Music 会员月费", batch=batch)
        flow(d(min(31, last)), 21, "expense", "数字订阅·工具与云服务", "iCloud", "200GB 月费", batch=batch)
        flow(d(6), 58, "expense", "生活服务·话费", "中国移动", "话费充值", batch=batch)
        if rnd.random() < 0.7:
            flow(d(rnd.randint(1, 28)), 88, "expense", "生活服务·理发", "楼下理发店", "剪发", "manual")
        if rnd.random() < 0.6:
            flow(d(rnd.randint(1, 28)), rnd.uniform(40, 320), "expense", "健康保障·医疗" if rnd.random() < 0.5 else "健康保障·药品", "大参林药房", "药品", batch=batch)
        if rnd.random() < 0.4:
            flow(d(rnd.randint(1, 28)), rnd.choice([200, 500, 800]), "expense", "其他消费·人情往来", "微信红包", "红包", "wechat", batch=batch)
        flow(d(rnd.randint(1, 28)), rnd.uniform(5, 40), "expense", "其他消费·利息与手续费", "花呗", "分期利息", batch=batch)
        flow(d(25), rnd.uniform(900, 2200), "transfer", None, "花呗", f"{int(m[5:])} 月账单还款", batch=batch)
        flow(d(16), rnd.choice([2000, 3000, 5000]), "transfer", None, "余额宝", "转入", batch=batch)
        if m == "2026-09":
            flow(d(26), 69, "expense", "其他消费·???", "ALIPAY*HZ 某某科技", "", "abc", batch=batch)
            flow(d(20), -129, "expense", "实体商品·服饰装扮", "某电商旗舰店", "退款 · 风衣", batch=batch)
            flow(d(14), 2000, "transfer", None, "张三", "微信转账", "wechat", batch=batch)
        if batch:
            n = conn.execute("SELECT COUNT(*) FROM flows WHERE batch_id=?", (batch,)).fetchone()[0]
            conn.execute("UPDATE batches SET count=? WHERE id=?", (n, batch))
    ledger.regenerate_auto_flows(conn)
    conn.commit()

    # ---------- 快照 ----------
    final = {"hs300": 4.105, "gold": 6.884, "tencent": 598.5, "cmb": 36.0, "efd": 1.6672, "tracker": 26.38,
             "voo": 589.10, "btc": 121400, "eth": 3980, "doge": 0.21}
    start = {"hs300": 3.75, "gold": 5.0, "tencent": 380, "cmb": 31, "efd": 1.5, "tracker": 18.4,
             "voo": 520, "btc": 95000, "eth": 3300, "doge": 0.33}
    all_months = list(months("2025-01", "2026-09"))
    n = len(all_months)
    keys = {v: k for k, v in I.items()}
    bal = {"招商银行 活期": 52000, "余额宝": 70000, "微信 零钱通": 6000, "公积金 个人账户": 36000, "饰品 UUYP": 7200,
           "支付宝 债券型基金": 38000, "借款 · 张三": 0, "ZA Bank HKD": 60000, "ZA Bank USD": 900,
           "中国银行 美元货币基金": 2000, "OKX 活期 USDT": 150, "Binance 活期 USDT": 100}
    target = {"招商银行 活期": 103249.35, "余额宝": 86993.00, "微信 零钱通": 7650.00, "公积金 个人账户": 61461.00,
              "饰品 UUYP": 8600.00, "支付宝 债券型基金": 42000.00, "ZA Bank HKD": 109644.37, "ZA Bank USD": 1275.86}
    for i, m in enumerate(all_months):
        t = i / (n - 1)
        if m == "2025-04":
            continue
        rates = {"USD": round(7.30 - 0.18 * t + rnd.uniform(-0.03, 0.03), 4),
                 "HKD": round(0.935 - 0.02 * t + rnd.uniform(-0.004, 0.004), 4)}
        if m == "2026-09":
            rates = {"USD": 7.1182, "HKD": 0.9150}
        nm = reports.month_add(m, 1)
        conn.execute("INSERT INTO snapshots(month,date,rates,rate_note,created,updated) VALUES (?,?,?,?,?,?)",
                     (m, f"{nm}-05", json.dumps(rates), f"{nm[5:]}.05 21:40 取自 open.er-api.com", ts, ts))
        for name, aid in manual.items():
            if name in target:
                v = bal[name] + (target[name] - bal[name]) * t + (rnd.uniform(-0.02, 0.02) * target[name] if m != "2026-09" else 0)
            elif name == "借款 · 张三":
                v = 5000 if m >= "2026-03" else 0
            elif name == "中国银行 美元货币基金":
                v = 1000 if m == "2026-09" else 2000
            elif name == "OKX 活期 USDT":
                v = 78.18 if m == "2026-09" else 150
            else:
                v = bal[name]
            conn.execute("INSERT INTO snap_balances(month,account_id,balance) VALUES (?,?,?)", (m, aid, round(v, 2)))
        insts, pos = ledger.holdings_at(conn, reports.month_end(m))
        for iid, p in pos.items():
            if p["qty"] <= 1e-9:
                continue
            k = keys[iid]
            price = final[k] if m == "2026-09" else start[k] + (final[k] - start[k]) * t * (1 + rnd.uniform(-0.06, 0.06))
            conn.execute("INSERT INTO snap_positions(month,instrument_id,qty,price,cost,price_note) VALUES (?,?,?,?,?,?)",
                         (m, iid, p["qty"], round(price, 4), round(p["cost"], 2), "09.30 收盘" if m == "2026-09" else ""))
    conn.commit()
    # 「导入前备份」：等同于现在的数据去掉 9 月那次导入
    bpath = backup.create("import")
    b = db.connect(bpath)
    b.execute("DELETE FROM flows WHERE batch_id=?", (demo_batch,))
    b.execute("DELETE FROM batches WHERE id=?", (demo_batch,))
    b.commit()
    b.close()
    conn.execute("UPDATE batches SET backup=? WHERE id=?", (str(bpath), demo_batch))
    conn.commit()
    conn.close()
    print(f"演示数据已写入 {config.DB_PATH}")


if __name__ == "__main__":
    main()
