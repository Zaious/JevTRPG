# -*- coding: utf-8 -*-
"""送出去之前把聯絡資訊拔掉。

Jev 是雲端 API：**放進 state 的每一個字都離開了這台機器**。履歷的個資密度很高，
而角色的職涯內容才是判斷需要的東西——電話、信箱、地址、生日一個都用不到。

這不是萬靈丹（人名可能藏在自我介紹裡、公司名本身就有識別性），只是把最確定
用不到的那幾類先清掉。最終責任在使用者，所以 CLI 一律提供 --dry-run。
"""
from __future__ import annotations

import re

PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "[信箱]"),
    (re.compile(r"(?<!\d)(?:\+?886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)"), "[手機]"),
    (re.compile(r"(?<!\d)0\d{1,2}[- ]?\d{6,8}(?!\d)"), "[市話]"),
    (re.compile(r"(?<![A-Za-z])[A-Z][12]\d{8}(?![A-Za-z0-9])"), "[身分證]"),
    (re.compile(r"https?://\S*(?:linkedin|facebook|instagram|threads)\S*", re.I), "[社群連結]"),
    (re.compile(r"(?:^|\n)\s*(?:地址|住址|通訊地址)\s*[:：].*"), "\n[地址]"),
    (re.compile(r"(?:^|\n)\s*(?:生日|出生年月日)\s*[:：].*"), "\n[生日]"),
]


def redact(text: str):
    """回傳 (清理後的文字, 每一類被拔掉幾處)。"""
    hits = {}
    for pattern, tag in PATTERNS:
        text, n = pattern.subn(tag, text)
        if n:
            hits[tag] = hits.get(tag, 0) + n
    return text, hits
