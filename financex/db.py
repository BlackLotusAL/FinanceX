"""SQLite 存储：单文件 data/wealthx.db。"""
import sqlite3
import threading
from datetime import datetime

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,              -- income / expense
  l1 TEXT NOT NULL,                -- 一级（固定）
  name TEXT NOT NULL,              -- 二级
  sort INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0, -- 由交易自动生成（已实现盈亏、汇兑损益）
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,              -- manual / investment
  currency TEXT NOT NULL,          -- CNY / HKD / USD / CRYPTO
  note TEXT NOT NULL DEFAULT '',
  disabled INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created TEXT
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,          -- stock / etf / fund / crypto
  currency TEXT NOT NULL,          -- 计价币种 CNY / HKD / USD / USDT
  connect INTEGER NOT NULL DEFAULT 0, -- 港股通：按人民币标的记账
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  disabled INTEGER NOT NULL DEFAULT 0,
  created TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,              -- buy / sell / fx_buy / fx_sell
  instrument_id INTEGER REFERENCES instruments(id),
  currency TEXT,                   -- 购汇 / 结汇的币种 HKD / USD
  qty REAL NOT NULL,
  amount REAL NOT NULL,            -- 买入：总支出；卖出：到手金额；购汇：支付人民币；结汇：收到人民币
  opening INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created TEXT
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  created TEXT NOT NULL,
  files TEXT NOT NULL,
  count INTEGER NOT NULL,
  backup TEXT
);

CREATE TABLE IF NOT EXISTS flows (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  amount REAL NOT NULL,            -- 人民币；退款为负数
  type TEXT NOT NULL,              -- income / expense / transfer
  category_id INTEGER REFERENCES categories(id),
  source TEXT NOT NULL,            -- alipay / wechat / abc / manual / copy / sell / fx
  order_no TEXT,
  merchant TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  raw TEXT,
  batch_id INTEGER,
  trade_id INTEGER,
  tag TEXT NOT NULL DEFAULT '',
  created TEXT,
  updated TEXT
);
CREATE INDEX IF NOT EXISTS flows_date ON flows(date);
CREATE INDEX IF NOT EXISTS flows_merchant ON flows(merchant);
CREATE INDEX IF NOT EXISTS flows_order ON flows(source, order_no);

CREATE TABLE IF NOT EXISTS snapshots (
  month TEXT PRIMARY KEY,          -- YYYY-MM
  date TEXT NOT NULL,              -- 盘点日期
  rates TEXT NOT NULL,             -- {"HKD":0.915,"USD":7.1182}
  rate_note TEXT NOT NULL DEFAULT '',
  created TEXT,
  updated TEXT
);

CREATE TABLE IF NOT EXISTS snap_balances (
  month TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  balance REAL,
  currency TEXT,                   -- 盘点时账户的币种（存档，不随账户修改）
  PRIMARY KEY (month, account_id)
);

CREATE TABLE IF NOT EXISTS snap_positions (
  month TEXT NOT NULL,
  instrument_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  price REAL,
  cost REAL NOT NULL DEFAULT 0,    -- 盘点时的持仓成本（结算币种）
  price_note TEXT NOT NULL DEFAULT '',
  currency TEXT,                   -- 盘点时标的的币种与港股通标记（存档）
  connect INTEGER,
  PRIMARY KEY (month, instrument_id)
);
"""

INCOME_L1 = ["工资收入", "投资收益"]
EXPENSE_L1 = ["工资减扣", "餐饮食品", "住房物业", "交通出行", "实体商品",
              "数字订阅", "生活服务", "健康保障", "其他消费"]
L1_KIND = {**{k: "income" for k in INCOME_L1}, **{k: "expense" for k in EXPENSE_L1}}

AUTO_REALIZED = ("投资收益", "已实现盈亏")
AUTO_FX = ("投资收益", "汇兑损益")

DEFAULT_CATEGORIES = [
    ("工资收入", ["基本工资", "绩效工资", "年终奖", "加班费", "其他收入（及时激励/课酬）"]),
    ("投资收益", ["已实现盈亏", "分红", "利息", "汇兑损益"]),
    ("工资减扣", ["社保", "公积金", "个人所得税"]),
    ("餐饮食品", ["三餐", "外卖", "外出聚餐", "饮料零食"]),
    ("住房物业", ["房租", "物业费", "网络费", "水电费"]),
    ("交通出行", ["飞机", "高铁", "地铁", "打车", "充电"]),
    ("实体商品", ["日用百货", "服饰装扮", "电子产品", "周边产品"]),
    ("数字订阅", ["AI 与开发", "购物会员", "影音娱乐", "工具与云服务", "游戏充值"]),
    ("生活服务", ["话费", "理发"]),
    ("健康保障", ["保险", "医疗", "药品"]),
    ("其他消费", ["人情往来", "利息与手续费", "???", "其他"]),
]

_lock = threading.RLock()


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect(path=None):
    path = path or config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


_MIGRATIONS = [
    ("snap_balances", "currency", "TEXT"),
    ("snap_positions", "currency", "TEXT"),
    ("snap_positions", "connect", "INTEGER"),
]


def archive_snapshot_meta(conn):
    """给尚未存档币种的快照行补上当前币种，之后修改账户 / 标的不再影响它们。"""
    conn.execute("UPDATE snap_balances SET currency=(SELECT currency FROM accounts a "
                 "WHERE a.id=snap_balances.account_id) WHERE currency IS NULL")
    conn.execute("UPDATE snap_positions SET "
                 "currency=(SELECT currency FROM instruments i WHERE i.id=snap_positions.instrument_id), "
                 "connect=(SELECT connect FROM instruments i WHERE i.id=snap_positions.instrument_id) "
                 "WHERE currency IS NULL")


def init(conn):
    conn.executescript(SCHEMA)
    for table, col, typ in _MIGRATIONS:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
    archive_snapshot_meta(conn)
    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        sort = 0
        for l1, subs in DEFAULT_CATEGORIES:
            for name in subs:
                sort += 1
                auto = 1 if (l1, name) in (AUTO_REALIZED, AUTO_FX) else 0
                conn.execute(
                    "INSERT INTO categories(kind,l1,name,sort,auto) VALUES (?,?,?,?,?)",
                    (L1_KIND[l1], l1, name, sort, auto))
    conn.commit()


def lock():
    """写操作与备份/恢复互斥。"""
    return _lock


def rows(cur):
    return [dict(r) for r in cur.fetchall()]


def one(cur):
    r = cur.fetchone()
    return dict(r) if r else None


def category_id(conn, l1, name):
    r = conn.execute("SELECT id FROM categories WHERE l1=? AND name=?", (l1, name)).fetchone()
    return r[0] if r else None
