#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重產首屏縮圖用的範例結果（web/public/samples/*.json）。

縮圖放的是範例**實際跑出來**的卡，不是另外畫的示意圖，所以 API 回傳的形狀
或判準改了就要重跑。範例文字的單一來源是 web/public/app.js 裡的 SAMPLE_* 常數
（使用者按「放一份範例」拿到的就是同一份）。

  npx wrangler dev --port 8787          # web/worker 底下先開著
  python web/make_samples.py [--base http://127.0.0.1:8787]

全部跑完才寫檔：wrangler dev 監看 public/，邊跑邊寫會觸發重載、撞出 503。
"""
import json
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "public")
BASE = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "http://127.0.0.1:8787"


def sample(src, name):
    m = re.search(r"const " + name + r" = `(.*?)`;", src, re.S)
    if not m:
        raise SystemExit(f"app.js 裡找不到 {name}")
    return m.group(1)


def main():
    src = open(os.path.join(PUBLIC, "app.js"), encoding="utf-8").read()
    jobs = {}
    for loc, suf in (("zh-Hant", ""), ("en", "_EN"), ("ja", "_JA")):
        jobs[f"resume.{loc}"] = ("/api/build", loc, sample(src, "SAMPLE_RESUME" + suf))
        jobs[f"character.{loc}"] = ("/api/character", loc, sample(src, "SAMPLE_CHAR" + suf))

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 本機不走代理
    out = {}
    for key, (path, loc, text) in jobs.items():
        req = urllib.request.Request(
            BASE + path, headers={"Content-Type": "application/json"},
            data=json.dumps({"text": text, "system": "coc", "locale": loc}).encode())
        out[key] = json.loads(opener.open(req, timeout=90).read())

    os.makedirs(os.path.join(PUBLIC, "samples"), exist_ok=True)
    for key, d in out.items():
        path = os.path.join(PUBLIC, "samples", f"{key}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
            f.write("\n")
        if d["mode"] == "check":
            flags = sum(r["verdict"] != "ok" for r in d["skills"].values())
            print(f"✓ {key}: 審核 {len(d['skills'])} 項、標記 {flags}、花 {d['spent']} 點（{d['model']}）")
        else:
            occ = "／".join(v["choice"] for v in d["occupations"].values())
            print(f"✓ {key}: {occ}、{len(d['skills'])} 項技能（{d['model']}）")


if __name__ == "__main__":
    main()
