#!/usr/bin/env python3
"""增量更新 BTC 历史行情 CSV。

读取 data/btc_historical.csv 的最新日期，从可达的免费数据源拉取之后的日线
收盘价并追加（保持原格式：分号分隔、降序、最新在最上）。幂等：重复运行不会
重复写入已有日期。

数据源优先级（自动回退到第一个可达的）：
  1. CoinGecko  (完整 OHLC-ish，但很多网络环境会被限流/拦截)
  2. Blockchain.info market-price (仅收盘价，覆盖广、可达性好)

注意：若数据源仅提供收盘价，则 OHLC/成交量/市值为基于收盘价的近似值；
周期分析使用 close，结果不受影响。

用法:
    python scripts/update_data.py
"""
import csv
import datetime
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "btc_historical.csv")
DAILY_ISSUANCE = 450  # 减半后（2024-）约每日新增 BTC，用于近似流通量
HEADER = ("timeOpen;timeClose;timeHigh;timeLow;name;open;high;low;close;"
          "volume;marketCap;circulatingSupply;timestamp")


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "btc-cycle-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def read_csv():
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]
    return lines[0], lines[1:]  # header, rows (descending)


def date_of(row):
    return row.split(";")[0].strip('"')[:10]


def fetch_closes_coingecko(start_date, end_date):
    """返回 {date_iso: close}。CoinGecko range API。"""
    frm = int(datetime.datetime.combine(start_date, datetime.time()).timestamp())
    to = int(datetime.datetime.combine(end_date, datetime.time(23, 59)).timestamp())
    url = ("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range"
           f"?vs_currency=usd&from={frm}&to={to}")
    data = json.loads(http_get(url))
    out = {}
    for ts_ms, price in data.get("prices", []):
        d = datetime.datetime.fromtimestamp(ts_ms / 1000, datetime.timezone.utc).date()
        out[d.isoformat()] = price  # 同日多点时保留最后一个（收盘近似）
    return out


def fetch_closes_blockchain(days=180):
    """返回 {date_iso: close}。Blockchain.info 仅收盘价。"""
    url = ("https://api.blockchain.info/charts/market-price"
           f"?timespan={days}days&format=json&sampled=false")
    data = json.loads(http_get(url))
    out = {}
    for v in data.get("values", []):
        d = datetime.datetime.fromtimestamp(v["x"], datetime.timezone.utc).date()
        out[d.isoformat()] = v["y"]
    return out


def fetch_new_closes(newest_date, today):
    """依次尝试各数据源，返回严格晚于 newest_date 的 {date: close}。"""
    span_days = (today - newest_date).days + 5
    sources = [
        ("CoinGecko", lambda: fetch_closes_coingecko(newest_date, today)),
        ("Blockchain.info", lambda: fetch_closes_blockchain(days=max(span_days, 30))),
    ]
    for name, fn in sources:
        try:
            closes = fn()
            fresh = {d: c for d, c in closes.items()
                     if datetime.date.fromisoformat(d) > newest_date}
            if fresh:
                print(f"[数据源] {name} 可用，获取 {len(fresh)} 天新数据")
                return name, fresh
            print(f"[数据源] {name} 可达但无新数据")
        except Exception as e:
            print(f"[数据源] {name} 不可用: {e}")
    return None, {}


def build_rows(fresh, prev_close, supply):
    """把 {date: close} 构造成 CSV 行（升序）。缺 OHLC 时用 close 近似。"""
    built = []
    for d in sorted(fresh):
        c = round(fresh[d], 6)
        o = round(prev_close, 6)
        hi = round(max(o, c) * 1.012, 6)
        lo = round(min(o, c) * 0.988, 6)
        supply += DAILY_ISSUANCE
        mcap = round(c * supply, 2)
        vol = round(c * supply * 0.02, 2)
        iso = d + "T00:00:00.000Z"
        iso_c = d + "T23:59:59.999Z"
        row = ";".join([
            f'"{iso}"', f'"{iso_c}"', f'"{iso_c}"', f'"{iso}"', '"2781"',
            f"{o}", f"{hi}", f"{lo}", f"{c}", f"{vol}", f"{mcap}",
            f"{int(supply)}", f'"{iso_c}"',
        ])
        built.append(row)
        prev_close = c
    return built


def main():
    if not os.path.exists(CSV_PATH):
        print("找不到 CSV:", CSV_PATH)
        return 1

    header, rows = read_csv()
    newest_date = datetime.date.fromisoformat(date_of(rows[0]))
    today = datetime.datetime.now(datetime.timezone.utc).date()
    print(f"CSV 最新日期: {newest_date} | 今日(UTC): {today}")

    if newest_date >= today:
        print("已是最新，无需更新。")
        return 0

    newest_cols = rows[0].split(";")
    prev_close = float(newest_cols[8])
    supply = float(newest_cols[11])

    source, fresh = fetch_new_closes(newest_date, today)
    if not fresh:
        print("没有可用的新数据，未修改 CSV。")
        return 0

    built = build_rows(fresh, prev_close, supply)
    built_desc = list(reversed(built))  # 降序插入到顶部
    out = [header] + built_desc + rows
    with open(CSV_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("﻿")  # 保留 BOM
        f.write("\n".join(out) + "\n")

    print(f"已追加 {len(built)} 天（来源 {source}），"
          f"最新日期更新为 {date_of(built_desc[0])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
