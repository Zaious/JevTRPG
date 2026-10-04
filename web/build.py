#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把系統包編譯成 Worker 讀得到的 JS 模組。

系統包是 YAML（人寫的，有註解），Worker 是 JS（不想在邊緣解析 YAML）。
這支是唯一的轉換點——**規則的單一真相仍然是 systems/<name>/system.yaml**，
各語系只覆寫字串（systems/<name>/locales/<lang>.yaml）。這裡把每個語系
**預先合併好**，Worker 只要挑一份，不用在邊緣做合併邏輯。

  python web/build.py            # 編譯所有系統包的所有語系
  python web/build.py --check    # 只檢查產物是不是最新的，不一致 exit 1
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from engine.system import System  # noqa: E402

OUT = os.path.join(HERE, "worker", "system.js")
HEAD = "// 自動產生，別手改。改 systems/<name>/ 之後跑 python web/build.py\n"
PROMPT_KEYS = ["build", "build_evidence_clause", "check", "occupation",
               "backstory", "education", "unknown_skill"]


def compile_one(name, locale):
    s = System(name, locale)
    edu_levels, edu_values = s.education()
    backstory_titles = s.loc.get("backstory_titles") or {}
    return {
        "title": s.title,
        "prompts": {k: s.prompt(k) for k in PROMPT_KEYS},
        "levels": s.levels,
        "ceiling": s.d["evidence_ceiling"],
        "value": s.d["evidence_value"],
        "education": [{"level": l, "value": v} for l, v in zip(edu_levels, edu_values)],
        "budget": s.d["budget"],
        "derived": s.d.get("derived") or {},
        "characteristics": s.d["characteristics"],
        "sections": s.sections,
        # 職業與背景表：key 用顯示名（模型答回來的就是它），值是說明
        "occupations": {era: s.table("occupation_sets", era)
                        for era in (s.d.get("occupation_sets") or {})},
        "backstory": {cid: {"title": backstory_titles.get(cid, cid),
                            "options": s.table("backstory", cid)}
                      for cid in (s.d.get("backstory") or {})},
        # 技能：key 永遠是 canonical id，label 才是這個語系的名字
        "skills": {k: {**v, "family": s._family(k) or None, "aliases": s._aliases(k)} for k, v in s.skills(include_unreachable=True).items()},
    }


def compile_all():
    systems = {}
    root = os.path.join(ROOT, "systems")
    for name in sorted(os.listdir(root)):
        if not os.path.isfile(os.path.join(root, name, "system.yaml")):
            continue
        systems[name] = {loc: compile_one(name, loc) for loc in System.locales(name)}
    return systems


if __name__ == "__main__":
    data = compile_all()
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    blob = HEAD + "export default " + body + ";\n"
    if "--check" in sys.argv:
        cur = open(OUT, encoding="utf-8").read() if os.path.isfile(OUT) else ""
        if cur != blob:
            print("✗ web/worker/system.js 不是最新的——跑一次 python web/build.py")
            sys.exit(1)
        print("✓ system.js 是最新的")
        sys.exit(0)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(blob)
    for name, locs in data.items():
        print(f"✓ {name}: " + "、".join(f"{l}（{len(v['skills'])} 技能）" for l, v in locs.items()))
    print(f"  → {OUT}（{len(blob):,} bytes）")
