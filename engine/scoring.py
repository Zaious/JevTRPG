# -*- coding: utf-8 -*-
"""把 Jev 的等級分布折成有用的東西。

這裡是整個專案最貴的一課，三個獨立的量千萬不要混在一起：

  有沒有證據  = 1 − P(最低級)   ← 決定要不要給點數
  多強        = 各級機率 × 各級對應值  ← 決定給多少
  信心        = 模型對「哪一級」有多確定  ← 只決定要不要標示爭議

早期版本拿 信心 當權重，結果「證據明確但分不清第 3 還第 4 級」的技能
（電腦使用：機率全落在 2–4 級、信心 0.50）被當成沒證據，打回基礎值 5%。

而且低信心常常不是「中等」，是**雙峰**——模型同時看到兩種讀法。
把雙峰壓成期望值，會產生一個沒有任何機率支持的數字。雙峰要單獨報出來。
"""
from __future__ import annotations

SPLIT_MIN = 0.25   # 第二高的等級機率超過這個就算有爭議


def normalise(probabilities) -> dict:
    """機率的鍵可能是 int 或字串，一律轉成 int 索引。"""
    return {int(k): float(v) for k, v in probabilities.items()}


def read(answer, values, ceilings):
    """一題 Score 的回答 → 我們要的四個量。"""
    p = normalise(answer.probabilities)
    n = len(values)
    ranked = sorted(p.items(), key=lambda kv: -kv[1])
    top = ranked[0] if ranked else (0, 0.0)
    second = ranked[1] if len(ranked) > 1 else (0, 0.0)
    return {
        "probabilities": p,
        "level": float(answer.score),
        "confidence": float(answer.confidence),
        "evidence": 1.0 - p.get(0, 0.0),
        "value": round(sum(p.get(i, 0.0) * values[i] for i in range(n))),
        "ceiling": round(sum(p.get(i, 0.0) * ceilings[i] for i in range(n))),
        "top": top,
        "second": second,
        "split": second[1] >= SPLIT_MIN,
    }


def allocate(rows, budget, cap=90):
    """把點數預算貪婪地配給證據最強的技能，配到目標值為止、用完為止。

    不用比例平分：平分會把 300 點攤薄成每項 +37，結果每個技能都是中庸的 40 幾，
    而真實玩家不會這樣配——會把點堆在強項上。
    """
    final = {n: r["base"] for n, r in rows.items()}
    order = sorted(rows, key=lambda n: -(rows[n]["evidence"] * rows[n]["level"]))
    used = []
    for n in order:
        want = rows[n]["value"] - rows[n]["base"]
        if want <= 1 or budget <= 0:
            continue
        give = min(want, budget, cap - rows[n]["base"])
        if give <= 0:
            continue
        final[n] = round(rows[n]["base"] + give)
        budget -= give
        used.append(n)
    return final, used, round(budget)
