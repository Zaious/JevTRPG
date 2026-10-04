#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把一份履歷變成角色卡，或檢查一張角色卡的背景撐不撐得起技能表。

  python cli.py build samples/resume_sample.txt
  python cli.py build samples/resume_sample.txt --dry-run     # 只看要送出去什麼
  python cli.py check samples/character_sample.txt --bonus 150
  python cli.py systems                                        # 列出可用的系統包

⚠ 文件會送到 TypeSafe 的雲端 API。第一次跑任何一份真實文件之前，先 --dry-run。
"""
import argparse
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from engine import modes                      # noqa: E402
from engine.system import System              # noqa: E402

BAR = "=" * 64


def _save(name, payload):
    os.makedirs(os.path.join(HERE, "runs"), exist_ok=True)
    path = os.path.join(HERE, "runs", name)
    json.dump(payload, open(path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1, default=str)
    return path


def cmd_build(args):
    sys_ = System(args.system)
    text = open(args.file, encoding="utf-8").read()
    out = modes.build(sys_, text, args.all, args.dry_run, cap=args.cap, bonus=args.bonus)
    if out.get("dry_run"):
        print(out["state"])
        print(f"\n--- 會送出 {len(out['state'])} 字元、{out['questions']} 題，一次請求")
        print(f"--- 已拔掉：{out['redacted'] or '（沒有偵測到聯絡資訊）'}")
        return

    rows, chars = out["rows"], out["chars"]
    print(f"\n{BAR}\n {sys_.title}｜建卡（不套點數上限）"
          f"\n {out['model']}  {out['latency_ms']} ms  {out['tokens']} tokens"
          f"  已拔掉 {out['redacted'] or '無'}\n{BAR}")
    for era, ans in out["occupations"].items():
        alt = sorted(ans.probabilities.items(), key=lambda kv: -kv[1])[1:4]
        print(f"\n職業（{era}）：{ans.choice}  {ans.confidence:.2f}"
              f"   次選：" + "、".join(f"{k} {v:.2f}" for k, v in alt))
    print("\n特性值（擲骰，文件裡讀不出來的一律不問模型）：")
    print("   " + "  ".join(f"{k} {v}" for k, v in chars.items()))
    print(f"   （參考：這套規則下的點數預算會是 {out['budget']}，建卡模式不套）")

    print(f"\n{'技能':<12}{'值':>5}{'基礎':>6}{'信心':>7}{'有證據':>8}   ")
    for n in sorted(rows, key=lambda n: -rows[n]["value"]):
        r = rows[n]
        mark = ""
        if r["split"]:
            mark = (f"  ⚠ 兩種讀法：{r['top'][1]:.0%} / {r['second'][1]:.0%}")
        elif r["value"] <= r["base"]:
            mark = "  （基礎值）"
        print(f"{n:<12}{r['value']:>5}{r['base']:>6}{r['confidence']:>7.2f}"
              f"{r['evidence']:>8.2f}{mark}")
    print("\n背景：")
    for k, ans in out["backstory"].items():
        print(f"   {k}：{ans.choice}（{ans.confidence:.2f}）")

    path = _save("build-latest.json", {
        "system": sys_.name, "model": out["model"], "latency_ms": out["latency_ms"],
        "tokens": out["tokens"], "chars": chars,
        "skills": {n: {k: r[k] for k in ("value", "base", "confidence", "evidence",
                                         "level", "split", "probabilities")}
                   for n, r in rows.items()}})
    print(f"\n收據：{path}")


def cmd_check(args):
    sys_ = System(args.system)
    text = open(args.file, encoding="utf-8").read()
    out = modes.check(sys_, text, args.bonus, args.dry_run)
    if out.get("dry_run"):
        print(json.dumps(out["state"], ensure_ascii=False, indent=1))
        print(f"\n特性值：{out['chars']}\n宣稱技能 {len(out['claimed'])} 項，"
              f"{out['questions']} 題，一次請求")
        print(f"已拔掉：{out['redacted'] or '（沒有偵測到聯絡資訊）'}")
        if out["unknown_skills"]:
            print(f"⚠ 系統包裡沒有定義的技能（模型只能照字面讀）：{out['unknown_skills']}")
        return

    rows, b = out["rows"], out["budget"]
    total = sum(b.values())
    print(f"\n{BAR}\n {sys_.title}｜KP 檢查"
          f"\n {out['model']}  {out['latency_ms']} ms  {out['tokens']} tokens\n{BAR}")
    print(f"\n【點數帳】" + "，".join(f"{k} {v}" for k, v in b.items())
          + (f"（含房規 +{out['bonus']}）" if out["bonus"] else "")
          + f"　合計 {total}")
    print(f"           技能表花掉 {out['spent']} 點 → "
          + (f"**超支 {out['spent'] - total} 點**" if out["spent"] > total
             else f"在預算內（剩 {total - out['spent']} 點）"))

    print(f"\n【背景支撐】\n{'技能':<14}{'宣稱':>5}{'撐得起':>8}{'信心':>7}  判定")
    for n in sorted(rows, key=lambda n: -rows[n]["claimed"]):
        r = rows[n]
        u = "" if r["known"] else "  ⚠系統包無定義"
        print(f"{n:<14}{r['claimed']:>5}{r['ceiling']:>8}{r['confidence']:>7.2f}"
              f"  {r['verdict']}{u}")

    levels = sys_.levels
    red = [(n, r) for n, r in rows.items() if r["verdict"] == "撐不起"]
    amber = [(n, r) for n, r in rows.items() if r["verdict"] == "爭議"]
    print("\n【🔴 背景裡沒有這個東西，KP 該問】")
    for n, r in sorted(red, key=lambda x: -x[1]["claimed"]) or []:
        print(f"   ▸ {n} {r['claimed']}%：{levels[r['top'][0]]}（{r['top'][1]:.0%}），"
              f"大概撐得起 {r['ceiling']}%")
    if not red:
        print("   （無）")
    print("\n【🟡 有兩種讀法，KP 自己裁】")
    for n, r in sorted(amber, key=lambda x: -x[1]["claimed"]) or []:
        print(f"   ▸ {n} {r['claimed']}%：{r['top'][1]:.0%} 讀成「{levels[r['top'][0]]}」，"
              f"{r['second'][1]:.0%} 讀成「{levels[r['second'][0]]}」")
    if not amber:
        print("   （無）")

    path = _save("check-latest.json", {
        "system": sys_.name, "model": out["model"], "latency_ms": out["latency_ms"],
        "tokens": out["tokens"], "budget": b, "spent": out["spent"],
        "skills": {n: {k: r[k] for k in ("claimed", "ceiling", "confidence", "evidence",
                                         "level", "split", "verdict", "probabilities")}
                   for n, r in rows.items()}})
    print(f"\n收據：{path}")


def cmd_systems(_):
    root = os.path.join(HERE, "systems")
    for name in sorted(os.listdir(root)):
        if os.path.isfile(os.path.join(root, name, "system.yaml")):
            s = System(name)
            print(f"{name:<12} {s.title}   技能 {len(s.d['skills'])} 項"
                  f"（文件讀得出來的 {len(s.skills())} 項）")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--system", default="coc", help="用哪個系統包（預設 coc）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="履歷 → 角色卡（不套點數上限）")
    b.add_argument("file")
    b.add_argument("--all", action="store_true", help="連體能戰鬥類也問（預設不問）")
    b.add_argument("--cap", action="store_true", help="套點數上限（角色版；履歷版不套）")
    b.add_argument("--bonus", type=int, default=0, help="房規給的額外職業技能點")
    b.add_argument("--dry-run", action="store_true")
    b.set_defaults(func=cmd_build)
    c = sub.add_parser("check", help="角色卡 → 背景撐不撐得起技能表（套點數上限）")
    c.add_argument("file")
    c.add_argument("--bonus", type=int, default=0, help="房規給的額外職業技能點")
    c.add_argument("--dry-run", action="store_true")
    c.set_defaults(func=cmd_check)
    s = sub.add_parser("systems", help="列出可用的系統包")
    s.set_defaults(func=cmd_systems)
    a = ap.parse_args()
    a.func(a)
