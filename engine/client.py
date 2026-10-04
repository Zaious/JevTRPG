# -*- coding: utf-8 -*-
"""Jev API 的存取。金鑰只從環境變數或本倉根目錄的 .env.local 讀。

⚠ 文件會被送到 TypeSafe 的雲端 API。履歷與角色背景都是個資密度很高的東西，
   呼叫前一律先跑一次 --dry-run 看清楚要送出去什麼。engine/redact.py 負責
   把聯絡資訊拔掉，但它不是萬靈丹，最終責任在使用者。
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_key():
    key = os.environ.get("TYPESAFE_API_KEY")
    if key:
        return key
    env = os.path.join(ROOT, ".env.local")
    if os.path.isfile(env):
        for line in open(env, encoding="utf-8"):
            line = line.strip()
            if line.startswith("TYPESAFE_API_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return None


def get_client(timeout: float = 60.0):
    key = load_key()
    if not key:
        print("✗ 沒有 TYPESAFE_API_KEY。設環境變數，或在倉庫根目錄放一個 .env.local。",
              file=sys.stderr)
        sys.exit(1)
    from typesafe_sdk import TypeSafeClient
    # 不收 brotli。問題一多（約 40 題以上）回應就會大到觸發伺服器的 br 壓縮，
    # 而 httpx2 2.13 在 Brotli 1.1.0 這條分支上會呼叫 process(data, output_buffer_limit=...)
    # ——Brotli 的 Decompressor.process() 不吃關鍵字參數，直接 TypeError。
    # 這是上游的 bug，跟我們無關；指定 Accept-Encoding 繞開最乾淨，
    # 也不必動到其他專案共用的 brotli 套件。
    return TypeSafeClient(api_key=key, timeout=timeout,
                          headers={"Accept-Encoding": "gzip, deflate"})
