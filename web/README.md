# 站體

一站兩頁，靜態前端 ＋ 一支 Cloudflare Worker。**沒有資料庫，這是刻意的。**

```
web/
  build.py            systems/<name>/system.yaml → worker/system.js（唯一的轉換點）
  make_samples.py     重產首屏縮圖用的範例結果（打本機 /api，存 public/samples/）
  sync-static.mjs     把繁中正本同步進 privacy.html，並檢查 HTML 靜態文字沒有跟 i18n.js 漂開
  art/tentacles.py    產生觸手 SVG（沿脊線算輪廓與吸盤，不手描）
  public/
    index.html        A 頁：履歷 → 角色卡（不套點數上限）
    character.html    B 頁：角色技能設定與檢查（套上限，可加房規額外點）
    privacy.html      關於與隱私（工作室聲明；內文由 sync-static.mjs 從 i18n.js 產生）
    ads.txt           （不在倉庫裡）AdSense 發布者宣告，跟著各自的部署走；已列入 .gitignore
    app.js  style.css 兩頁共用
    art/              調查員照片、觸手（tentacle-a.svg 是產生物）
    samples/          範例實際跑出來的結果，六份（兩頁 × 三語），產生物
  worker/
    src/index.js      代打 Jev、遮蔽個資、計分、Turnstile
    system.js         產生物，別手改
    test.mjs          漂移閘：JS 的計分要跟 Python 算出一樣的答案
    fixtures.json     真實 API 回應抽出來的固定樣本
    shoot.mjs         本機截圖：首屏、結果卡、手機寬，順便抓橫向溢出與 console 錯誤
```

## 版面

一張擺在夜裡書桌上的 1920 年代調查員檔案。卡面三種墨各有工作：表格印好的字（橄欖墨）、
打字機填進去的值（藍黑墨）、Jev 拿不定與 KP 該問的地方（紅筆）。紅色是全站唯一的強調色。

**首屏的縮圖是範例實際跑出來的卡**，不是示意圖：`make_samples.py` 拿 `app.js` 裡的
範例文字打一次 `/api`，存成 `public/samples/*.json`，前端用同一支繪製程式縮小畫出來。
API 回傳的形狀或判準改了，就重跑一次（wrangler dev 要開著）。

卡的原型是原創的，不是任何官方角色卡的版面；印章、照片、觸手也都是原創圖。
字型走 Google Fonts（IM Fell English、Courier Prime、Noto Serif TC/JP）——中日文字型
太大，自架不划算。

## 三種狀態，只有一種需要後端

| | 落地嗎 | 放哪 |
|---|---|---|
| **履歷／背景故事** | **永遠不** | 只在一次 request 的記憶體裡；履歷頁在**瀏覽器**先遮掉個資與使用者列的字詞再送，Worker 收到後用同一份 `redact.js` 再遮一次 |
| **卡片** | 不用 | 編碼進網址 `#c=...`（約 80–90 字元），分享連結不需要後端存東西 |
| **防濫用** | 計數（不含內容） | Turnstile 分兩條額度＋12,000 字元上限＋Durable Object 計數（見下） |

**用量額度（2026-10-02 取代「驗證沒過就 403」）**：`src/quota.js` 的 Durable Object（全站一個實例，計數精確）。
人機驗證通過＝ok 額度（每 IP 每小時 30 次、全站每天 2000 次）；沒通過或沒帶憑證＝weak 額度（每 IP 每小時 4 次、
全站每天 150 次）。驗證不再擋人（實測 Windows 桌面 Chrome 一再出錯、那些人完全用不了），機器人繞過驗證也只拿得到
小額度；最壞花費 ≈ 2150 次判讀。數字在 `wrangler.toml` 的 `QUOTA_*` 變數，全站每天的計數在台北時間午夜重置。
IP 只存「加鹽 SHA-256 前 16 字元」、只記該小時的次數，過了這一小時就清掉（隱私頁有寫）。額度服務故障時：
驗證過的放行、沒驗證的擋下。超過回 429 `{code:"quota", scope:"hour"|"day"|"busy", tier}`，前端依語言說明。
外部監看可以用 `GET /api/quota-status`（要帶 `x-watch-token`）看今天各條額度用了多少。secrets：`QUOTA_SALT`、`QUOTA_STATUS_TOKEN`。

**限流仍然重要。** 金鑰在 Worker，任何人都能無限打；一份履歷約 1.7 萬 tokens
≈ 0.0007 美元，有人寫迴圈跑一晚就是三位數美金，而廣告收入是固定的。
真正的上限請在 **Security → WAF → Rate limiting rules** 對 `/api/*` 加一條
（每 IP 每分鐘幾次），那條在 Worker 之前就擋掉，比在程式裡數還省。

什麼時候才需要資料庫：社群分享要 OG 預覽圖（用 KV 快取）、要排行榜
（只存彙總計數，不存個案）、要帳號或付費。現在都不需要。

## 跑起來

```bash
python web/build.py                      # 編譯系統包
node web/worker/test.mjs                 # 漂移閘，251 項（含聲明文字不漂、分享連結編解碼、遮蔽、重骰、docx／txt 讀取）
cd web/worker && npm run dev             # 本機（wrangler dev，會一起服務 ../public）
cd web/worker && npm run e2e             # 瀏覽器測試（要先開著 npm run dev）：接線＋功能流程＋存成圖片＋拖檔／遮蔽／重骰，共 284 項
```

## 分享連結、拖檔、遮蔽、重骰

**分享連結**（`public/card-codec.js`，瀏覽器與測試共用）：卡上的字幾乎都來自系統包的有限清單，所以只記
「第幾項」——技能用位元圖、職業與背景選項各 1 byte、數值用 varint，最後 1 byte 校驗碼。實測 76–91 字元
（舊的 JSON＋base64 是 1232）。「第幾項」的對照表由 `GET /api/wire` 提供（排序過、附 16 位元指紋），
編碼與解碼兩邊讀同一份；**表變了（加技能、改職業清單）指紋就變，舊連結會顯示「舊版本讀不了」而不是被讀成別的東西**——
這是刻意的取捨：連結不保證永久有效，要永久就得有資料庫（見上面「什麼時候才需要資料庫」）。
連結內記著發送者的判準語言，所以英文卡在繁中介面下技能名稱仍是英文。

**拖檔**（`public/extract.js`）：PDF、.docx、純文字（.txt/.md，UTF-8 或 Big5）在瀏覽器裡讀成文字，**檔案不上傳**。
PDF 用自架的 pdf.js（`vendor/pdfjs/`，Apache-2.0，第一次拖 PDF 才載入約 1.7 MB；`cmaps/` 給沒嵌字型的中日文 PDF）；
docx 自己解 zip 抽 `word/document.xml`（不引入套件；只讀內文，不讀頁首頁尾）。讀不了就說原因：舊版 .doc、
壞檔、加密、太大（8 MB）、字太少（掃描成圖片的 PDF 需要 OCR，這裡不做）。**PDF 文字層常把「大、手、工、長」存成
部首字元**（⼤⼿⼯⻑，看起來一樣、碼不同），會讓姓名比對失靈，所以讀完會換回一般漢字——Kangxi 部首區用 NFKC，
部首補充區只換了名稱一目了然的幾個（`RADICAL` 表），沒列到的原樣留著。

**遮蔽**（`public/redact.js`，Worker 與瀏覽器共用同一份）：規則遮信箱、手機、市話、身分證、社群連結、有標籤的地址與生日（**2026-10-02 補了台灣以外的格式**：美／英／日電話、美國 SSN、英日文的 Address／DOB／住所／生年月日 標籤；原本只認台灣，英文版推廣前才發現；長得像電話的數字寧可誤遮）；
另外讓使用者列出**姓名、公司、學校**等字詞（規則抓不到這些），換成 `[已遮]`。履歷頁送出前在瀏覽器裡遮，
所以那些字不離開電腦；Worker 收到後再遮一次（不能假設請求一定來自我們的前端），前端另外回報「遮了什麼、幾個」
（只收已知標記、1–99 的整數）讓卡片頁腳誠實。有「看遮完的樣子」預覽。**限制**：沒有標籤的地址、夾在句子裡的姓名
抓不到；一個字的字詞不接受（會誤遮）。Python CLI（`engine/redact.py`）沒有字詞遮蔽，只有規則那層。
遮蔽模組載不到時**不送出**（寧可失敗，也不要讓人以為遮了其實沒遮）。

**重骰**（履歷頁的一般結果）：`POST /api/reroll` 只換擲骰的特性值（STR、CON…），EDU（Jev 讀的）與技能不動，
HP／MP／SAN 跟著重算；不呼叫 Jev、不需人機驗證、不花錢。第一次的值仍由文件內容當種子（同一份履歷同一組），
按了重骰才是真隨機。分享與存圖拿到的是當下那一組。角色頁與範例不給重骰。

## 存成圖片、預覽圖、存活監看

**存成圖片**（取代列印）：前端用自架的 `public/vendor/html-to-image.js`（MIT，v1.11.13）把結果卡
畫成 JPEG（2 倍、1880 寬、品質 0.9，實測約 0.9 MB）。**不是 PNG**：紙張噪點讓 PNG 實測 7.9 MB，
超過多數社群的上限。做法是複製一份卡到畫面外、拿掉註解鈕、加網址浮水印，再把 SVG 濾鏡背景先
轉成點陣圖（html-to-image 不會處理 feTurbulence，直接輸出會是黑底）、只嵌入用到的字型子集。
產生要 4–11 秒，所以是「預覽→再按一次下載」：非手勢的第二次自動下載會被 Chrome 擋。
`e2e/save_image.mjs` 驗尺寸、格式、< 3 MB、連存兩次；**只在 Chrome 驗過，Safari／iOS 沒測**
（foreignObject 在 WebKit 一向比較脆；壞了會顯示失敗訊息並記 `image_fail`，不會壞掉別的功能）。

**社群預覽圖**：`public/og.png`（1200×630）＋三頁的 og／twitter meta、`robots.txt`、`sitemap.xml`。
分享連結的內容在 `#` 後面，伺服器看不到，所以只能是全站共用一張，做不到「每張卡一張預覽」。

**存活監看**不在這個倉庫裡（它綁著特定網域與信箱）。倉庫提供兩個給監看用的東西：`GET /api/config`
（回應格式固定、不含祕密）與 `GET /api/quota-status`（要帶 `x-watch-token`，沒設 `QUOTA_STATUS_TOKEN` 就整個關掉；
回傳今天各條額度用了多少），任何外部監看都可以拿來探。

本機預設設定（`wrangler.toml`）什麼第三方都不開：沒有廣告、沒有分析、沒有人機驗證，所以 Worker 會把每個請求
當成「驗證通過」。想在本機試驗證或廣告，在 `web/worker/.dev.vars`（已被 gitignore）填 `PUBLIC_TURNSTILE_SITEKEY=` 等。

## 部署（自己架一份）

```bash
cd web/worker
npm ci
npx wrangler login
npx wrangler secret put TYPESAFE_API_KEY      # 必填：判讀模型的金鑰
npx wrangler secret put QUOTA_SALT            # 必填（隨機字串）：用量計數的 IP 雜湊要加鹽
npx wrangler secret put TURNSTILE_SECRET      # 選配：沒設＝所有請求視為「驗證通過」
npx wrangler secret put POSTHOG_KEY           # 選配：沒設＝不載任何分析
npx wrangler secret put QUOTA_STATUS_TOKEN    # 選配：開 GET /api/quota-status
npx wrangler deploy
```

要自訂網域就在 `wrangler.toml` 加 `routes`；`[assets]` 會把 `../public` 一起送上去，所以是一支 Worker
同時服務靜態頁與 `/api/*`，不用另外開 Pages 專案。Fork 之後請改掉 `public/i18n.js` 裡的 `window.SITE`
（聯絡信箱、工作室網址、贊助連結），以及隱私頁的聲明，那些是我們自己的。

**自動化瀏覽器驗不到的兩件事**：真實的 Turnstile 與 PostHog 事件。puppeteer 會被當成機器人——
Turnstile 不產生 token，posthog-js 內建的機器人過濾也不送事件。不偽裝成真人去繞它，所以這兩件要人工
開一次網站確認。`test.mjs` 與 `wiring` 測試用替身驗的是接線，不是線上實況。

## 站名與三語

站名 **JevTRPG**（原名 JevSheet）。站名帶 Jev 是刻意的——敘事上「以 Jev 為發想的應用」是這個站的鉤子，
模型將來換掉再改名。PostHog 的站台標籤 `site=jevsheet` 沿用舊名，以免統計斷掉。

UI 外殼三語（`public/i18n.js`，繁中／日文／English），語言由 `?lang=` 或
`localStorage` 或瀏覽器語言決定，切換器在頁首。**繁中是正本**：HTML 裡寫的就是繁中，
所以中文的 SEO 完整；ja/en 靠前端換字，SEO 較弱。那兩語的流量值得投資時，
再用 `build.py` 產生靜態多語頁。

**判準也是三語**（`systems/coc/locales/en.yaml`、`ja.yaml`），跟著介面語言走，
請求帶 `locale`、回傳寫明用了哪一套。日文是機翻等級、未經母語者校對。

換判準語言等於換了送給模型的題目，所以量過才上：**整張卡的形狀、職業、學歷三語一致；
用已知答案的測試（`experiments/checkbench.py`）量，三語的平均誤差都在 0.17 級以內（一級約 20 分）；
但同一份履歷換語言，證據含糊的技能仍可能差到 20 分，日文版最多 36 分**。頁尾有一行說明，
請使用者不要拿不同語言的卡互比。（2026-09-30 更正：先前寫的「差 20–35 分、兩倍」是拿一個壞掉的
英文包量的，見實驗紀錄。）
**新增或修改語系檔時**：技能條目用行內 `{}` 寫法，值裡有逗號一定要加引號——載入時有閘會擋多出來的鍵。完整數據見 [`../experiments/README.md`](../experiments/README.md)。

## 分析、廣告與頁尾聲明

**全部由 `GET /api/config` 決定，沒設定就整套不啟動**
——沒有 script、沒有版位、沒有追蹤。`/api/config` 只回本來就會送到每個瀏覽器的東西（AdSense 發布者 ID、
PostHog 專案金鑰、Turnstile site key），不記訪客、不寫任何東西；測試會確認 API 金鑰不會出現在裡面。

- **PostHog**（`POSTHOG_KEY` secret ＋ `POSTHOG_HOST` var）：記憶體儲存、不用 Cookie、不自動抓取、不錄影，
  每個事件帶 `site=jevsheet`。事件只有 `sample_open`、`sheet_generated`（頁面／語言／模式）、`sheet_failed`、
  `share_copy`、`lang_switch`、`turnstile_error`（只帶錯誤碼）、`turnstile_timeout`——**絕不帶使用者貼的文字或判讀內容**，失敗也只記「失敗了」不記原因文字。
- **AdSense**：發布者 ID（`ADSENSE_CLIENT`）有填就載 script，自動廣告要用；手動版位要到 AdSense 後台
  各建一個廣告單元，把單元 ID 填進 `ADSENSE_SLOT_RESULTS`（結果卡下方）與 `ADSENSE_SLOT_FOOTER`（頁尾上方），
  **沒填就沒有版位，頁面上不會有空框**；AdSense 填不滿時整塊收掉。不放置底浮動廣告：核心內容是一張要慢慢看的表。
- **Turnstile**：有 site key 才載入；送出時才取 token，取 token 期間按鈕已停用並顯示載入中。
- **頁尾與隱私頁（工作室聲明）**：版權、非官方聲明（與 Chaosium、TypeSafe 的關係）、
  「編年史記工作室 ChronicleCore Studio 出品／作者 Zaious」、聯絡信箱、連到 `privacy`。
  文字定義**一次**在 `public/i18n.js`（信箱、工作室網址在 `window.SITE`），三語共用。
  HTML 裡的靜態繁中要跟它一致——`sync-static.mjs --check`（`test.mjs` 會跑）擋住漂移；
  隱私頁內文靜態寫進 HTML 是因為 AdSense 的爬蟲不一定執行 JS。
  ⚠ 聲明必須跟實際一致：**改了任何一項（換掉 PostHog、加了記錄）就要同步改隱私頁。**
  倉庫轉為公開的那天，要把「程式碼公開（MIT）」補進隱私頁與頁尾。

## 兩份實作，一份真相

規則資料只有一份真相：`systems/<name>/system.yaml`。技能、量表、**題目措辭**
全在那裡，`build.py` 編成 `system.js` 給 Worker。

算法有兩份（`engine/scoring.py` 與 `worker/src/index.js`），這是這個專案唯一
刻意的重複——CLI 要能離線研究、Worker 要跑在邊緣。所以有 `test.mjs`：
拿 Python 真跑出來的機率分布當固定樣本，兩邊算同一批數字，對不上就 exit 1。
**改了任何一邊的計分，先跑它。**

`web/worker/e2e/` 是用 puppeteer 驅動本機 Chrome 的回歸測試（攔截請求，不需要真金鑰）：
`wiring.mjs` 驗 PostHog／AdSense／Turnstile 接線、分享、註解按鈕、加技能；`flows.mjs` 驗縮圖、換語言、分享連結。
**改完檔案後的第一輪偶爾會因為 wrangler 重載而逾時，重跑即可**；看到穩定失敗才是真的。
`npm run e2e` 任何一項 ✗ 或 console 錯誤都會讓它以非零結束。
