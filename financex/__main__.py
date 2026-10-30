"""启动：python -m financex [--port 8730] [--no-browser]"""
import argparse
import threading
import webbrowser

from . import backup, config, db


def main():
    ap = argparse.ArgumentParser(description="FinanceX 本地个人财务管理")
    ap.add_argument("--port", type=int, default=config.PORT)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    conn = db.connect()
    db.init(conn)
    conn.close()
    backup.create("startup")

    from .server import serve
    httpd = serve(args.port)
    url = f"http://{config.HOST}:{args.port}/"
    print(f"FinanceX 已启动：{url}")
    print(f"数据文件：{config.DB_PATH}")
    print("关闭此窗口即退出。")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
