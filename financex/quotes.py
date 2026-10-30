"""行情与汇率（公开接口，请求里只有标的代码与币种）。

- A 股 / 场内 ETF / 港股 / 美股：东方财富行情
- 场外基金：天天基金净值
- 加密货币：OKX
- 汇率：open.er-api.com
取不到时返回 None，不影响其他标的。
"""
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

TIMEOUT = 8
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FinanceX/1.0"


def _get(url, referer=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Referer": referer} if referer else {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8", errors="replace")


def _secids(inst):
    code = inst["code"].strip().upper()
    if inst.get("connect") or inst["currency"] == "HKD" or re.fullmatch(r"\d{5}", code):
        return [f"116.{code.zfill(5)}"]
    if re.fullmatch(r"\d{6}", code):
        if code[0] in "569":
            return [f"1.{code}"]
        return [f"0.{code}"]
    return [f"105.{code}", f"106.{code}", f"107.{code}"]


def _eastmoney(secid):
    url = (f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}"
           "&fields=f43,f57,f58,f60,f86&fltt=2&ut=fa5fd1943c7b386f172d6893dbfba10b")
    d = json.loads(_get(url)).get("data") or {}
    price = d.get("f43")
    if not isinstance(price, (int, float)) or price <= 0:
        price = d.get("f60")
    if not isinstance(price, (int, float)) or price <= 0:
        return None
    ts = d.get("f86")
    when = datetime.fromtimestamp(ts).strftime("%m.%d %H:%M") if isinstance(ts, int) and ts else ""
    return {"price": float(price), "time": when, "name": d.get("f58") or "", "source": "东方财富行情"}


def _fund(code):
    url = f"https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex=1&pageSize=1"
    d = json.loads(_get(url, referer="https://fundf10.eastmoney.com/"))
    lst = ((d.get("Data") or {}).get("LSJZList")) or []
    if not lst or not lst[0].get("DWJZ"):
        return None
    day = lst[0].get("FSRQ", "")
    return {"price": float(lst[0]["DWJZ"]), "time": f"{day[5:].replace('-', '.')} 净值",
            "source": "天天基金净值"}


def _okx(code):
    inst = code.upper() if "-" in code else f"{code.upper()}-USDT"
    d = json.loads(_get(f"https://www.okx.com/api/v5/market/ticker?instId={inst}"))
    lst = d.get("data") or []
    if not lst:
        return None
    ts = int(lst[0].get("ts", 0)) // 1000
    return {"price": float(lst[0]["last"]),
            "time": datetime.fromtimestamp(ts).strftime("%m.%d %H:%M") if ts else "",
            "source": "OKX"}


def price(inst):
    try:
        if inst["category"] == "crypto":
            return _okx(inst["code"])
        if inst["category"] == "fund":
            return _fund(inst["code"].strip())
        for secid in _secids(inst):
            r = _eastmoney(secid)
            if r:
                return r
    except Exception:
        return None
    return None


def prices(insts):
    with ThreadPoolExecutor(max_workers=8) as ex:
        return dict(zip([i["id"] for i in insts], ex.map(price, insts)))


def rates():
    """返回 {"USD": x, "HKD": y}（1 外币 = 多少人民币）。"""
    try:
        d = json.loads(_get("https://open.er-api.com/v6/latest/USD"))
        r = d["rates"]
        usd = float(r["CNY"])
        hkd = usd / float(r["HKD"])
        t = d.get("time_last_update_unix")
        return {"USD": round(usd, 4), "HKD": round(hkd, 4),
                "time": datetime.now().strftime("%m.%d %H:%M"),
                "updated": datetime.fromtimestamp(t).strftime("%m.%d %H:%M") if t else ""}
    except Exception:
        return None


def lookup(code, category, currency):
    """识别标的名称（用户点「识别」时才联网）。"""
    code = code.strip()
    try:
        if category == "crypto":
            r = _okx(code)
            return {"name": code.upper().split("-")[0], "source": "OKX"} if r else None
        if category == "fund":
            d = json.loads(_get("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?"
                                f"m=1&key={code}"))
            for x in d.get("Datas") or []:
                if x.get("CODE") == code:
                    return {"name": x.get("NAME"), "source": "天天基金净值"}
            return None
        for secid in _secids({"code": code, "currency": currency, "connect": False}):
            r = _eastmoney(secid)
            if r:
                return {"name": r["name"], "source": "东方财富行情"}
    except Exception:
        return None
    return None
