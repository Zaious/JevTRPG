#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""判準語言 A/B：同一份履歷，換判準語言、換履歷語言，卡會不會變？

沒有標準答案，所以比的是「跟中文基準版一不一致」，而且**先量雜訊地板**：
同一臂跑兩次，兩次之間本來就會差多少？語言造成的差異要大過這個才算數。
（這條是從 hermes-jev-skills 的評測方法學來的——沒有雜訊地板，其他數字都讀不出來。）

  A  判準 zh ＋ 履歷 zh   基準
  B  判準 en ＋ 履歷 zh   只換判準語言（隔離「題目語言」的效果）
  C  判準 en ＋ 履歷 en   真正的英文產品
  D  判準 ja ＋ 履歷 ja   真正的日文產品

  python experiments/locale_ab.py            # 8 次呼叫（4 臂 × 2 次）
"""
import json
import os
import statistics
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from engine import modes              # noqa: E402
from engine.system import System      # noqa: E402

ARMS = [
    ("A", "zh-Hant", "samples/resume_sample.txt",    "判準 zh ＋ 履歷 zh（基準）"),
    ("B", "en",      "samples/resume_sample.txt",    "判準 en ＋ 履歷 zh（只換題目語言）"),
    ("C", "en",      "samples/resume_sample.en.txt", "判準 en ＋ 履歷 en（英文產品）"),
    ("D", "ja",      "samples/resume_sample.ja.txt", "判準 ja ＋ 履歷 ja（日文產品）"),
]
REPEATS = 2
TOP = 8


def spearman(xs, ys):
    """等級相關，同分取平均等級。不依賴 scipy。"""
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else 0.0


def occ_canonical(sys_, era, label):
    """職業回來的是該語系的 label，對回正體中文 canonical id 才能跨語言比。"""
    tr = (sys_.loc.get("occupation_sets") or {}).get(era) or {}
    for cid, v in tr.items():
        if v.get("label") == label:
            return cid
    return label


def run_arm(code, locale, path):
    sys_ = System("coc", locale)
    text = open(os.path.join(ROOT, path), encoding="utf-8").read()
    out = modes.build(sys_, text)
    rows = out["rows"]
    return {
        "values": {cid: r["value"] for cid, r in rows.items()},
        "confidence": statistics.fmean(r["confidence"] for r in rows.values()),
        "evidence": statistics.fmean(r["evidence"] for r in rows.values()),
        "splits": sum(1 for r in rows.values() if r["split"]),
        "edu": out["chars"]["EDU"],
        "occ": {era: occ_canonical(sys_, era, a.choice) for era, a in out["occupations"].items()},
        "occ_conf": {era: round(a.confidence, 2) for era, a in out["occupations"].items()},
        "ms": out["latency_ms"], "tokens": out["tokens"], "model": out["model"],
    }


def main():
    results = {}
    for code, locale, path, label in ARMS:
        results[code] = []
        for rep in range(REPEATS):
            t0 = time.perf_counter()
            results[code].append(run_arm(code, locale, path))
            print(f"  {code}#{rep + 1} {label}  {round((time.perf_counter() - t0) * 1000)} ms")

    ids = sorted(results["A"][0]["values"])
    vec = lambda run: [run["values"][i] for i in ids]  # noqa: E731
    top = lambda run: set(sorted(ids, key=lambda i: -run["values"][i])[:TOP])  # noqa: E731
    ref = results["A"][0]

    print(f"\n{'臂':<3}{'說明':<30}{'跟自己重跑':>10}{'跟A的等級相關':>14}"
          f"{'Top8 重疊':>10}{'平均信心':>9}{'平均有證據':>11}{'雙峰數':>7}{'EDU':>5}")
    table = {}
    for code, locale, path, label in ARMS:
        r1, r2 = results[code]
        self_rho = spearman(vec(r1), vec(r2))
        vs_a = statistics.fmean([spearman(vec(r), vec(ref)) for r in (r1, r2)]) if code != "A" else None
        overlap = statistics.fmean([len(top(r) & top(ref)) for r in (r1, r2)]) if code != "A" else None
        conf = statistics.fmean([r1["confidence"], r2["confidence"]])
        evid = statistics.fmean([r1["evidence"], r2["evidence"]])
        splits = statistics.fmean([r1["splits"], r2["splits"]])
        table[code] = {"label": label, "self_rho": self_rho, "vs_a": vs_a, "top8": overlap,
                       "confidence": conf, "evidence": evid, "splits": splits,
                       "edu": [r1["edu"], r2["edu"]], "occ": r1["occ"], "occ_conf": r1["occ_conf"],
                       "values": r1["values"]}
        print(f"{code:<3}{label:<30}{self_rho:>10.3f}"
              f"{('—' if vs_a is None else f'{vs_a:.3f}'):>14}"
              f"{('—' if overlap is None else f'{overlap:.1f}/{TOP}'):>10}"
              f"{conf:>9.3f}{evid:>11.3f}{splits:>7.1f}{r1['edu']:>5}")

    print("\n職業（canonical id；信心）")
    for code, *_ in ARMS:
        r = results[code][0]
        print(f"  {code}  " + "   ".join(f"{era}: {r['occ'][era]} ({r['occ_conf'][era]})" for era in r["occ"]))

    # 跟基準差最多的技能：語言到底把哪幾項拉歪了
    print(f"\n跟 A 差最多的技能（值；A → 各臂）")
    diffs = []
    for i in ids:
        a = ref["values"][i]
        row = {c: results[c][0]["values"][i] for c in ("B", "C", "D")}
        spread = max(abs(v - a) for v in row.values())
        diffs.append((spread, i, a, row))
    for spread, i, a, row in sorted(diffs, reverse=True)[:10]:
        print(f"  {i:<8} A {a:>3}   B {row['B']:>3}   C {row['C']:>3}   D {row['D']:>3}   最大差 {spread}")

    out = os.path.join(ROOT, "runs", "locale_ab.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"arms": table, "raw": results, "model": ref["model"]},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    calls = len(ARMS) * REPEATS
    toks = sum(r["tokens"] for v in results.values() for r in v)
    print(f"\n{calls} 次呼叫、{toks:,} tokens、模型 {ref['model']} → {out}")


if __name__ == "__main__":
    main()
