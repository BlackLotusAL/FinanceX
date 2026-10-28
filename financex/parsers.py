"""账单解析：支付宝 CSV（GBK）、微信 xlsx、农行信用卡 PDF。

每个解析器返回统一的行：
  source, date (YYYY-MM-DD), time, merchant, description, amount, type,
  order_no, status, skipped, skip_reason, raw
amount 为人民币：收入 / 支出为正数，退款为负数支出，转账为正数。
"""
import csv
import hashlib
import io
import re
import zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

SOURCE_NAMES = {"alipay": "支付宝", "wechat": "微信", "abc": "农行信用卡",
                "manual": "手动", "copy": "手动", "sell": "卖出", "fx": "结汇"}


class ParseError(Exception):
    pass


def detect(filename):
    name = filename.lower()
    if name.endswith(".csv"):
        return "alipay"
    if name.endswith(".xlsx"):
        return "wechat"
    if name.endswith(".pdf"):
        return "abc"
    raise ParseError(f"不认识的文件格式：{filename}（只接收支付宝 CSV、微信 xlsx、农行信用卡 PDF）")


def parse(filename, data):
    kind = detect(filename)
    if kind == "alipay":
        return kind, parse_alipay(data)
    if kind == "wechat":
        return kind, parse_wechat(data)
    return kind, parse_abc(data)


def _clean(v):
    if v is None:
        return ""
    return str(v).replace("\t", "").replace("　", " ").strip()


def _money(v):
    s = _clean(v).replace("¥", "").replace("￥", "").replace(",", "").replace("元", "")
    if not s or s in ("/", "-"):
        return 0.0
    return float(s)


def _date_time(v):
    s = _clean(v)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M",
                "%Y-%m-%d", "%Y/%m/%d"):
        try:
            d = datetime.strptime(s, fmt)
            return d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S")
        except ValueError:
            pass
    try:  # Excel 序列日期
        f = float(s)
        d = datetime(1899, 12, 30) + timedelta(days=f)
        return d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S")
    except ValueError:
        raise ParseError(f"无法识别的日期：{s}")


def _row(source, date, time, merchant, desc, amount, typ, order_no, status, raw,
         skipped=False, reason=""):
    return {"source": source, "date": date, "time": time, "merchant": merchant or desc or "—",
            "description": desc, "amount": round(amount, 2), "type": typ,
            "order_no": order_no, "status": status, "skipped": skipped,
            "skip_reason": reason, "raw": raw}


# ---------- 支付宝 ----------

def _decode(data):
    # GBK 字节几乎不可能是合法 UTF-8，所以先严格按 UTF-8 试，避免把 UTF-8 误解成 GBK 乱码
    for enc in ("utf-8-sig", "gbk", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    raise ParseError("支付宝账单编码无法识别（应为 GBK）")


def parse_alipay(data):
    text = _decode(data)
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if "交易对方" in line and ("交易时间" in line or "交易创建时间" in line):
            start = i
            break
    if start is None:
        raise ParseError("没有找到支付宝账单的表头（交易时间 / 交易对方）")
    body = []
    for line in lines[start:]:
        if line.startswith("---") or line.startswith("===="):
            break
        body.append(line)
    reader = csv.reader(io.StringIO("\n".join(body)))
    header = [_clean(h) for h in next(reader)]
    idx = {h: i for i, h in enumerate(header)}

    def col(r, *names):
        for n in names:
            if n in idx and idx[n] < len(r):
                return _clean(r[idx[n]])
        return ""

    out = []
    for r in reader:
        if not any(_clean(x) for x in r):
            continue
        raw = {h: _clean(r[i]) if i < len(r) else "" for h, i in idx.items()}
        date, time = _date_time(col(r, "交易时间", "交易创建时间", "付款时间"))
        merchant = col(r, "交易对方")
        desc = col(r, "商品说明", "商品名称")
        io_ = col(r, "收/支")
        status = col(r, "交易状态")
        amount = _money(col(r, "金额", "金额（元）"))
        order = col(r, "交易订单号", "交易号")
        if "交易关闭" in status:
            out.append(_row("alipay", date, time, merchant, desc, amount, "expense", order, status,
                            raw, True, "交易关闭"))
            continue
        refund = "退款" in status or desc.startswith("退款")
        if refund:
            typ, amount, order = "expense", -abs(amount), f"{order}#R"
        elif io_ == "支出":
            typ = "expense"
        elif io_ == "收入":
            typ = "income"
        else:
            typ = "transfer"
        out.append(_row("alipay", date, time, merchant, desc, abs(amount) if not refund else amount,
                        typ, order, status, raw))
    return out


# ---------- 微信 ----------

def read_xlsx(data):
    """极简 xlsx 读取：返回第一个工作表的二维列表。"""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
          "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ParseError("微信账单不是有效的 xlsx 文件")
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    first = wb.find("m:sheets/m:sheet", ns)
    rid = first.get(f"{{{ns['r']}}}id")
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = None
    for rel in rels:
        if rel.get("Id") == rid:
            target = rel.get("Target")
    target = target.lstrip("/")
    if not target.startswith("xl/"):
        target = "xl/" + target
    sheet = ET.fromstring(z.read(target))
    table = []
    for row in sheet.iter(f"{{{ns['m']}}}row"):
        cells = {}
        for c in row.findall("m:c", ns):
            ref = c.get("r", "")
            letters = re.match(r"[A-Z]+", ref)
            ci = 0
            if letters:
                for ch in letters.group(0):
                    ci = ci * 26 + (ord(ch) - 64)
                ci -= 1
            else:
                ci = len(cells)
            t = c.get("t")
            v = c.find("m:v", ns)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{ns['m']}}}t"))
            else:
                val = v.text if v is not None else ""
            cells[ci] = val
        if cells:
            table.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return table


def parse_wechat(data):
    table = read_xlsx(data)
    start = None
    for i, r in enumerate(table):
        cells = [_clean(x) for x in r]
        if "交易时间" in cells and "交易对方" in cells:
            start = i
            break
    if start is None:
        raise ParseError("没有找到微信账单的表头（交易时间 / 交易对方）")
    header = [_clean(h) for h in table[start]]
    idx = {h: i for i, h in enumerate(header) if h}

    def col(r, *names):
        for n in names:
            if n in idx and idx[n] < len(r):
                return _clean(r[idx[n]])
        return ""

    out = []
    for r in table[start + 1:]:
        if not any(_clean(x) for x in r):
            continue
        raw = {h: _clean(r[i]) if i < len(r) else "" for h, i in idx.items()}
        date, time = _date_time(col(r, "交易时间"))
        ttype = col(r, "交易类型")
        merchant = col(r, "交易对方")
        desc = col(r, "商品")
        io_ = col(r, "收/支")
        status = col(r, "当前状态")
        amount = abs(_money(col(r, "金额(元)", "金额（元）", "金额")))
        order = col(r, "交易单号")
        if "关闭" in status or "已撤销" in status:
            out.append(_row("wechat", date, time, merchant, desc, amount, "expense", order, status,
                            raw, True, "交易关闭"))
            continue
        if "退款" in ttype:
            out.append(_row("wechat", date, time, merchant, desc or ttype, -amount, "expense",
                            f"{order}#R", status, raw))
            continue
        if ttype == "转账" or io_ in ("/", "", "不计收支"):
            typ = "transfer"
        elif io_ == "支出":
            typ = "expense"
        else:
            typ = "income"
        out.append(_row("wechat", date, time, merchant, desc or ttype, amount, typ, order, status, raw))
    return out


# ---------- 农行信用卡 ----------

_D = r"(?:\d{8}|\d{6}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})"
_AMT = r"[-+]?[\d,]+\.\d{2}"
_LINE = re.compile(
    rf"^(?P<d1>{_D})\s+(?:(?P<d2>{_D})\s+)?(?:(?P<card>\d{{4}})\s+)?(?P<body>.+?)\s+"
    rf"(?P<a1>{_AMT})(?:\s*/\s*(?P<c1>[A-Z]{{3}}))?"
    rf"(?:\s+(?P<a2>{_AMT})(?:\s*/\s*(?P<c2>[A-Z]{{3}}))?)?\s*$")


def _abc_date(s, year_hint, month_hint):
    s = s.replace("/", "-").replace(".", "-")
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    if re.fullmatch(r"\d{6}", s):
        return f"20{s[:2]}-{s[2:4]}-{s[4:]}"
    parts = s.split("-")
    if len(parts) == 3:
        return f"{int(parts[0]):04d}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    m, d = int(parts[0]), int(parts[1])
    y = year_hint
    if month_hint and m > month_hint:
        y -= 1
    return f"{y:04d}-{m:02d}-{d:02d}"


def _pdf_text(data):
    try:
        import pdfplumber
    except ImportError:
        raise ParseError("解析 PDF 需要 pdfplumber，请运行 start.bat 自动安装依赖")
    lines = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            lines.extend((page.extract_text() or "").splitlines())
    return lines


def parse_abc(data, lines=None):
    lines = lines if lines is not None else _pdf_text(data)
    text = "\n".join(lines)
    year_hint, month_hint = datetime.now().year, None
    m = re.search(r"(?:账单日|Statement Date)[^\d]*(\d{4})[年\-/.](\d{1,2})", text)
    if not m:
        m = re.search(r"(\d{4})年(\d{1,2})月", text)
    if m:
        year_hint, month_hint = int(m.group(1)), int(m.group(2))

    matched = []
    for line in lines:
        line = " ".join(line.split())
        mm = _LINE.match(line)
        if not mm:
            continue
        body = mm.group("body")
        if re.search(r"(本期|上期|最低|合计|应还|额度)", body):
            continue
        amt_s = mm.group("a2") or mm.group("a1")
        matched.append((mm, line, float(amt_s.replace(",", ""))))
    if not matched:
        raise ParseError("没有在 PDF 里识别到交易行。请确认是农行信用卡电子对账单。")

    # 农行对账单「支出为 -」；若多数消费为正数，则按「支出为正」处理
    non_repay = [a for mm, _, a in matched if "还款" not in mm.group("body")]
    spend_negative = sum(1 for a in non_repay if a < 0) >= sum(1 for a in non_repay if a > 0)

    out, seen = [], {}
    for mm, line, amt in matched:
        body = mm.group("body")
        parts = body.split(" ", 1)
        summary, merchant = (parts[0], parts[1]) if len(parts) == 2 else (body, body)
        date = _abc_date(mm.group("d1"), year_hint, month_hint)
        spend = (amt < 0) if spend_negative else (amt > 0)
        if "还款" in body:
            typ, amount = "transfer", abs(amt)
        elif spend and not re.search(r"(退货|退款)", body):
            typ, amount = "expense", abs(amt)
        else:
            typ, amount = "expense", -abs(amt)
        key = f"{date}|{mm.group('d2')}|{mm.group('card')}|{body}|{amt}"
        seen[key] = seen.get(key, 0) + 1
        order = "ABC" + hashlib.sha1(f"{key}#{seen[key]}".encode()).hexdigest()[:16]
        raw = {"原始行": line, "交易摘要": summary, "卡号末四位": mm.group("card") or ""}
        out.append(_row("abc", date, "", merchant, summary, amount, typ, order, "", raw))
    return out
