"""自动备份：启动、导入前、覆盖盘点前；每类保留最近 10 份。"""
import sqlite3
from datetime import datetime
from pathlib import Path

from . import config, db

KINDS = {"startup": "启动备份", "import": "导入前备份", "stocktake": "盘点覆盖前备份"}


def _dir():
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return config.BACKUP_DIR


def create(kind):
    with db.lock():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
        path = _dir() / f"{kind}-{stamp}.db"
        src = sqlite3.connect(str(config.DB_PATH))
        dst = sqlite3.connect(str(path))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        prune(kind)
        return path


def prune(kind):
    files = sorted(_dir().glob(f"{kind}-*.db"), reverse=True)
    for f in files[config.BACKUP_KEEP:]:
        try:
            f.unlink()
        except OSError:
            pass


def listing():
    out = []
    for f in _dir().glob("*.db"):
        kind, _, rest = f.stem.partition("-")
        if kind not in KINDS:
            continue
        try:
            t = datetime.strptime(rest[:15], "%Y%m%d-%H%M%S")
        except ValueError:
            continue
        out.append({"file": f.name, "kind": kind, "label": KINDS[kind],
                    "time": t.strftime("%Y-%m-%d %H:%M:%S"), "size": f.stat().st_size})
    out.sort(key=lambda x: x["file"].split("-", 1)[1], reverse=True)
    return out


def resolve(name):
    p = (_dir() / Path(name).name).resolve()
    if p.parent != _dir().resolve() or not p.exists():
        raise FileNotFoundError(name)
    return p


def restore(name_or_path):
    p = Path(name_or_path)
    p = p if p.is_absolute() and p.exists() else resolve(str(name_or_path))
    with db.lock():
        src = sqlite3.connect(str(p))
        dst = sqlite3.connect(str(config.DB_PATH))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
