#!/usr/bin/env python3
"""生成 data/blockhorizon_index.csv —— Block Horizon Cycle Index（官方值 + 本地复算对照）。

数据源：charts.blockhorizon.io 的公开 Supabase bundle 接口（guest 可读）。
  https://<project>.supabase.co/functions/v1/bundle_handler/serve?resolution=downsampled_v2
bundle 为 176 个指标的数组，每个 series[0].pd 是 {d:[步长天数], n:点数, v:[值],
t0:起始毫秒时间戳} 的紧凑编码：日期 = t0 + cumsum(d)*86400000，即周频（d=7）。

官方 Cycle Index = floor(mean(6 个子指标) + 0.5)，0-100 整数（已对 776/776 验证）。

本地复算 local_index = floor(mean(4 个子指标) + 0.5)：本地只有 TopPrice / Delta /
MVRV-Z / NUPL 四个子指标的数据（TopPrice=35×历史均值市值/流通量、Delta=(市值/
MVRV−均值市值)/流通量、Z=(市值−实现市值)/市值 expanding 标准差、NUPL 直读），
缺 LTH-MVRV、LTS-NUPL 两个长持者子指标，故仅为 4/6 的近似对照，偏差可见。

子指标 → 0-100 的线性区间为反推所得（0.65 / 1-5 / 0-5 / -0.25-0.8），与官方子
指标中位偏差 3-13。

用法:
    python scripts/make_blockhorizon_index.py            # 优先读本地 bh-bundle.json
    BH_REFRESH=1 python scripts/make_blockhorizon_index.py  # 强制重新下载 bundle

下载走 BH_PROXY（默认试 http://127.0.0.1:7897 再直连）。bundle 原始 JSON 约 4.9MB，
只作临时输入，不提交进仓库。
"""
import csv
import datetime
import json
import math
import os
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
BUNDLE_PATH = os.path.join(ROOT, "bh-bundle.json")
BUNDLE_URL = (
    "https://zbvrubdalcojapjygbcz.supabase.co/functions/v1/"
    "bundle_handler/serve?resolution=downsampled_v2"
)
PROXY = os.environ.get("BH_PROXY", "http://127.0.0.1:7897")

INDEX_SLUGS = [
    ("blockhorizon-index", "cycle_index"),
    ("top-price-index", "top_index"),
    ("delta-price-index", "delta_index"),
    ("nupl-index", "nupl_index"),
    ("mvrv-z-score-index", "mvrv_z_index"),
    ("lth-mvrv-index", "lth_mvrv_index"),
    ("lts-nupl-index", "lts_nupl_index"),
]


def load_bundle():
    if not os.environ.get("BH_REFRESH") and os.path.exists(BUNDLE_PATH):
        with open(BUNDLE_PATH, encoding="utf-8") as f:
            return json.load(f)
    last_err = None
    for proxies in ({"http": PROXY, "https": PROXY}, None):
        try:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler(proxies or {})
            )
            with opener.open(BUNDLE_URL, timeout=60) as r:
                data = json.load(r)
            with open(BUNDLE_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f)
            return data
        except Exception as e:  # 直连失败时退回另一种方式
            last_err = e
    raise SystemExit(f"bundle 下载失败（直连与代理 {PROXY} 均不通）：{last_err}")


def decode(bundle, slug):
    """解出 slug 的周频序列，返回 {YYYY-MM-DD: value}。"""
    item = next(i for i in bundle if i.get("slug") == slug)
    pd = item["series"][0]["pd"]
    out, t = {}, pd["t0"]
    for step, v in zip(pd["d"], pd["v"]):
        day = datetime.datetime.fromtimestamp(t / 1000, datetime.UTC).strftime("%Y-%m-%d")
        if v is not None:
            out[day] = v
        t += step * 86400000
    return out


# ===== 本地复算：从 data/*.csv 重建 4 个子指标 =====
def rescale(v, lo, hi):
    if v <= lo:
        return 0
    if v >= hi:
        return 100
    return (v - lo) / (hi - lo) * 100


def load_local_subindexes():
    """返回 {day: [top, delta, nupl, z]}（本地日线，升序）。"""
    px = {}
    with open(os.path.join(DATA_DIR, "btc_historical.csv"), encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            day = row["timeClose"][:10]
            try:
                px[day] = (
                    float(row["close"]),
                    float(row["marketCap"]),
                    float(row["circulatingSupply"]),
                )
            except (ValueError, KeyError):
                pass
    mvrv, nupl = {}, {}
    for name, target in (("mvrv.csv", mvrv), ("nupl.csv", nupl)):
        with open(os.path.join(DATA_DIR, name), encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                try:
                    target[row["Datetime"][:10]] = float(row[list(row)[1]])
                except (ValueError, KeyError, IndexError):
                    pass
    days = sorted(d for d in set(px) & set(mvrv) & set(nupl) if d >= "2012-01-01")
    run, n = 0.0, 0
    mcap = [px[d][1] for d in days]
    out = {}
    for i, d in enumerate(days):
        price, mcapv, supply = px[d]
        run += mcapv
        n += 1
        avg = run / n  # 历史均值市值（expanding mean）
        rcap = mcapv / mvrv[d]  # 实现市值 = 市值 / MVRV
        top = 35 * avg / supply if supply else 0
        delta = (rcap - avg) / supply if supply else 0
        seg = mcap[: i + 1]
        mu = sum(seg) / len(seg)
        sd = math.sqrt(sum((x - mu) ** 2 for x in seg) / len(seg)) if len(seg) > 1 else 0
        z = (mcapv - rcap) / sd if sd else 0
        out[d] = [
            rescale(price / top if top > 0 else 0, 0, 0.65),
            rescale(price / delta if delta > 0 else 1e9, 1, 5),
            rescale(nupl[d], -0.25, 0.8),
            rescale(z, 0, 5),
        ]
    return out


def main():
    bundle = load_bundle()
    official = {field: decode(bundle, slug) for slug, field in INDEX_SLUGS}
    days = sorted(set().union(*[set(s) for s in official.values()]))
    local = load_local_subindexes()
    fields = [f for _, f in INDEX_SLUGS]
    with open(
        os.path.join(DATA_DIR, "blockhorizon_index.csv"), "w", newline="", encoding="utf-8"
    ) as f:
        w = csv.writer(f)
        w.writerow(["Datetime", "local_index"] + fields)
        for day in days:
            r = {k: official[k].get(day, "") for k in fields}
            lv = local.get(day)
            # local_index：官方取整法（floor(mean+0.5)）作用于本地 4/6 子指标
            r["local_index"] = int(sum(lv) / len(lv) + 0.5) if lv else ""
            w.writerow(
                [day, r["local_index"]] + [r[k] for k in fields]
            )
    n_local = sum(1 for d in days if d in local)
    print(f"wrote {len(days)} rows {days[0]} -> {days[-1]} (local recompute {n_local})")


if __name__ == "__main__":
    main()
