#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""KP 檢查模式的判準準不準？——按構造已知答案的測試，三語各自對答案。

為什麼這樣設計：上一輪 A/B（locale_ab.py）只能比「跟中文一不一致」，沒有標準答案就不能說
哪個語言比較對。這裡反過來：**先決定每項技能在每份文件裡該是哪一級，再照那個等級寫句子**，
答案是構造出來的，跟任何語言、任何模型都無關。

  - 10 項技能 × 4 個等級（1–4）各一句，中英日各寫一份（BANK）。第 0 級＝這項技能一個字都不寫。
  - 30 份文件；每項技能在 30 份裡恰好各級出現 6 次（每項技能各自洗牌），句子順序也洗過，
    三個語言用同一組種子，所以同一份文件在三語裡的答案、組合、順序完全一樣。
  - 對每份文件用該語言的判準問 10 題（檢查模式的題目），預期等級 = Σ p_i × i，跟設計等級比。

看四個數字：MAE（平均差幾級）、bias（平均偏高還偏低）、等級相關、以及「設計等級 → 平均預測等級」
的校準曲線（哪一級被讀歪）。**雜訊地板**先量：同一語言重跑，數字本來會動多少。

  python experiments/checkbench.py                 # 30 份 × 3 語 = 90 次呼叫
  python experiments/checkbench.py --lang en       # 只跑一個語言
  python experiments/checkbench.py --tag after     # 輸出存 runs/checkbench.<tag>.json
"""
import argparse
import json
import os
import random
import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from engine import modes              # noqa: E402
from engine.system import System      # noqa: E402

LANGS = ["zh-Hant", "en", "ja"]

# 技能 canonical id → 第 1–4 級的句子 [zh, en, ja]。
# 級別定義照系統包的量表：1 提到相關環境或接觸（沒說這個人會）、2 交代學習或接觸的管道、
# 3 交代實際運用的經歷、4 交代長期專業程度的訓練或經歷。每句只談這一項技能，不夾帶別項。
BANK = {
    "圖書館使用": [
        ["她大學時的室友在圖書館打工。", "Her college roommate worked part-time at the library.", "大学時代のルームメイトは図書館でアルバイトをしていた。"],
        ["大學有一門課教她怎麼使用圖書館的資料庫與檔案目錄。", "A university course taught her how to use the library's databases and archive catalogues.", "大学の授業で、図書館のデータベースと文書目録の使い方を習った。"],
        ["她為了寫報告，曾在檔案館翻找過幾份舊報紙與公文。", "For a report she once dug through an archive for several old newspapers and official records.", "レポートのために、文書館で古い新聞や公文書を何点か探し出したことがある。"],
        ["她當了十二年的研究館員，每天負責替人從館藏與資料庫裡找出資料。", "She worked twelve years as a research librarian, finding material for people in the collection and databases every day.", "研究司書として十二年間、毎日、蔵書とデータベースから利用者の求める資料を探し出してきた。"],
    ],
    "電腦使用": [
        ["她的父親開過一間電腦維修行。", "Her father ran a computer repair shop.", "父はパソコン修理店を経営していた。"],
        ["她高中時選修過一學期的程式設計課。", "She took a one-semester programming elective in high school.", "高校で一学期だけプログラミングの選択授業を取った。"],
        ["她用 Python 寫過整理公司報表的小工具，同事都在用。", "She wrote a small Python tool to tidy the company's reports, and her colleagues use it.", "会社の報告書を整理する小さな Python ツールを書き、同僚が使っている。"],
        ["她當了十年的軟體工程師，負責維護公司的資料庫與後端系統。", "She has been a software engineer for ten years, maintaining the company's databases and backend systems.", "ソフトウェアエンジニアとして十年、社内のデータベースとバックエンドを保守してきた。"],
    ],
    "鎖匠": [
        ["她老家隔壁就是一間鎖店。", "The shop next door to her childhood home was a locksmith's.", "実家の隣は鍵屋だった。"],
        ["她在社區大學上過一堂鎖具與保全的入門課。", "She took an introductory lock-and-security class at a community college.", "市民講座で、鍵と防犯の入門講座を受けた。"],
        ["朋友被鎖在門外時，她曾用工具撬開過好幾次門鎖。", "When friends were locked out, she has picked their door locks several times with tools.", "友人が締め出されたとき、道具を使って何度か鍵を開けたことがある。"],
        ["她做了十五年的專業鎖匠，替人開鎖、換鎖、開保險櫃。", "She has been a professional locksmith for fifteen years, opening and changing locks and opening safes.", "プロの鍵師として十五年、開錠・交換・金庫開けを請け負ってきた。"],
    ],
    "攀爬": [
        ["她家住在山腳下，窗外就是一面岩壁。", "Her home sits at the foot of a mountain, with a rock face outside the window.", "家は山のふもとにあり、窓の外には岩壁が見える。"],
        ["她大學時參加登山社，學過基本的繩結與攀岩安全。", "In college she joined the mountaineering club and learned basic knots and climbing safety.", "大学の山岳部で、基本的なロープワークとクライミングの安全を学んだ。"],
        ["她曾用繩索攀登過幾面中等難度的岩壁。", "She has climbed several rock faces of moderate grade using ropes.", "ロープを使って、中級程度の岩壁をいくつか登ったことがある。"],
        ["她是職業登山嚮導，帶隊攀登岩壁與高山已經二十年。", "She is a professional mountain guide who has led rock and alpine climbs for twenty years.", "職業山岳ガイドとして、二十年にわたり岩壁や高山への登攀を率いてきた。"],
    ],
    "說服": [
        ["她的姊姊是保險業務員。", "Her older sister sells insurance.", "姉は保険の営業をしている。"],
        ["她修過一門說服與簡報技巧的選修課。", "She took an elective on persuasion and presentation skills.", "説得とプレゼンテーションの技法についての選択科目を履修した。"],
        ["她曾在部門會議上說服主管採納她的預算方案，方案也通過了。", "She once persuaded her manager in a department meeting to adopt her budget plan, and it went through.", "部署の会議で上司を説得して自分の予算案を採用してもらい、承認された。"],
        ["她當了十年的顧問，工作就是說服客戶高層接受改革方案。", "She has been a consultant for ten years, and her job is to persuade client executives to accept reform plans.", "コンサルタントとして十年、クライアントの経営層に改革案を受け入れさせることが仕事だった。"],
    ],
    "醫學": [
        ["她的舅舅是醫生。", "Her uncle is a doctor.", "叔父は医者だ。"],
        ["她修過一學期的醫學概論通識課。", "She took a one-semester general-education course on introductory medicine.", "一学期だけ医学概論の教養科目を履修した。"],
        ["她在診所當過兩年的行政助理，也協助醫師量血壓、做基本檢查。", "She worked two years as a clinic assistant, helping the doctor with blood pressure and basic examinations.", "クリニックで二年間事務助手を務め、医師の血圧測定や基本的な検査も手伝った。"],
        ["她是執業十八年的內科醫師，每天診斷病患並開立處置。", "She is an internist with eighteen years of practice, diagnosing patients and prescribing treatment every day.", "内科医として十八年、毎日患者を診断し治療方針を立てている。"],
    ],
    "駕駛汽車": [
        ["她的父親是計程車司機。", "Her father drove a taxi.", "父はタクシー運転手だった。"],
        ["她十八歲那年上了駕訓班，拿到駕照。", "At eighteen she attended driving school and got her licence.", "十八歳で教習所に通い、免許を取得した。"],
        ["她每天開車通勤，也開車跑過幾次長途的南北往返。", "She drives to work every day and has made several long north-south trips by car.", "毎日車で通勤し、南北を往復する長距離運転も何度かこなした。"],
        ["她當了十二年的貨運司機，開過各種路況與緊急狀況。", "She was a freight driver for twelve years and drove in every kind of road condition and emergency.", "貨物ドライバーとして十二年、あらゆる路面状況や緊急事態の中で運転してきた。"],
    ],
    "外語": [
        ["她的鄰居是法國人。", "Her neighbour is French.", "隣人はフランス人だ。"],
        ["她大學時選修過一年的初級法語。", "She took a year of beginner French in college.", "大学で一年間、初級フランス語を履修した。"],
        ["她去法國自助旅行時，曾用法語點餐、問路與訂房。", "On a solo trip to France she ordered food, asked directions and booked rooms in French.", "フランスへの一人旅では、フランス語で注文や道の確認、宿の予約をした。"],
        ["她在巴黎住了十年，日常與工作都用法語，還通過了最高級的法語檢定。", "She lived in Paris for ten years, used French daily and at work, and passed the highest-level French proficiency exam.", "パリに十年住み、日常も仕事もフランス語で行い、最上級のフランス語検定にも合格した。"],
    ],
    "攝影": [
        ["她的祖父開過照相館。", "Her grandfather once ran a photo studio.", "祖父は写真館を営んでいた。"],
        ["她參加過一場週末的攝影工作坊，學了曝光與構圖。", "She attended a weekend photography workshop and learned exposure and composition.", "週末の写真ワークショップに参加し、露出と構図を学んだ。"],
        ["她幫朋友拍過兩場婚禮的照片，也自己沖洗過底片。", "She photographed two weddings for friends and has developed film herself.", "友人の結婚式を二度撮影し、フィルムの現像も自分で行った。"],
        ["她是專業攝影師，做了十五年的商業與紀實攝影，作品曾在展覽中發表。", "She is a professional photographer with fifteen years in commercial and documentary work, and her work has been shown in exhibitions.", "プロの写真家として十五年、商業写真とドキュメンタリーを手がけ、作品は展覧会でも発表されている。"],
    ],
    "領導": [
        ["她的父親管理過一間工廠。", "Her father managed a factory.", "父は工場を経営していた。"],
        ["她參加過一次為期兩天的團隊領導力訓練營。", "She attended a two-day team-leadership training camp.", "二日間のチームリーダーシップ研修に参加した。"],
        ["她曾擔任社團召集人，分配工作、帶著十個人完成了整年的活動。", "She once convened a club, assigning work and leading ten people through the year's events.", "サークルの代表として、仕事を割り振り、十人を率いて年間行事をやり遂げた。"],
        ["她做了十年的部門經理，長期帶領三十人的團隊。", "She has been a department manager for ten years, long leading a team of thirty.", "部長として十年、三十人のチームを長く率いてきた。"],
    ],
}
FILLER = ["她喜歡在週末煮飯給朋友吃。", "She likes cooking for friends on weekends.", "週末は友人に料理をふるまうのが好きだ。"]
INTRO = ["林小雅，三十二歲。", "Lin Xiaoya, thirty-two.", "林小雅、三十二歳。"]
HEAD = {  # 區塊標記（三語的解析器都認）
    "zh-Hant": ("【角色】", "【背景故事】", "【特性值】", "【技能】"),
    "en": ("[Character]", "[Backstory]", "[Stats]", "[Skills]"),
    "ja": ("【キャラクター】", "【背景】", "【能力値】", "【スキル】"),
}
# --rename：把 10 項技能換成系統包**不認得**的同義說法，答案不變。用來量「沒有定義、只能照字面理解」的代價
# （未知技能的題目只有「這個系統包裡沒有這項技能的定義，模型只能照字面理解」）。
SYNONYMS = {
    "zh-Hant": {"圖書館使用": "資料檢索", "電腦使用": "寫程式", "鎖匠": "開鎖", "攀爬": "攀岩", "說服": "勸說", "醫學": "看診",
                "駕駛汽車": "開車", "外語": "法語", "攝影": "拍照", "領導": "帶團隊"},
    "en": {"圖書館使用": "Archive research", "電腦使用": "Programming", "鎖匠": "Lockpicking", "攀爬": "Mountaineering",
           "說服": "Convincing", "醫學": "Diagnosis", "駕駛汽車": "Driving a car", "外語": "French speaking",
           "攝影": "Taking pictures", "領導": "Team management"},
}
RENAME = False
N_DOCS = 30
SKILLS = list(BANK)


def design(seed=20260930):
    """每項技能在 N_DOCS 份裡各級（0–4）恰好各 N_DOCS/5 次；句子順序每份不同。"""
    rng = random.Random(seed)
    levels = {}
    for s in SKILLS:
        col = [lv for lv in range(5) for _ in range(N_DOCS // 5)]
        rng.shuffle(col)
        levels[s] = col
    docs = []
    for d in range(N_DOCS):
        truth = {s: levels[s][d] for s in SKILLS}
        order = [s for s in SKILLS if truth[s] > 0]
        rng.shuffle(order)
        docs.append({"truth": truth, "order": order})
    return docs


def render(doc, li, sys_):
    hc, hb, hs, hk = HEAD[sys_.locale]
    sent = [INTRO[li]] + [BANK[s][doc["truth"][s] - 1][li] for s in doc["order"]] + [FILLER[li]]
    sep = " " if sys_.locale == "en" else ""
    labels = {s: (SYNONYMS[sys_.locale][s] if RENAME else sys_.skills(include_unreachable=True)[s]["label"]) for s in SKILLS}
    return (f"{hc}{INTRO[li]}\n\n{hb}\n{sep.join(sent[1:])}\n\n{hs}\nEDU 65  INT 70\n\n{hk}\n"
            + "\n".join(f"{labels[s]} 50" for s in SKILLS)), labels


def spearman(xs, ys):
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r, i = [0.0] * len(v), 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    mx, my = st.fmean(rx), st.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else 0.0


def expected_level(row):
    p = row["probabilities"]
    return sum(int(k) * float(v) for k, v in p.items())


def run_lang(lang, docs, first=None):
    li = LANGS.index(lang)
    sys_ = System("coc", lang)
    preds = []
    for i, doc in enumerate(docs[:first]):
        text, labels = render(doc, li, sys_)
        out = modes.check(sys_, text)
        rows = out["rows"]
        preds.append({s: expected_level(rows[labels[s]]) for s in SKILLS})
        if (i + 1) % 10 == 0:
            print(f"    {lang} {i + 1}/{len(docs[:first])}", flush=True)
    return preds


def report(lang, docs, preds):
    err, per_level, per_skill = [], {lv: [] for lv in range(5)}, {s: [] for s in SKILLS}
    xs, ys = [], []
    for doc, p in zip(docs, preds):
        for s in SKILLS:
            t, y = doc["truth"][s], p[s]
            err.append(y - t)
            per_level[t].append(y)
            per_skill[s].append(y - t)
            xs.append(t); ys.append(y)
    return {"lang": lang, "n": len(err),
            "mae": st.fmean(abs(e) for e in err), "bias": st.fmean(err), "rho": spearman(xs, ys),
            "curve": {lv: st.fmean(v) for lv, v in per_level.items()},
            "skill_bias": {s: st.fmean(v) for s, v in per_skill.items()}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=LANGS)
    ap.add_argument("--tag", default="latest")
    ap.add_argument("--first", type=int, help="只跑前 N 份（試跑用）")
    ap.add_argument("--rename", action="store_true", help="用系統包不認得的同義說法（量沒有定義的代價；只有 zh-Hant 與 en）")
    ap.add_argument("--repeat", type=int, default=1, help="重跑幾次（量雜訊地板用）")
    a = ap.parse_args()

    global RENAME
    RENAME = a.rename
    docs = design()
    langs = [a.lang] if a.lang else (["zh-Hant", "en"] if a.rename else LANGS)
    res = {"docs": docs, "runs": {}}
    for lang in langs:
        res["runs"][lang] = []
        for rep in range(a.repeat):
            print(f"  {lang} 第 {rep + 1} 次", flush=True)
            res["runs"][lang].append(run_lang(lang, docs, a.first))

    print(f"\n{'語言':<9}{'MAE(級)':>8}{'bias(級)':>9}{'等級相關':>9}   校準曲線：設計等級 0 → 4 的平均預測等級")
    for lang in langs:
        r = report(lang, docs, res["runs"][lang][0])
        print(f"{lang:<9}{r['mae']:>8.2f}{r['bias']:>+9.2f}{r['rho']:>9.3f}   "
              + "  ".join(f"{r['curve'][lv]:.2f}" for lv in range(5)))
        res.setdefault("report", {})[lang] = r
    if a.repeat > 1:
        for lang in langs:
            r1, r2 = res["runs"][lang][:2]
            d = st.fmean(abs(x[s] - y[s]) for x, y in zip(r1, r2) for s in SKILLS)
            print(f"  雜訊地板 {lang}: 同一語言重跑平均差 {d:.3f} 級")
    print("\n逐項技能 bias（預測 − 設計，級；負＝判太嚴）")
    print(f"{'技能':<8}" + "".join(f"{l:>9}" for l in langs))
    for s in SKILLS:
        print(f"{s:<8}" + "".join(f"{res['report'][l]['skill_bias'][s]:>+9.2f}" for l in langs))
    out = os.path.join(ROOT, "runs", f"checkbench.{a.tag}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n→ {out}")


if __name__ == "__main__":
    main()
