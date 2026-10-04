# CLAUDE.md — JevTRPG 專案說明（給 Claude Code 與貢獻者）

> **JevTRPG** — 貼上履歷，得到一張 1920 年代風的調查員角色卡。判讀由 TypeSafe 的 Jev 做。非官方、免費、履歷不儲存。

## 一句話

把履歷（或角色背景）交給 Jev，每項技能問一題「這份文件對它交代到什麼程度」，用回傳的機率印成 d100 跑團角色卡；另有 KP 審核模式，檢查玩家寫的技能撐不撐得起背景。

## 文件導覽

| 檔案 | 內容 |
| --- | --- |
| `README.md` | 英文總覽、怎麼跑、怎麼測 |
| `web/README.md` | 網站結構、分享連結編碼、遮蔽、用量額度、部署、站名與三語、隱私聲明要與實際一致的規則 |
| `systems/coc/README.md` | 系統包的授權界線與怎麼改 |
| `experiments/README.md` | 準確度實驗與已知答案測試的結果 |

## 工作規則

1. **規則資料只有一份真相：`systems/<name>/system.yaml`。** 技能、量表、題目措辭都在那裡，`python web/build.py` 編成 `web/worker/system.js`。**不要手改 `system.js`。**
2. **計分有兩份實作（Python 與 Worker JS）**，這是唯一刻意的重複。改任何一邊先跑 `node web/worker/test.mjs`；兩邊對不上就 exit 1。
3. **改技能、職業、背景選項、特性值之後，部署前必須先跑 `node web/worker/wire-freeze.mjs`。** 分享連結只記「第幾項」，表一變舊連結就失效；歷代的表凍結在 `wire-frozen.js`，只增不改。測試會擋沒凍結的、也擋刪除或改名（只能新增）。
4. **隱私聲明要跟實際一致。** 改了任何一項（換掉分析工具、多記一種資料、改遮蔽規則）就同步改 `public/i18n.js` 的隱私文字，再跑 `node web/sync-static.mjs`；`--check` 在 `test.mjs` 裡擋漂移。
5. **履歷與使用者貼的文字絕不進分析事件、日誌或錯誤訊息。** 事件只記頁面、語言、模式、狀態碼與我們自己的錯誤代碼。
6. **錯誤要讓使用者看得懂。** Worker 回穩定的 `code`，前端依語言說「怎麼辦」；不要把上游的原始訊息丟給使用者。
7. **第三方（廣告、分析、人機驗證）一律由 `GET /api/config` 決定，沒設定就整套不啟動。** 公開倉庫的預設設定全是空的。
8. **量測優於估算。** 準確度、字數、檔案大小一律用腳本量並報實際數字；e2e 的 ✗ 與 console 錯誤會讓 `npm run e2e` 以非零結束。
9. **測試對已知答案。** 計分對 Python 算出的固定樣本、連結編解碼對「舊程式做出來的真連結」、遮蔽對「要遮的」與「絕不能誤遮的（日期、年份、金額）」。

## 語言

- README 英文；`web/README.md`、本檔與程式註解以繁體中文為主。
- 介面與判準三語（繁中、日文、英文）；繁中是正本，日文是機翻未校對。

## 開發

```bash
pip install -r requirements.txt
python web/build.py
node web/worker/test.mjs
cd web/worker && npm ci && npm run dev      # 另開一個終端機：npm run e2e
```

## 不做的事

不存履歷、不做帳號、不做資料庫、不把判讀結果當能力評估。
