#!/usr/bin/env python3
"""增量更新 URPD（UTXO Realized Price Age Distribution）CSV。

数据源 CryptoQuant（付费 API），拉取 3 个端点：
  - utxo-realized-price-age-distribution → 各年龄段平均成本基础
  - utxo-age-distribution → 各年龄段 BTC 持有量
  - pnl-utxo → 盈利 UTXO 百分比

输出 data/urpd.csv，每天 ~13 行（每个年龄段一行），降序排列。
幂等：同一日期不会重复写入。

CryptoQuant API key 从环境变量 CRYPTOQUANT_KEY 读取。

用法:
    CRYPTOQUANT_KEY=xxxx python scripts/update_urpd.py
"""
import datetime
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
CSV_PATH = os.path.join(DATA_DIR, "urpd.csv")
API_BASE = "https://api.cryptoquant.com/v1"

HEADER = "date,band,label,supply,cost_basis,profit_percent"

# 年龄段 key → 可读标签（与前端 AGE_LABELS 对齐）
AGE_BANDS = [
    ("range_0d_1d", "<1d"),
    ("range_1d_1w", "1d-1w"),
    ("range_1w_1m", "1w-1m"),
    ("range_1m_3m", "1-3m"),
    ("range_3m_6m", "3-6m"),
    ("range_6m_12m", "6-12m"),
    ("range_12m_18m", "1-1.5y"),
    ("range_18m_2y", "1.5-2y"),
    ("range_2y_3y", "2-3y"),
    ("range_3y_5y", "3-5y"),
    ("range_5y_7y", "5-7y"),
    ("range_7y_10y", "7-10y"),
    ("range_10y_inf", ">10y"),
]


def http_get(url, key, timeout=30):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {key}",
        "User-Agent": "btc-cycle-dashboard/1.0",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_endpoint(path, key, limit=1):
    """拉取 CryptoQuant 端点，返回 data 数组。"""
    url = f"{API_BASE}/{path}?window=day&limit={limit}"
    raw = http_get(url, key)
    data = json.loads(raw)
    if data.get("status", {}).get("code") != 200:
        raise RuntimeError(f"API error: {data.get('status')}")
    return data.get("result", {}).get("data", [])


def newest_date_in_csv():
    """读取现有 CSV 的最新日期（第一条数据行）。"""
    if not os.path.exists(CSV_PATH):
        return None
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        lines = [l.strip() for l in f if l.strip()]
    if len(lines) < 2:
        return None
    # 第一个数据行的 date 列
    return lines[1].split(",")[0][:10]


def read_existing_rows():
    """读取现有 CSV 全部数据行（不含表头），返回列表。"""
    if not os.path.exists(CSV_PATH):
        return []
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]
    return lines[1:]  # 跳过表头


def fetch_urpd(key):
    """拉取 URPD 三个端点，合并返回 (date_str, profit_percent, bands)。"""
    print("正在拉取 CryptoQuant URPD 数据…")

    cost_data = fetch_endpoint(
        "btc/market-indicator/utxo-realized-price-age-distribution", key)
    supply_data = fetch_endpoint(
        "btc/network-indicator/utxo-age-distribution", key)

    # pnl-utxo 可能失败，不阻塞
    try:
        pnl_data = fetch_endpoint("btc/network-indicator/pnl-utxo", key)
    except Exception as e:
        print(f"  pnl-utxo 拉取失败（非致命）: {e}")
        pnl_data = []

    if not cost_data or not supply_data:
        raise RuntimeError("cost 或 supply 端点无数据")

    cost_row = cost_data[0]
    supply_row = supply_data[0]
    pnl_row = pnl_data[0] if pnl_data else {}

    date_str = cost_row.get("date", "")[:10]
    profit_percent = pnl_row.get("profit_percent")

    bands = []
    for band_key, label in AGE_BANDS:
        supply = supply_row.get(band_key)
        cost_basis = cost_row.get(band_key)
        if supply is not None and cost_basis is not None and supply > 0:
            bands.append((band_key, label, supply, cost_basis))

    # 按成本基础从低到高排序
    bands.sort(key=lambda x: x[3])

    print(f"  日期: {date_str}, 年龄段: {len(bands)}, "
          f"盈利UTXO: {profit_percent}%")
    return date_str, profit_percent, bands


def write_csv(new_date, profit_percent, bands, existing_rows):
    """写入 CSV：新数据在前（降序），追加到已有行之前。"""
    new_rows = []
    pp_str = f"{profit_percent}" if profit_percent is not None else ""
    for band_key, label, supply, cost_basis in bands:
        new_rows.append(
            f"{new_date},{band_key},{label},{supply},{cost_basis},{pp_str}"
        )

    # 过滤掉已有行中同日期的（幂等：覆盖）
    old_rows = [r for r in existing_rows if not r.startswith(new_date)]

    all_rows = [HEADER] + new_rows + old_rows
    with open(CSV_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(all_rows) + "\n")
    print(f"已写入 {len(new_rows)} 行到 {CSV_PATH}")


def main():
    key = os.environ.get("CRYPTOQUANT_KEY", "").strip()
    if not key:
        print("未设置 CRYPTOQUANT_KEY 环境变量，跳过 URPD 更新。")
        return 0

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    newest = newest_date_in_csv()
    if newest and newest >= today:
        print(f"[urpd.csv] 已是最新（{newest}），无需更新")
        return 0

    try:
        date_str, profit_percent, bands = fetch_urpd(key)
    except Exception as e:
        print(f"URPD 数据拉取失败: {e}")
        return 1

    if not bands:
        print("URPD 无有效年龄段数据")
        return 1

    existing = read_existing_rows()
    write_csv(date_str, profit_percent, bands, existing)
    return 0


if __name__ == "__main__":
    sys.exit(main())
