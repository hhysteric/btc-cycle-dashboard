#!/usr/bin/env python3
"""增量更新 BTC Dominance / USDT Dominance CSV。

数据源：CoinGecko 免费 API
  - BTC/ETH/USDT 各自的每日市值: /coins/{id}/market_chart/range → market_caps
  - 当前全球数据: /global → market_cap_percentage（BTC/ETH/USDT 当前占比）

计算方法：
  总市值估算 = (BTC_mcap + ETH_mcap + USDT_mcap) / (BTC.D% + ETH.D% + USDT.D%) * 100
  BTC.D = BTC_mcap / total_mcap * 100
  USDT.D = USDT_mcap / total_mcap * 100

CoinGecko 免费 API 限 market_chart/range 最多 365 天。

格式：Datetime,BTC.D,USDT.D（逗号分隔、降序）

用法:
    python scripts/update_dominance.py            # 增量更新
    python scripts/update_dominance.py --backfill # 全量回填（最多 365 天）
"""
import datetime
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "dominance.csv")
HEADER = "Datetime,BTC.D,USDT.D"


def http_get(url, timeout=60):
    proxy = (os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
             or os.environ.get("https_proxy") or os.environ.get("http_proxy"))
    if proxy:
        handler = urllib.request.ProxyHandler({"https": proxy, "http": proxy})
        opener = urllib.request.build_opener(handler)
    else:
        opener = urllib.request.build_opener()
    req = urllib.request.Request(url, headers={"User-Agent": "btc-cycle-dashboard/1.0"})
    with opener.open(req, timeout=timeout) as r:
        return r.read()


def fetch_market_caps(coin_id, from_ts, to_ts):
    """拉取某币种的市值时间序列。返回 {date_iso: mcap}（取每日最后一个值）。"""
    url = (f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart/range"
           f"?vs_currency=usd&from={from_ts}&to={to_ts}")
    data = json.loads(http_get(url))
    result = {}
    for ts_ms, mcap in data.get("market_caps", []):
        if mcap is None or mcap <= 0:
            continue
        dt = datetime.datetime.fromtimestamp(ts_ms / 1000, datetime.timezone.utc)
        day = dt.date().isoformat()
        result[day] = mcap
    return result


def fetch_current_dominance():
    """从 /global 获取当前三大币的占比。"""
    data = json.loads(http_get("https://api.coingecko.com/api/v3/global"))
    pct = data["data"]["market_cap_percentage"]
    return pct.get("btc", 60), pct.get("eth", 12), pct.get("usdt", 7)


def compute_dominance(btc_mcaps, eth_mcaps, usdt_mcaps, combined_pct):
    """用三币市值之和 / 联合占比估算总市值，然后算 BTC.D / USDT.D。

    combined_pct = btc_d + eth_d + usdt_d（当前值，如 78.6）
    """
    all_days = sorted(set(btc_mcaps.keys()) & set(eth_mcaps.keys()))
    rows = []
    for day in all_days:
        btc = btc_mcaps[day]
        eth = eth_mcaps.get(day, 0)
        usdt = usdt_mcaps.get(day, 0)

        combined = btc + eth + usdt
        if combined <= 0:
            continue
        # 总市值 ≈ (BTC+ETH+USDT) / 联合占比
        total = combined / (combined_pct / 100)

        btc_d = btc / total * 100
        usdt_d = (usdt / total * 100) if usdt > 0 else 0
        rows.append((day, round(btc_d, 4), round(usdt_d, 4)))
    return rows


def read_csv():
    if not os.path.exists(CSV_PATH):
        return HEADER, [], None
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]
    if len(lines) <= 1:
        return lines[0] if lines else HEADER, [], None
    return lines[0], lines[1:], lines[1].split(",")[0].strip()[:10]


def write_csv(header, rows):
    with open(CSV_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + "\n")
        for r in rows:
            f.write(r + "\n")


def fetch_range(start_date, end_date):
    """拉取 BTC/ETH/USDT 市值并计算 dominance。"""
    from_ts = int(datetime.datetime.combine(start_date, datetime.time(),
                                             tzinfo=datetime.timezone.utc).timestamp())
    to_ts = int(datetime.datetime.combine(end_date, datetime.time(23, 59, 59),
                                           tzinfo=datetime.timezone.utc).timestamp())

    print(f"  拉取范围: {start_date} ~ {end_date}")

    print("  拉取 BTC 市值...")
    btc = fetch_market_caps("bitcoin", from_ts, to_ts)
    print(f"  → {len(btc)} 天")
    time.sleep(1.5)

    print("  拉取 ETH 市值...")
    eth = fetch_market_caps("ethereum", from_ts, to_ts)
    print(f"  → {len(eth)} 天")
    time.sleep(1.5)

    print("  拉取 USDT 市值...")
    usdt = fetch_market_caps("tether", from_ts, to_ts)
    print(f"  → {len(usdt)} 天")
    time.sleep(1.5)

    print("  获取当前 dominance 比例...")
    btc_d, eth_d, usdt_d = fetch_current_dominance()
    combined_pct = btc_d + eth_d + usdt_d
    print(f"  BTC.D={btc_d:.2f}% ETH.D={eth_d:.2f}% USDT.D={usdt_d:.2f}% → 联合占比={combined_pct:.2f}%")

    return compute_dominance(btc, eth, usdt, combined_pct)


def backfill():
    print("=== 回填模式：拉取 Dominance 历史（最多 365 天）===")
    today = datetime.datetime.now(datetime.timezone.utc).date()
    start = today - datetime.timedelta(days=364)

    rows = fetch_range(start, today)
    if not rows:
        print("无数据。")
        return 1

    csv_rows = [f"{day},{bd},{ud}" for day, bd, ud in reversed(rows)]
    write_csv(HEADER, csv_rows)
    print(f"写入 {len(csv_rows)} 行到 {CSV_PATH}")
    return 0


def incremental():
    header, existing, newest = read_csv()
    today = datetime.datetime.now(datetime.timezone.utc).date()

    if newest:
        start = datetime.date.fromisoformat(newest) + datetime.timedelta(days=1)
        print(f"CSV 最新: {newest} → 增量 {start} ~ {today}")
    else:
        start = today - datetime.timedelta(days=364)
        print(f"CSV 为空 → 拉取 {start} ~ {today}")

    if start > today:
        print("已是最新。")
        return 0

    rows = fetch_range(start, today)
    if not rows:
        print("无新数据。")
        return 0

    existing_dates = {r.split(",")[0].strip()[:10] for r in existing}
    new_rows = [(d, b, u) for d, b, u in rows if d not in existing_dates]
    if not new_rows:
        print("无新数据可追加。")
        return 0

    new_csv = [f"{d},{b},{u}" for d, b, u in reversed(new_rows)]
    all_rows = new_csv + existing
    write_csv(HEADER, all_rows)
    print(f"追加 {len(new_rows)} 天")
    return 0


def main():
    if "--backfill" in sys.argv:
        return backfill()
    return incremental()


if __name__ == "__main__":
    sys.exit(main())
