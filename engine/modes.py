# -*- coding: utf-8 -*-
"""兩個模式，同一個引擎。

  build  一份履歷／自介／角色背景 → 一張角色卡。
         `cap=False`（履歷版）不套點數上限：那張卡的賣點是「這份文件有多強」，
         攤薄就失去意義，它本來就不是要拿去跑團的卡。
         `cap=True`（角色版）套上限：那是真的要拿去玩的角色。
  check  一份角色背景 + 玩家填好的技能表 → 哪幾項背景撐不起來。一定套上限，
         因為在這個場景裡點數上限本身就是要檢查的東西之一（bonus 給房規額外點）。

題目措辭全部在系統包的 prompts: 區塊，不寫在這裡——網站的 Worker 是 JS，
措辭留在 Python 裡兩邊一定會漂。
"""
from __future__ import annotations

import hashlib
import re
import time

from . import scoring
from .client import get_client
from .redact import redact


def _q(sys_, key):
    return sys_.prompt(key)


def _build_questions(sys_, skills):
    from typesafe_sdk import Choice, Score
    levels = sys_.levels
    clause = _q(sys_, "build_evidence_clause")
    q = {"edu": Score(instructions=_q(sys_, "education"), criteria=sys_.education()[0])}
    for era in (sys_.d.get("occupation_sets") or {}):
        q[f"occ::{era}"] = Choice(instructions=_q(sys_, "occupation"),
                                  criteria=sys_.table("occupation_sets", era))
    for cid, spec in skills.items():
        ev = spec.get("evidence")
        # 問題用該語系的 label，但 key 用 canonical id，兩者不要混
        q[f"s::{cid}"] = Score(
            instructions=_q(sys_, "build").format(
                name=spec["label"], meaning=spec["meaning"],
                evidence=clause.format(evidence=ev) if ev else ""),
            criteria=levels)
    for name in (sys_.d.get("backstory") or {}):
        label = ((sys_.loc.get("backstory_titles") or {}).get(name)) or name
        q[f"b::{name}"] = Choice(instructions=_q(sys_, "backstory").format(name=label),
                                 criteria=sys_.table("backstory", name))
    return q


def build(sys_, text, include_unreachable=False, dry_run=False, cap=False, bonus=0,
          chars_override=None):
    """chars_override：玩家自己填了特性值就照填的算，不擲骰、不讓模型判 EDU。"""
    text, hits = redact(text.strip())
    skills = sys_.skills(include_unreachable)
    q = _build_questions(sys_, skills)
    if dry_run:
        return {"dry_run": True, "state": text, "redacted": hits, "questions": len(q)}

    client = get_client()
    t0 = time.perf_counter()
    r = client.system_one(state=text, model="jev-latest", questions=q)
    ms = round((time.perf_counter() - t0) * 1000)
    a = r.answers

    edu_values = sys_.education()[1]
    edu = scoring.read(a["edu"], edu_values, edu_values)["value"]
    chars = sys_.roll_characteristics(int(hashlib.sha256(text.encode()).hexdigest()[:8], 16))
    chars["EDU"] = edu
    for k, v in (chars_override or {}).items():
        chars[k] = v
    budget = sys_.budget(chars)
    budget["occupation"] += bonus

    rows = {}
    for cid, spec in skills.items():
        base = int(spec["base"])
        values = [base] + list(sys_.d["evidence_value"])[1:]
        row = scoring.read(a[f"s::{cid}"], values, sys_.d["evidence_ceiling"])
        row["base"] = base
        row["label"] = spec["label"]
        rows[cid] = row

    final, used, left = (None, [], 0)
    if cap:
        final, used, left = scoring.allocate(rows, sum(budget.values()))

    return {"model": r.model, "latency_ms": ms, "tokens": r.usage.input_tokens,
            "redacted": hits, "chars": chars, "derived": sys_.derived(chars),
            "rows": rows, "budget": budget, "capped": cap, "final": final, "occupation_skills": used, "points_left": left,
            "occupations": {k.split("::")[1]: a[k] for k in a if k.startswith("occ::")},
            "backstory": {k.split("::")[1]: a[k] for k in a if k.startswith("b::")}}


def split_sections(text, sections):
    """依別名表切區塊。標記要在行首；【】、[]、［］都認；英文不分大小寫。
    同一套邏輯在 web/worker/src/index.js 的 splitSections，改一邊要改另一邊。"""
    alias = {}
    for key, names in sections.items():
        for n in names:
            alias[n.lower()] = key
    names = sorted(alias, key=len, reverse=True)       # 長的先比：背景故事 先於 背景
    pat = re.compile(r"^[ \t]*[【\[［]\s*(" + "|".join(re.escape(n) for n in names)
                     + r")\s*[】\]］]", re.M | re.I)
    hits = list(pat.finditer(text))
    out = {}
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(text)
        key = alias[m.group(1).lower()]
        out[key] = (out.get(key, "") + "\n" + text[m.end():end]).strip()
    return out


def parse_character(text, sections, aliases=None):
    """aliases = System.char_aliases；給了就把「幸運」「筋力」這類名字換回代碼。
    同一套邏輯在 web/worker/src/index.js 的 parseCharacter。"""
    s = split_sections(text, sections)
    chars, claimed = {}, {}
    for k, v in re.findall(r"([A-Za-z\u3040-\u30ff\u4e00-\u9fff]+)\s*[:：]?\s*(\d+)",
                           s.get("characteristics", "")):
        key = (aliases or {}).get(k.lower()) or (k.upper() if k.isascii() else k)
        chars[key] = int(v)
    for line in s.get("skills", "").splitlines():
        m = re.match(r"\s*(.+?)\s*[:：]?\s+(\d+)\s*%?\s*$", line)
        if m:
            claimed[m.group(1).strip()] = int(m.group(2))
    state = {"角色": s.get("character", ""), "背景": s.get("backstory", "")}
    return state, chars, claimed


def check(sys_, text, bonus=0, dry_run=False):
    from typesafe_sdk import Score
    text, hits = redact(text)
    state, chars, claimed = parse_character(text, sys_.sections, sys_.char_aliases)
    if not claimed:
        raise SystemExit("角色卡裡找不到【技能】區塊，或沒有「名稱 數值」格式的行")

    clause = _q(sys_, "build_evidence_clause")
    q = {}
    for n, v in claimed.items():
        spec = sys_._match(n) or {}
        m = spec.get("meaning") or _q(sys_, "unknown_skill")
        ev = spec.get("evidence")
        q[f"sup::{n}"] = Score(
            instructions=_q(sys_, "check").format(
                name=n, value=v, meaning=m,
                evidence=clause.format(evidence=ev) if ev else ""),
            criteria=sys_.levels)
    if dry_run:
        return {"dry_run": True, "state": state, "chars": chars, "claimed": claimed,
                "redacted": hits, "questions": len(q),
                "unknown_skills": [n for n in claimed if not sys_.meaning(n)]}

    client = get_client()
    t0 = time.perf_counter()
    r = client.system_one(state=state, model="jev-latest", questions=q)
    ms = round((time.perf_counter() - t0) * 1000)

    budget = sys_.budget(chars)
    budget["occupation"] += bonus
    spent = sum(max(0, v - sys_.base(n)) for n, v in claimed.items())

    rows = {}
    for n, v in claimed.items():
        row = scoring.read(r.answers[f"sup::{n}"], sys_.d["evidence_ceiling"],
                           sys_.d["evidence_ceiling"])
        row.update({"claimed": v, "base": sys_.base(n), "known": sys_.meaning(n) is not None})
        if row["split"]:
            row["verdict"] = "爭議"
        elif v <= row["ceiling"]:
            row["verdict"] = "ok"
        elif v - row["ceiling"] <= 10:
            row["verdict"] = "邊緣"
        else:
            row["verdict"] = "撐不起"
        rows[n] = row

    return {"model": r.model, "latency_ms": ms, "tokens": r.usage.input_tokens,
            "redacted": hits, "chars": chars, "derived": sys_.derived(chars), "bonus": bonus,
            "budget": budget, "spent": spent, "rows": rows}
