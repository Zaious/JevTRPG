# -*- coding: utf-8 -*-
"""載入一個系統包。引擎不認識任何規則——規則全在 systems/<name>/system.yaml。

換一套 TRPG＝複製一份 system.yaml 改掉，engine/ 一行都不用動。

語系：結構（base、骰式、預算公式、reachable）只有一份，在 system.yaml；
各語言只覆寫**字串**，放 systems/<name>/locales/<lang>.yaml。這樣加一個語言
不會複製一份規則，也就不會漂。技能的 key 永遠是正體中文那個 id（分享連結與
check 模式的比對都靠它），各語言只換 label。
"""
from __future__ import annotations

import os
import random
import re

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICE = re.compile(r"^(\d+)d(\d+)(?:\+(\d+))?$")
FORMULA_OK = re.compile(r"^[A-Za-z_ 0-9+\-*/().]+$")
BASE_LANG = "zh-Hant"


class System:
    def __init__(self, name: str, locale: str = BASE_LANG):
        path = os.path.join(ROOT, "systems", name, "system.yaml")
        if not os.path.isfile(path):
            raise SystemExit(f"找不到系統包：{path}")
        self.name = name
        self.locale = locale
        self.d = yaml.safe_load(open(path, encoding="utf-8"))
        self.loc = self._load_locale(name, locale)
        self._validate()

    # ── 語系 ──────────────────────────────────────────────────────────
    @staticmethod
    def locales(name):
        d = os.path.join(ROOT, "systems", name, "locales")
        found = [BASE_LANG]
        if os.path.isdir(d):
            found += sorted(f[:-5] for f in os.listdir(d) if f.endswith(".yaml"))
        return found

    def _load_locale(self, name, locale):
        if locale == BASE_LANG:
            return {}
        path = os.path.join(ROOT, "systems", name, "locales", f"{locale}.yaml")
        if not os.path.isfile(path):
            raise SystemExit(f"沒有這個語系：{path}（有的：{self.locales(name)}）")
        return yaml.safe_load(open(path, encoding="utf-8")) or {}

    def _validate(self):
        need = ["skills", "evidence_levels", "evidence_ceiling", "evidence_value",
                "characteristics", "education_levels", "budget", "prompts"]
        missing = [k for k in need if k not in self.d]
        if missing:
            raise SystemExit(f"系統包缺少欄位：{missing}")
        n = len(self.d["evidence_levels"])
        for k in ("evidence_ceiling", "evidence_value"):
            if len(self.d[k]) != n:
                raise SystemExit(f"{k} 的長度要跟 evidence_levels 一樣（{n}）")
        for s, v in self.d["skills"].items():
            if "meaning" not in v or "base" not in v:
                raise SystemExit(f"技能「{s}」缺 base 或 meaning")
        # 技能條目用行內 {} 寫法時，值裡有沒加引號的逗號會被 YAML 當欄位分隔：
        # `meaning: opening, picking locks, evidence: ...` 讀成 meaning="opening" 加一個
        # 值為 null 的多餘鍵，定義句只剩第一個詞，而且不報錯。英文包曾因此有 17 項被截斷
        # （2026-09-30 才發現，見 experiments/README.md）。所以鍵集合與非空字串都要驗。
        for s, v in self.d["skills"].items():
            extra = set(v) - {"base", "meaning", "evidence", "reachable"}
            if extra:
                raise SystemExit(f"技能「{s}」有多餘的鍵 {sorted(extra)[:3]}：行內 {{}} 裡的值含逗號要加引號")
        for s, t in (self.loc.get("skills") or {}).items():
            extra = set(t) - {"label", "meaning", "evidence", "family", "aliases"}
            if extra:
                raise SystemExit(f"語系 {self.locale} 技能「{s}」有多餘的鍵 {sorted(extra)[:3]}：行內 {{}} 裡的值含逗號要加引號，"
                                 f"不然定義句會被截斷成第一個逗號之前")
            for f in ("label", "meaning", "evidence"):
                if not isinstance(t.get(f), str) or not t[f].strip():
                    raise SystemExit(f"語系 {self.locale} 技能「{s}」的 {f} 是空的或不是字串")
        if self.loc:
            miss = [k for k in self.d["skills"] if k not in (self.loc.get("skills") or {})]
            if miss:
                raise SystemExit(f"語系 {self.locale} 少了 {len(miss)} 項技能：{miss[:5]}…")
            for k in ("prompts", "evidence_levels", "education_levels"):
                if k not in self.loc:
                    raise SystemExit(f"語系 {self.locale} 缺 {k}")

    # ── 查詢 ──────────────────────────────────────────────────────────
    @property
    def title(self):
        return self.loc.get("title") or self.d.get("title", self.name)

    @property
    def levels(self):
        return list(self.loc.get("evidence_levels") or self.d["evidence_levels"])

    @property
    def sections(self):
        """角色卡區塊標記的別名表：{section: [alias, ...]}。"""
        return self.d.get("input_sections") or {
            "character": ["角色"], "backstory": ["背景故事"],
            "characteristics": ["特性值"], "skills": ["技能"]}

    def prompt(self, key):
        return (self.loc.get("prompts") or {}).get(key) or self.d["prompts"][key]

    def skills(self, include_unreachable=False):
        """回傳 {canonical_id: {base, label, meaning, evidence, reachable}}。
        label 是這個語系顯示與提問用的名字；key 永遠是正體中文那個 id。"""
        out = {}
        tr = self.loc.get("skills") or {}
        for k, v in self.d["skills"].items():
            if not (include_unreachable or v.get("reachable", True)):
                continue
            t = tr.get(k) or {}
            out[k] = {"base": int(v["base"]),
                      "label": t.get("label", k),
                      "meaning": t.get("meaning", v["meaning"]),
                      "evidence": t.get("evidence", v.get("evidence")),
                      "reachable": v.get("reachable", True)}
        return out

    def table(self, group, key=None):
        """職業與背景表：回傳 {顯示名: 說明}，已套語系。"""
        base = self.d.get(group) or {}
        tr = (self.loc.get(group) or {})
        if key is not None:
            base, tr = base.get(key) or {}, tr.get(key) or {}
        return {(tr.get(k) or {}).get("label", k): (tr.get(k) or {}).get("desc", v)
                for k, v in base.items()}

    def base(self, skill_name: str) -> int:
        v = self._match(skill_name)
        return int(v["base"]) if v else 5

    def meaning(self, skill_name: str):
        v = self._match(skill_name)
        return v.get("meaning") if v else None

    def _match_id(self, name):
        """使用者打的技能名 → canonical id；認不出來或有歧義回 None（寧可標未知，不猜）。
        同一套邏輯在 web/worker/src/index.js 的 matchSkillId，改一邊要改另一邊
        （web/worker/fixtures.json 的 matching 樣本由這裡算、test.mjs 對答案）。

        ⚠ 不能先砍括號再模糊比對：Language (Own) 與 Language (Other) 砍完都是 "language"，
        誰贏取決於字典順序——Python 與 Worker 的順序剛好相反，各錯一個方向（2026-09-30）。"""
        norm = lambda s: re.sub(r"\s+", " ", str(s).lower().replace("（", "(").replace("）", ")")).strip()  # noqa: E731
        full = norm(name)
        sk = self.skills(include_unreachable=True)
        names = {k: {norm(k), norm(v["label"]), *(norm(a) for a in self._aliases(k))} for k, v in sk.items()}
        hit = [k for k in sk if full in names[k]]                     # 1 全名（含括號）完全相同
        if len(hit) == 1:
            return hit[0]
        bare = re.split(r"\(", full)[0].strip()                       # 2 去掉尾端限定詞：外語（英文）→外語
        if bare != full:
            hit = [k for k in sk if bare in names[k] or bare == norm(self._family(k))]
            if len(hit) == 1:
                return hit[0]
            if hit:
                return None
        hit = [k for k in sk if any(bare in n or n in bare for n in names[k])]   # 3 子字串，唯一命中才算
        return hit[0] if len(hit) == 1 else None

    def _aliases(self, cid):
        """語系檔可為技能宣告 aliases：玩家常寫、但不是標籤的名字（日文「外国語」對「他言語」）。"""
        return ((self.loc.get("skills") or {}).get(cid) or {}).get("aliases") or []

    def _family(self, cid):
        """語系檔可為技能宣告 family：Language (French) 這種「同一族的寫法」歸到 Language (Other)。"""
        return ((self.loc.get("skills") or {}).get(cid) or {}).get("family") or ""

    def _match(self, name):
        cid = self._match_id(name)
        return self.skills(include_unreachable=True)[cid] if cid else None

    def education(self):
        rows = self.loc.get("education_levels") or self.d["education_levels"]
        vals = [e["value"] for e in self.d["education_levels"]]
        return [e["level"] for e in rows], vals

    def roll_characteristics(self, seed: int):
        rng = random.Random(seed)
        out = {}
        for key, spec in self.d["characteristics"].items():
            if "dice" in spec:
                m = DICE.match(spec["dice"])
                if not m:
                    raise SystemExit(f"{key} 的骰式看不懂：{spec['dice']}")
                n, faces, plus = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
                out[key] = (sum(rng.randint(1, faces) for _ in range(n)) + plus) * spec.get("mul", 1)
        return out

    def budget(self, chars: dict) -> dict:
        out = {}
        for k, formula in self.d["budget"].items():
            if not FORMULA_OK.match(formula):
                raise SystemExit(f"budget.{k} 的公式含不允許的字元：{formula}")
            out[k] = int(eval(formula, {"__builtins__": {}}, dict(chars)))  # noqa: S307
        return out

    @property
    def char_aliases(self) -> dict:
        """{別名小寫: 特性值代碼}。代碼本身也算一個別名。"""
        out = {}
        for k, spec in self.d["characteristics"].items():
            for a in [k, *(spec.get("aliases") or [])]:
                out[str(a).lower()] = k
        return out

    def derived(self, chars: dict) -> dict:
        """HP／MP／SAN 這類衍生值。需要的特性值缺了就不算（不擲骰補）。"""
        out = {}
        for k, formula in (self.d.get("derived") or {}).items():
            if not FORMULA_OK.match(formula):
                raise SystemExit(f"derived.{k} 的公式含不允許的字元：{formula}")
            try:
                out[k] = int(eval(formula, {"__builtins__": {}}, dict(chars)))  # noqa: S307
            except NameError:
                continue
        return out
