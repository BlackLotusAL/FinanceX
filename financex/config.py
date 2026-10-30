import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"

# 数据库路径可用环境变量覆盖（演示数据用 data/demo.db）
DB_PATH = Path(os.environ.get("FINANCEX_DB", ROOT / "data" / "wealthx.db")).resolve()
DATA_DIR = DB_PATH.parent
BACKUP_DIR = DATA_DIR / ("backups" if DB_PATH.stem == "wealthx" else f"backups-{DB_PATH.stem}")

HOST = "127.0.0.1"
PORT = int(os.environ.get("FINANCEX_PORT", "8730"))

BACKUP_KEEP = 10
