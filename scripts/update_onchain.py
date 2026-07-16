#!/usr/bin/env python3
"""增量更新链上指标 CSV（MVRV Ratio、Realized Price）。

读取 data/mvrv.csv 与 data/realized_price.csv 的最新日期，从 bitcoin-data.com
拉取之后的数据并追加（保持原格式：逗号分隔、降序、最新在最上、日期形如
2026-07-15T00:00:00Z）。幂等：重复运行不会重复写入已有日期。

数据源说明：bitcoin-data.com 在浏览器端受 CORS + 限流约束（故页面不直连，用本地
CSV），但在服务端 / GitHub Actions 环境可正常访问，因此更新放在此脚本里跑。
数值口径与 CryptoQuant 导出的初始 CSV 接近（同为全网 MVRV / 已实现价格）。

用法:
    python scripts/update_onchain.py
"""
import datetime
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

# 每个指标：本地文件、表头、API 端点、返回 JSON 里的取值字段
SERIES = [
    {
        "file": "mvrv.csv",
        "header": "Datetime,MVRV Ratio",
        "url": "https://bitcoin-data.com/v1/mvrv",
        "field": "mvrv",
    },
    {
        "file": "realized_price.csv",
        "header": "Datetime,Realized Price",
        "url": "https://bitcoin-data.com/v1/realized-price",
        "field": "realizedPrice",
    },
]


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "btc-cycle-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def read_csv(path):
    with open(path, encoding="utf-8-sig") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]
    return lines[0], lines[1:]  # header, rows (descending, 最新在最上)


def date_of(row):
    return row.split(",")[0][:10]


def newest_valid_date(rows):
    """跳过尾部空值行，返回最新一条【有值】的日期。"""
    for row in rows:
        cols = row.split(",")
        if len(cols) >= 2 and cols[1].strip():
            return datetime.date.fromisoformat(date_of(row))
    return None


def fetch_series(url, field, start_date, end_date):
    """拉取 [start_date, end_date] 区间，返回 {date_iso: value}。"""
    sd = start_date.isoformat()
    ed = end_date.isoformat()
    full = f"{url}?startday={sd}&endday={ed}"
    data = json.loads(http_get(full))
    out = {}
    for item in data:
        d = item.get("d")
        v = item.get(field)
        if d and v is not None:
            out[d[:10]] = v
    return out


def update_one(series, today):
    path = os.path.join(DATA_DIR, series["file"])
    if not os.path.exists(path):
        print(f"[{series['file']}] 不存在，跳过")
        return False

    header, rows = read_csv(path)
    newest = newest_valid_date(rows)
    if newest is None:
        print(f"[{series['file']}] 无有效数据行，跳过")
        return False
    if newest >= today:
        print(f"[{series['file']}] 已是最新（{newest}），无需更新")
        return False

    try:
        fresh = fetch_series(series["url"], series["field"],
                             newest + datetime.timedelta(days=1), today)
    except Exception as e:
        print(f"[{series['file']}] 数据源不可用: {e}")
        return False

    fresh = {d: v for d, v in fresh.items()
             if datetime.date.fromisoformat(d) > newest}
    if not fresh:
        print(f"[{series['file']}] 数据源可达但无新数据")
        return False

    # 构造新行（升序），再降序插入到顶部
    new_rows = []
    for d in sorted(fresh):
        new_rows.append(f"{d}T00:00:00Z,{fresh[d]}")
    new_rows_desc = list(reversed(new_rows))

    out = [header] + new_rows_desc + rows
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")
    print(f"[{series['file']}] 已追加 {len(new_rows)} 天，最新 {date_of(new_rows_desc[0])}")
    return True


def main():
    today = datetime.datetime.now(datetime.timezone.utc).date()
    print(f"今日(UTC): {today}")
    changed = False
    for series in SERIES:
        if update_one(series, today):
            changed = True
    print("有更新" if changed else "无更新")
    return 0


if __name__ == "__main__":
    sys.exit(main())
