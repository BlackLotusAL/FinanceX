"""核心记账规则测试：用 PRD 中的算例校验。运行：python -m unittest discover tests"""
import base64
import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["FINANCEX_DB"] = str(Path(_tmp) / "test.db")

from financex import config, db, importer, ledger, parsers, reports  # noqa: E402
from financex import server  # noqa: E402


_n = [0]


def fresh():
    _n[0] += 1
    config.DB_PATH = Path(_tmp) / f"test{_n[0]}.db"
    conn = db.connect()
    db.init(conn)
    return conn


def cat(conn, l1, name):
    return db.category_id(conn, l1, name)


def add_flow(conn, date, amount, typ, l1=None, name=None, merchant="", source="manual"):
    cid = cat(conn, l1, name) if l1 else None
    conn.execute("INSERT INTO flows(date,amount,type,category_id,source,merchant) VALUES (?,?,?,?,?,?)",
                 (date, amount, typ, cid, source, merchant))


def account(conn, name, kind="manual", currency="CNY"):
    return server.account_create(conn, {}, {"name": name, "kind": kind, "currency": currency})["id"]


def instrument(conn, code, name, currency="CNY", category="stock", acc=None, connect=False):
    acc = acc or account(conn, "券商", "investment", "CRYPTO" if currency == "USDT" else currency)
    return server.inst_create(conn, {}, {"code": code, "name": name, "category": category,
                                         "currency": currency, "account_id": acc, "connect": connect})["id"]


def trade(conn, kind, date, qty, amount, inst=None, currency=None, opening=False):
    return server.trade_create(conn, {}, {"kind": kind, "date": date, "qty": qty, "amount": amount,
                                          "instrument_id": inst, "currency": currency, "opening": opening})["id"]


class FxExample(unittest.TestCase):
    def test_prd_fx_example(self):
        """1 万元购入 1,400 美元，300 美元结汇得 2,190 元，汇兑损益 ≈ 47。"""
        conn = fresh()
        trade(conn, "fx_buy", "2026-09-01", 1400, 10000, currency="USD")
        trade(conn, "fx_sell", "2026-09-22", 300, 2190, currency="USD")
        _, _, fx, res = ledger.replay(conn)
        self.assertAlmostEqual(fx["USD"]["avg"], 10000 / 1400)
        self.assertAlmostEqual(fx["USD"]["bal"], 1100)
        sell = [r for r in res.values() if r["pnl"] is not None][0]
        self.assertAlmostEqual(sell["pnl"], 2190 - 300 * 10000 / 1400)
        self.assertAlmostEqual(round(sell["pnl"], 2), 47.14)
        self.assertAlmostEqual(round(sell["principal"] + sell["pnl"], 2), 2190)
        flows = db.rows(conn.execute("SELECT * FROM flows WHERE source='fx'"))
        self.assertEqual(len(flows), 1)
        self.assertEqual(flows[0]["amount"], 47.14)
        cf = reports.cash_flow(conn, "2026")
        self.assertAlmostEqual(cf["rows"][8]["inv"], round(10000 - 2142.857142857, 2), places=2)

    def test_fx_sell_beyond_balance(self):
        conn = fresh()
        trade(conn, "fx_buy", "2026-01-01", 100, 720, currency="USD")
        trade(conn, "fx_sell", "2026-02-01", 150, 1080, currency="USD")
        _, _, fx, res = ledger.replay(conn)
        self.assertEqual(fx["USD"]["bal"], 0)
        sell = [r for r in res.values() if r["pnl"] is not None][0]
        self.assertAlmostEqual(sell["principal"], 720)
        self.assertAlmostEqual(sell["pnl"], 360)

    def test_fx_buy_moving_average(self):
        conn = fresh()
        trade(conn, "fx_buy", "2026-01-01", 1000, 7000, currency="USD", opening=True)
        trade(conn, "fx_buy", "2026-02-01", 1000, 7400, currency="USD")
        _, _, fx, res = ledger.replay(conn)
        self.assertAlmostEqual(fx["USD"]["avg"], 7.2)
        cf = reports.cash_flow(conn, "2026")
        self.assertEqual(cf["rows"][0]["inv"], 0)  # 期初不计
        self.assertEqual(cf["rows"][1]["inv"], 7400)


class MonthlyExample(unittest.TestCase):
    def test_prd_monthly_example(self):
        """结余 10,600，投资净投入 9,143。"""
        conn = fresh()
        m = "2026-09"
        add_flow(conn, f"{m}-15", 20000, "income", "工资收入", "基本工资")
        add_flow(conn, f"{m}-15", 4000, "expense", "工资减扣", "社保")
        add_flow(conn, f"{m}-16", 6000, "expense", "餐饮食品", "三餐")
        add_flow(conn, f"{m}-20", 2000, "transfer", merchant="借款 · 张三")
        a = instrument(conn, "600036", "招商银行")
        b = instrument(conn, "600519", "某 A 股")
        trade(conn, "buy", "2026-01-05", 100, 3000, inst=a, opening=True)
        trade(conn, "buy", f"{m}-03", 100, 5000, inst=b)
        trade(conn, "sell", f"{m}-12", 100, 3600, inst=a)
        trade(conn, "fx_buy", f"{m}-18", 1000, 7143, currency="USD")
        conn.commit()
        flows = ledger.month_flows(conn, m)
        s = ledger.summarize(flows)
        self.assertEqual(s["balance"], 10600)
        self.assertEqual(s["deduct"], 4000)
        self.assertEqual(s["consume"], 6000)
        cf = reports.cash_flow(conn, "2026")
        sept = [r for r in cf["rows"] if r["month"] == 9][0]
        self.assertEqual(sept["balance"], 10600)
        self.assertEqual(sept["inv"], 9143)
        realized = [f for f in flows if f["source"] == "sell"]
        self.assertEqual(realized[0]["amount"], 600)

    def test_foreign_instrument_sell_no_flow(self):
        conn = fresh()
        i = instrument(conn, "VOO", "标普500 ETF", currency="USD", category="etf")
        trade(conn, "buy", "2026-01-05", 10, 5000, inst=i)
        trade(conn, "sell", "2026-03-05", 5, 3000, inst=i)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM flows").fetchone()[0], 0)
        h = reports.holdings(conn)
        item = h["accounts"][0]["items"][0]
        self.assertAlmostEqual(item["realized"], 500)
        self.assertEqual(h["realized_all"], 0)  # 外币标的不计入人民币合计
        cf = reports.cash_flow(conn, "2026")
        self.assertTrue(all(r["inv"] == 0 for r in cf["rows"]))

    def test_connect_counts_as_cny(self):
        conn = fresh()
        i = instrument(conn, "00700", "腾讯控股 · 港股通", currency="HKD", connect=True)
        trade(conn, "buy", "2026-01-05", 100, 30000, inst=i)
        trade(conn, "sell", "2026-02-05", 50, 18000, inst=i)
        flows = db.rows(conn.execute("SELECT * FROM flows"))
        self.assertEqual(flows[0]["amount"], 3000)
        cf = reports.cash_flow(conn, "2026")
        self.assertEqual(cf["rows"][0]["inv"], 30000)
        self.assertEqual(cf["rows"][1]["inv"], -15000)

    def test_savings_rate_hidden_without_salary(self):
        conn = fresh()
        add_flow(conn, "2026-09-01", 100, "income", "投资收益", "利息")
        s = ledger.summarize(ledger.month_flows(conn, "2026-09"))
        self.assertIsNone(s["rate"])


class Snapshot(unittest.TestCase):
    def test_snapshot_values_and_overview(self):
        conn = fresh()
        cny = account(conn, "招商银行 活期")
        hkd = account(conn, "ZA Bank HKD", currency="HKD")
        okx = account(conn, "OKX 活期 USDT", currency="CRYPTO")
        loan = account(conn, "借入 · 家里")
        i = instrument(conn, "BTC-USDT", "BTC", currency="USDT", category="crypto")
        trade(conn, "buy", "2026-08-01", 0.1, 5000, inst=i)
        for month, v in (("2025-12", 1000), ("2026-08", 2000), ("2026-09", 3000)):
            reports.save_stocktake(conn, {
                "month": month, "date": f"{month}-28", "rates": {"USD": 7, "HKD": 0.9},
                "balances": [{"account_id": cny, "balance": v}, {"account_id": hkd, "balance": 1000},
                             {"account_id": okx, "balance": 10}, {"account_id": loan, "balance": -500}],
                "positions": [{"instrument_id": i, "qty": 0.1, "price": 60000, "cost": 5000}],
            }, lambda k: None)
        d = reports.snapshot_detail(conn, "2026-09")
        self.assertAlmostEqual(d["net"], 3000 - 500 + 900 + 70 + 0.1 * 60000 * 7)
        pos = d["groups"][3]["items"][-1]
        self.assertAlmostEqual(pos["pnl"], 6000 - 5000)  # USDT 原币
        ov = reports.overview(conn)
        self.assertEqual(ov["month"], "2026-09")
        self.assertEqual(ov["prev"]["month"], "2026-08")
        self.assertEqual(ov["base"]["month"], "2025-12")
        self.assertEqual(len(ov["series"]), 10)
        self.assertIsNone(ov["series"][1]["net"])  # 缺月留空

    def test_stocktake_positions_use_month_end(self):
        conn = fresh()
        i = instrument(conn, "510300", "沪深300ETF", category="etf")
        trade(conn, "buy", "2026-09-10", 100, 400, inst=i)
        trade(conn, "buy", "2026-10-02", 100, 410, inst=i)
        st = reports.stocktake(conn, "2026-09")
        self.assertEqual(st["positions"][0]["qty"], 100)


class Parsers(unittest.TestCase):
    def test_alipay(self):
        csv_text = (
            "支付宝交易明细\n导出时间：2026-10-05\n"
            "------------------------支付宝（中国）网络技术有限公司  电子客户回单------------------------\n"
            "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,\n"
            "2026-09-29 19:02:11,餐饮美食,深圳市百事德餐饮,xxx,堂食 2 人,支出,186.00,花呗,交易成功,2026092900001\t,M1\t,,\n"
            "2026-09-20 10:00:00,服饰装扮,某电商旗舰店,xxx,退款-风衣,不计收支,129.00,余额宝,退款成功,2026092000002\t,,,\n"
            "2026-09-11 10:00:00,服饰装扮,某电商旗舰店,xxx,风衣,支出,129.00,余额宝,交易关闭,2026091100003\t,,,\n"
            "2026-09-25 10:00:00,信用借还,花呗,xxx,9 月账单还款,不计收支,1486.20,余额宝,还款成功,2026092500004\t,,,\n"
            "2026-09-30 03:00:00,投资理财,余额宝,xxx,收益发放,收入,12.84,,交易成功,2026093000005\t,,,\n"
        )
        rows = parsers.parse_alipay(csv_text.encode("gbk"))
        self.assertEqual(len(rows), 5)
        by = {r["order_no"]: r for r in rows}
        self.assertEqual(by["2026092900001"]["type"], "expense")
        self.assertEqual(by["2026092900001"]["amount"], 186.0)
        self.assertEqual(by["2026092000002#R"]["amount"], -129.0)
        self.assertTrue(by["2026091100003"]["skipped"])
        self.assertEqual(by["2026092500004"]["type"], "transfer")
        self.assertEqual(by["2026093000005"]["type"], "income")

    def test_wechat(self):
        data = make_xlsx([
            ["微信支付账单明细"], ["微信昵称：[x]"], [],
            ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注"],
            ["2026-09-18 12:30:00", "商户消费", "美团外卖", "黄焖鸡米饭", "支出", "¥32.50", "零钱", "支付成功", "4200001", "M2", "/"],
            ["2026-09-14 09:00:00", "转账", "张三", "微信转账", "支出", "¥2,000.00", "零钱", "对方已收钱", "1000002", "/", "/"],
            ["2026-09-19 09:00:00", "美团外卖-退款", "美团外卖", "退款", "收入", "¥10.00", "零钱", "已全额退款", "4200003", "/", "/"],
            ["2026-09-20 09:00:00", "零钱提现", "招商银行", "/", "/", "¥100.00", "零钱", "提现已到账", "4200004", "/", "/"],
        ])
        rows = parsers.parse_wechat(data)
        self.assertEqual([r["type"] for r in rows], ["expense", "transfer", "expense", "transfer"])
        self.assertEqual(rows[0]["amount"], 32.5)
        self.assertEqual(rows[1]["amount"], 2000)
        self.assertEqual(rows[2]["amount"], -10)

    def test_abc_lines(self):
        lines = [
            "中国农业银行信用卡对账单 账单日 2026年10月03日",
            "交易日 入账日 卡号末四位 交易摘要 交易地点 交易金额/币种 入账金额/币种(支出为-)",
            "260929 260930 1234 消费 支付宝-深圳市百事德餐饮 -186.00/CNY -186.00/CNY",
            "260928 260929 1234 消费 OPENAI *CHATGPT -20.00/USD -145.00/CNY",
            "260925 260925 1234 还款 手机银行还款 3,000.00/CNY 3,000.00/CNY",
            "260920 260921 1234 退货 某电商 129.00/CNY 129.00/CNY",
            "本期应还金额 1,234.00",
        ]
        rows = parsers.parse_abc(b"", lines=lines)
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]["date"], "2026-09-29")
        self.assertEqual(rows[0]["merchant"], "支付宝-深圳市百事德餐饮")
        self.assertEqual((rows[0]["type"], rows[0]["amount"]), ("expense", 186.0))
        self.assertEqual(rows[1]["amount"], 145.0)
        self.assertEqual(rows[2]["type"], "transfer")
        self.assertEqual(rows[3]["amount"], -129.0)
        again = parsers.parse_abc(b"", lines=lines)
        self.assertEqual([r["order_no"] for r in rows], [r["order_no"] for r in again])


class Import(unittest.TestCase):
    def test_duplicate_and_suspect_and_prefill(self):
        conn = fresh()
        add_flow(conn, "2026-08-27", 4200, "expense", "住房物业", "房租", merchant="房东 王先生")
        conn.commit()
        alipay = ("交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注\n"
                  "2026-09-29 19:02:11,餐饮,深圳市百事德餐饮,x,堂食,支出,186.00,花呗,交易成功,A1,,\n"
                  "2026-09-27 19:02:11,转账,房东 王先生,x,房租,支出,4200.00,余额,交易成功,A2,,\n").encode("gbk")
        files = [{"name": "alipay.csv", "data": base64.b64encode(alipay).decode()}]
        pv = importer.preview(conn, files)
        rows = pv["rows"]
        self.assertEqual(len(rows), 2)
        rent = [r for r in rows if r["order_no"] == "A2"][0]
        self.assertTrue(rent["prefilled"])
        self.assertEqual(rent["category_id"], cat(conn, "住房物业", "房租"))
        for r in rows:
            if not r["category_id"]:
                r["category_id"] = cat(conn, "餐饮食品", "外出聚餐")
        res = importer.confirm(conn, pv["files"], [r for r in rows if r["checked"]])
        self.assertEqual(res["count"], 2)
        pv2 = importer.preview(conn, files)
        self.assertTrue(all(r["state"] == "duplicate" for r in pv2["rows"]))
        # 信用卡同额、日期差 1 天 → 疑似重复，默认不导入
        lines = ["260930 260930 1234 消费 支付宝-深圳市百事德餐饮 -186.00/CNY -186.00/CNY",
                 "260930 260930 1234 消费 美团 -32.00/CNY -32.00/CNY"]
        orig = parsers._pdf_text
        parsers._pdf_text = lambda data: lines
        try:
            pv3 = importer.preview(conn, [{"name": "abc.pdf", "data": base64.b64encode(b"x").decode()}])
        finally:
            parsers._pdf_text = orig
        states = [(r["amount"], r["state"], r["checked"]) for r in pv3["rows"]]
        self.assertEqual(states, [(186.0, "suspect_drop", False), (32.0, "ok", True)])

    def test_suspect_within_batch(self):
        conn = fresh()
        alipay = ("交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注\n"
                  "2026-09-29 19:02:11,餐饮,深圳市百事德餐饮,x,堂食,支出,186.00,花呗,交易成功,A1,,\n").encode("gbk")
        lines = ["260930 260930 1234 消费 支付宝-深圳市百事德餐饮 -186.00/CNY -186.00/CNY"]
        orig = parsers._pdf_text
        parsers._pdf_text = lambda data: lines
        try:
            pv = importer.preview(conn, [
                {"name": "a.csv", "data": base64.b64encode(alipay).decode()},
                {"name": "c.pdf", "data": base64.b64encode(b"x").decode()}])
        finally:
            parsers._pdf_text = orig
        st = {r["source"]: (r["state"], r["checked"], r["pair"]) for r in pv["rows"]}
        self.assertEqual(st["alipay"], ("suspect_keep", True, 1))
        self.assertEqual(st["abc"], ("suspect_drop", False, 0))


def make_xlsx(rows):
    shared, idx = [], {}

    def si(v):
        if v not in idx:
            idx[v] = len(shared)
            shared.append(v)
        return idx[v]

    def col(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    sheet_rows = []
    for ri, r in enumerate(rows, 1):
        cells = "".join(f'<c r="{col(ci)}{ri}" t="s"><v>{si(str(v))}</v></c>' for ci, v in enumerate(r))
        sheet_rows.append(f'<row r="{ri}">{cells}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    from xml.sax.saxutils import escape
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rns}><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml",
                   f'<sst {ns}>' + "".join(f"<si><t>{escape(s)}</t></si>" for s in shared) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>')
    return buf.getvalue()


if __name__ == "__main__":
    unittest.main()
