/* 前端：一支檔案服務兩頁，靠 window.PAGE 分流。
   沒有框架、沒有 build step、沒有資料庫——結果編碼進網址就是分享連結。

   卡面是一份 1920 年代風的調查員檔案：表格是印好的（橄欖墨）、數值是打字機填的
   （藍黑墨）、Jev 拿不定與 KP 該問的地方用紅筆圈。首屏的縮圖是範例**實際跑出來**
   的結果（public/samples/*.json，由 web/make_samples.py 打一次 /api 存下來），
   不是另外畫的示意圖；API 回傳的形狀改了就要重跑那支。

   語言：UI 外殼三語（i18n.js），判準也三語（系統包的 locales/），跟著介面走。
   換判準語言等於換了送給模型的題目——實測數字會動，所以請求帶上 locale，
   回傳也寫明用的是哪一套。見 experiments/README.md。 */

const $ = (id) => document.getElementById(id);
const PAGE = window.PAGE;               // "resume" | "character"
const MAX = 12000;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let VIEW = null;                        // #out 目前放的是什麼："sample" | "result" | "shared"

/* ── 語言 ────────────────────────────────────────────────────────────── */
function pickLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (q && window.I18N[q]) return q;
  try {
    const saved = localStorage.getItem("lang");
    if (saved && window.I18N[saved]) return saved;
  } catch { /* 無痕模式讀不到就算了 */ }
  for (const l of navigator.languages || []) {
    if (/^ja/i.test(l)) return "ja";
    if (/^zh/i.test(l)) return "zh-Hant";
    if (/^en/i.test(l)) return "en";
  }
  return "zh-Hant";
}

let LANG = pickLang();
/** 缺字串時回空字串：寧可卡上空一格，也不要把 key 印上去 */
const T = (key, vars) => {
  let s = (window.I18N[LANG] || {})[key] ?? window.I18N["zh-Hant"][key];
  if (s == null) return "";
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  // 站台常數與跨鍵引用：信箱、工作室網址只在 window.SITE 定義一處，聲明文字裡用 {mail} {studio}
  return s.replace(/\{(mail|studio|support|repo|adsSettings|partnerSites)\}/g, (_, k) =>
    k === "mail" ? window.SITE.contact : k === "studio" ? window.SITE.studioUrl
    : k === "support" ? window.SITE.support : k === "repo" ? window.SITE.repo : T(k));
};

function applyLang() {
  document.documentElement.lang = LANG;
  document.title = T(PAGE === "character" ? "docTitleChar" : "docTitleResume");
  for (const el of document.querySelectorAll("[data-i18n]"))
    el.textContent = T(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]"))
    el.innerHTML = T(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]"))
    el.placeholder = T(el.dataset.i18nPlaceholder);
  $("langs").innerHTML = window.LANGS.map((l) =>
    `<button type="button" class="lang${l === LANG ? " on" : ""}" data-lang="${l}"`
    + `${l === LANG ? ' aria-current="true"' : ""}>${window.I18N[l]._label}</button>`
  ).join("");
  for (const b of $("langs").querySelectorAll("button"))
    b.onclick = () => {
      LANG = b.dataset.lang;
      track("lang_switch", { to: LANG, page: PAGE });
      try { localStorage.setItem("lang", LANG); } catch { /* ignore */ }
      const u = new URL(location.href);
      u.searchParams.set("lang", LANG);
      history.replaceState(null, "", u);
      applyLang();
    };
  if (PAGE === "privacy") return renderPrivacy();
  if (PAGE === "character") loadSkillList();
  // 判準語言會移動數字，每個語言都要看到這行，免得有人拿不同語言的卡互比
  const note = $("content-lang-note");
  note.hidden = false;
  note.textContent = T("contentLangNote");
  setCount();
  loadPreview();
  if (VIEW === "sample") showSample(false);   // 正在看範例就換成這個語言的範例
}

/** 隱私頁的內文全部從 i18n 畫出來（單一來源，三語不會漂）；<noscript> 有一句話擋著 */
const PRIVACY_SECTIONS = [["pvAboutH", "pvAbout"], ["pvFreeH", "pvFree"], ["pvTextH", "pvText"],
  ["pvShareH", "pvShare"], ["pvBotH", "pvBot"], ["pvAdsH", "pvAds"], ["pvAnalyticsH", "pvAnalytics"], ["pvSupportH", "pvSupport"],
  ["pvHostH", "pvHost"], ["pvJudgeH", "pvJudge"]];
function renderPrivacy() {
  $("pv-body").innerHTML = PRIVACY_SECTIONS.map(([h, b]) => {
    const body = T(b);
    return `<h2>${esc(T(h))}</h2>${body.startsWith("<ul>") ? body : `<p>${body}</p>`}`;
  }).join("");
}

/* ── 範例：跟著介面語言走（判準也跟著語言走，範例同語言才公平）────── */
const SAMPLE_RESUME_EN = `EXPERIENCE

Generative AI Solutions Consultant | Stellar Integrated Marketing Group | 2023/04 – present
- Advised enterprise clients on generative-AI adoption and collaborated on 5+ proof-of-concept projects.
- Led a group-wide AI literacy programme for 1,000+ employees and built an assessment platform to verify outcomes.
- Built Stable Diffusion and ComfyUI image-generation workflows for advertising creative production.

iOS Software Engineer | Jingqiao Information | 2015/11 – 2018/04
- Developed flagship government mobile apps; responsible for API integration, large-scale system design and databases.

Patent Engineer | Hengyu International Patent & Trademark Office | 2014/05 – 2014/09
- Clarified inventions through technical interviews and drafted patent specifications.

EDUCATION
Beidu University of Technology, Master's | 2019/09 – 2022/07

CERTIFICATIONS AND AWARDS
- Certified Digital Transformation Lecturer, central government ministry (2025)
- First place, Blockchain Bootcamp Hackathon

SKILLS
Generative-AI adoption, prompt design, RAG architecture, Swift / iOS, Python, corporate training, English`;

const SAMPLE_RESUME_JA = `【職歴】

生成AIソリューションコンサルタント｜恒星統合マーケティンググループ｜2023/04 - 現在
- 企業顧客に生成AI導入のコンサルティングを行い、5件以上のPoCプロジェクトに協働で携わった。
- グループ全体で1,000人以上を対象としたAIリテラシー研修体系を主導し、能力テストプラットフォームを構築した。
- Stable Diffusion と ComfyUI の画像生成ワークフローを構築し、広告素材の制作に活用した。

iOSソフトウェアエンジニア｜晶橋情報｜2015/11 - 2018/04
- 行政の旗艦モバイルアプリを開発し、API連携・大規模システム設計・データベース連携を担当。

特許技術者｜衡宇国際特許商標事務所｜2014/05 - 2014/09
- 技術インタビューで発明内容を明確にし、特許明細書を作成した。

【学歴】
北都科技大学 修士｜2019/09 - 2022/07

【資格・受賞】
- 中央省庁認定 デジタルトランスフォーメーション講師（2025）
- ブロックチェーン・ハッカソン 優勝

【スキル】
生成AIの導入、プロンプト設計、RAGアーキテクチャ、Swift / iOS、Python、企業研修、英語`;

const SAMPLE_RESUME = `【工作經歷】

生成式 AI 解決方案顧問｜恆星整合行銷集團｜2023/04 - 至今
- 為企業客戶提供生成式 AI 導入諮詢，協作完成 5 個以上 PoC 專案。
- 主導集團 1,000 人以上的 AI 素養培訓體系，並建置能力測驗平台檢核成效。
- 實作 Stable Diffusion 與 ComfyUI 圖像生成工作流，應用於廣告素材產製。

iOS 軟體工程師｜晶橋資訊｜2015/11 - 2018/04
- 開發直轄市政府旗艦級行動應用，負責 API 串接、大規模系統設計與資料庫互動。

專利工程師｜衡宇國際專利商標事務所｜2014/05 - 2014/09
- 以技術訪談釐清發明內容，撰寫專利技術規格說明書。

【學歷】
北都科技大學 碩士｜2019/09 - 2022/07

【證照與獲獎】
- 中央部會數位轉型核可講師（2025）
- 區塊鏈訓練營黑客松 第一名

【技能】
生成式 AI 導入、Prompt 設計、RAG 架構、Swift / iOS、Python、企業內訓、英文讀寫`;

const SAMPLE_CHAR_EN = `[Character] Lin Shu-han, 28, local newspaper reporter

[Backstory]
Grew up in an ordinary family in Taichung; her father has run a locksmith's shop for thirty years.
Studied Chinese literature at university and joined the hiking club, walking several traverses of the Central Range.
Joined a local paper after graduating and is in her fifth year on the crime beat, in and out of police stations and courtrooms.
Last year she spent seven months on a story about abuse at a care home, which ended in a government inspection.
Drives herself to assignments in a ten-year-old Civic and fixes its small faults herself.

[Stats]
STR 45  CON 60  SIZ 50  DEX 65  APP 60  INT 70  POW 55  EDU 65  LUCK 50

[Skills]
Language (Own) 80
Library Use 70
Spot Hidden 70
Persuade 65
Fast Talk 60
Climb 55
Drive Auto 55
Locksmith 50
Computer Use 75
Medicine 60`;

const SAMPLE_CHAR_JA = `【キャラクター】林書涵　28歳　地方新聞の記者

【背景】
台中のごく普通の家庭に生まれ、父は三十年続く鍵屋を営んでいる。
大学では中国文学を専攻し、登山部で中央山脈の縦走路をいくつか歩いた。
卒業後は地方紙に入社し、社会部で五年目。警察署・地検・裁判所の傍聴に長く通っている。
昨年は介護施設での虐待事件を七か月追い、最終的に行政の立ち入り検査につながった。
取材には十年落ちのシビックを自分で運転し、ちょっとした不具合は自分で直す。

【能力値】
STR 45　CON 60　SIZ 50　DEX 65　APP 60　INT 70　POW 55　EDU 65　幸運 50

【スキル】
母国語 80
図書館 70
目星 70
説得 65
言いくるめ 60
登攀 55
運転（自動車） 55
鍵開け 50
コンピューター 75
医学 60`;

const SAMPLE_CHAR = `【角色】林書涵　28 歲　地方報社記者

【背景故事】
出生在台中一個普通家庭，父親開了三十年的鎖行。
大學念中文系，在校時參加登山社，四年間走過中央山脈幾條縱走路線。
畢業後考進地方報社，跑社會線第五年，長期進出警局、地檢署與法院旁聽。
去年報導一起長照機構的虐待案，前後追了七個月，最後促成主管機關稽查。
平常自己開車跑採訪，車是十年的舊喜美，小毛病都自己弄。

【特性值】
STR 45　CON 60　SIZ 50　DEX 65　APP 60　INT 70　POW 55　EDU 65　幸運 50

【技能】
母語（中文） 80
圖書館使用 70
偵查 70
說服 65
話術 60
攀爬 55
駕駛汽車 55
鎖匠 50
電腦使用 75
醫學 60`;

/* ── 小工具 ──────────────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const pad2 = (n) => String(n).padStart(2, "0");
const smooth = () => (REDUCED ? "auto" : "smooth");

/** 卡上的檔案編號：由內容雜湊出四位數，同一張卡永遠同一號 */
function fileNo(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return String(1000 + ((h >>> 0) % 9000));
}

function setCount() {
  const n = $("text").value.length;
  $("count").textContent = n ? `${n.toLocaleString()} / ${MAX.toLocaleString()} ${T("chars")}` : "";
  $("count").classList.toggle("over", n > MAX);
}

/* ── 分析與廣告：都由 /api/config 決定，沒設定就整個不啟動 ─────────────────
   PostHog：記憶體儲存、不用 Cookie、不自動抓取、
   不錄影，事件只帶頁面／語言／模式這類欄位，**絕不帶使用者貼的文字或判讀內容**。
   AdSense：發布者 ID 有設就載 script（自動廣告要用）；手動版位要有單元 ID 才出現，
   所以「還沒建廣告單元」的時候頁面上不會有空框。 */
const trackQueue = [];
function track(name, props) {
  try {
    if (window.posthog?.__loaded) window.posthog.capture(name, props);
    else trackQueue.push([name, props]);
  } catch { /* 追蹤壞了不能影響頁面 */ }
}
function startPosthog(pc) {
  const assets = pc.host.replace(".i.posthog.com", "-assets.i.posthog.com");
  const s = document.createElement("script");
  s.src = assets + "/static/array.js"; s.async = true;
  s.onload = () => {
    try {
      window.posthog.init(pc.key, {
        api_host: pc.host, persistence: "memory", autocapture: false,
        capture_pageview: true, capture_pageleave: true, disable_session_recording: true,
        person_profiles: "identified_only",
        loaded: (ph) => { ph.register({ site: "jevsheet" });   /* 站台標籤：舊名 JevSheet，沿用以免統計斷掉；fork 請改成自己的 */ trackQueue.splice(0).forEach(([n, p]) => ph.capture(n, p)); },
      });
    } catch { /* ignore */ }
  };
  document.head.append(s);
}

const ads = { cfg: null, scriptLoaded: false, resultsPlaced: false };
function loadAdScript() {
  if (ads.scriptLoaded) return; ads.scriptLoaded = true;
  const s = document.createElement("script");
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(ads.cfg.client);
  s.async = true; s.crossOrigin = "anonymous";
  document.head.append(s);
}
function placeAd(container, slotName) {
  if (!container || !ads.cfg?.slots[slotName]) return false;
  const rect = slotName === "results";
  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.dataset.adClient = ads.cfg.client; ins.dataset.adSlot = ads.cfg.slots[slotName];
  ins.dataset.adFormat = rect ? "rectangle" : "horizontal"; ins.dataset.fullWidthResponsive = "false";
  const box = document.createElement("div");
  box.className = "adbox " + (rect ? "rect" : "wide");
  box.innerHTML = `<div class="adlabel">${esc(T("adLabel"))}</div>`;
  box.append(ins); container.append(box);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* 廣告擋掉器：沒關係 */ }
  return true;
}
/** 結果（或範例）畫出來之後，才放結果卡下方那個版位；只放一次 */
function showAds() {
  if (ads.resultsPlaced || !ads.cfg) return;
  ads.resultsPlaced = placeAd($("ad-results"), "results");
}

/* Turnstile：有 site key 才載入；token 在使用者按送出時才取（最多等 10 秒） */
const ts = { siteKey: null, id: null, token: null, failed: null };   // failed：驗證元件壞了的原因（錯誤碼或 "load"）；null＝沒壞
function startTurnstile(siteKey) {
  ts.siteKey = siteKey;
  window.onTurnstileLoad = () => {
    ts.id = window.turnstile.render("#turnstile-slot", {
      sitekey: siteKey, appearance: "interaction-only", language: { "zh-Hant": "zh-tw", ja: "ja", en: "en" }[LANG],
      callback: (t) => { ts.token = t; ts.failed = null; showTsNote(null); },
      "expired-callback": () => { ts.token = null; },
      // 失敗要看得見：App 內建瀏覽器等環境拿不到 token 時，不然只會是「沒流量」。只記錯誤碼，不含內容
      "error-callback": (code) => {
        ts.token = null; ts.failed = String(code || "error");
        track("turnstile_error", { code: ts.failed, page: PAGE });
        showTsNote(ts.failed);                                  // 立刻說，不要等人按了「產生」才發現（2026-10-01：兩位使用者連出 6 次、3 次錯誤卻沒有任何提示）
      },
    });
  };
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
  s.async = true; s.defer = true;
  s.onerror = () => { ts.failed = "load"; track("turnstile_error", { code: "load", page: PAGE }); showTsNote("load"); };   // 腳本被廣告攔截或網路擋掉
  document.head.append(s);
}
/** 驗證元件壞了：在按鈕附近放一句「怎麼辦」；好了就收起來 */
function showTsNote(code) {
  const el = $("ts-msg");
  if (!el) return;
  el.hidden = !code;
  el.textContent = code ? T("tsFallback", { code }) : "";
}
/** 送出失敗 → 使用者看得懂、而且是他的語言的一句話。原始的上游訊息不顯示（可能是一大串技術文字） */
function errText(status, code, text, info = {}) {
  if (code === "network") return T("errNetwork");
  if (code === "quota") {          // 用量額度：人機驗證沒過的人額度較小（見 worker/src/quota.js）
    if (info.scope === "day") return T("errQuotaDay");
    if (info.scope === "busy") return T("errBusy");
    return T(info.tier === "weak" ? "errQuotaHourWeak" : "errQuotaHour");
  }
  if (code === "empty") return T("empty");
  if (code === "too_long" || status === 413) return T("tooLong", { max: MAX, n: text.length });
  if (status === 429) return T("errRate");
  if (code === "upstream" || status >= 500) return T("errUpstream");
  return T("errGeneric");
}
async function turnstileToken() {
  // 最多等 10 秒；但元件已經報錯的話只多給 2 秒（它有時會自己重試成功），之後就不用空等了
  for (let i = 0; i < 40 && !ts.token && !(ts.failed && i >= 8); i++) await new Promise((r) => setTimeout(r, 250));
  return ts.token;
}

fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((cfg) => {
  if (!cfg) return;
  if (cfg.posthog) startPosthog(cfg.posthog);
  if (PAGE === "privacy") return;                     // 說明頁不放廣告、不驗證
  if (cfg.ads) { ads.cfg = cfg.ads; loadAdScript(); placeAd($("ad-footer"), "footer"); if (VIEW) showAds(); }
  if (cfg.turnstileSiteKey) startTurnstile(cfg.turnstileSiteKey);
}).catch(() => { /* 沒有設定就是沒有廣告、沒有分析、沒有驗證 */ });

/* ── 卡面的圖：印章、迴紋針（照片是 art/investigator.svg）─────────────── */
let SEAL_N = 0;
function seal() {
  const id = `seal-ring-${++SEAL_N}`;       // 同頁有縮圖跟正卡兩枚，id 不能撞
  return `<svg class="seal" viewBox="0 0 120 120" aria-hidden="true">
    <defs><path id="${id}" d="M60 60 m-46 0 a46 46 0 1 1 92 0 a46 46 0 1 1 -92 0"/></defs>
    <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <circle cx="60" cy="60" r="53.6" fill="none" stroke="currentColor" stroke-width=".8"/>
    <circle cx="60" cy="60" r="37" fill="none" stroke="currentColor" stroke-width="1"/>
    <text class="seal-text"><textPath href="#${id}" textLength="286" lengthAdjust="spacing">JEVTRPG · INVESTIGATOR RECORDS ·</textPath></text>
    <path d="M35 58 Q60 37 85 58 Q60 79 35 58 Z" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="60" cy="58" r="9.5" fill="currentColor"/>
    <ellipse cx="60" cy="58" rx="1.9" ry="7" style="fill:var(--paper)"/>
    <path d="M49 72 q-4 7 1 13 M60 75 q2 7 -2 12 M71 72 q4 7 -1 13" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}
const CLIP = `<svg class="clip" viewBox="0 0 24 64" aria-hidden="true"><path
  d="M16 20 V50 A4 4 0 0 1 8 50 V12 A6 6 0 0 1 20 12 V52 A8 8 0 0 1 4 52 V20"
  fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

/* ── 卡面各區塊 ──────────────────────────────────────────────────────── */
const CHAR_ORDER = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"];

function sheetHead({ kind, sub, no, stamp }) {
  return `<header class="sh-head">
    <div class="sh-seal">${seal()}</div>
    <div class="sh-title">
      ${sub ? `<p class="sh-sub">${esc(sub)}</p>` : ""}
      <h2 class="sh-kind">${esc(kind)}</h2>
      <p class="sh-case">${esc(T("caseNo"))} <span class="typed">No. ${no}</span></p>
    </div>
    <figure class="sh-photo">${CLIP}<img src="art/investigator.svg" alt="" width="120" height="150"></figure>
    <div class="stamp">${esc(T(stamp))}</div>
  </header>`;
}

function field(labelKey, value, aside = [], wide = false) {
  return `<div class="fld${wide ? " fld--wide" : ""}">
    <span class="fld-l">${esc(T(labelKey))}</span>
    <span class="fld-v typed">${esc(value)}</span>
    ${aside.length ? `<span class="fld-a">${aside.map((a) => `<span>${a}</span>`).join("")}</span>` : ""}
  </div>`;
}

/** 職業：現代與 1920 年代各一格。信心低的時候把次選也印出來，那是 Jev 的分布不是裝飾 */
function occFields(occ = {}) {
  const one = (era, key) => {
    const o = occ[era];
    if (o == null) return "";
    if (typeof o === "string") return field(key, o);         // 分享連結只帶名字
    const aside = [esc(T("conf", { p: pct(o.confidence) }))];
    const alt = (o.alternatives || [])[0];
    if (o.confidence < 0.75 && alt && alt[1] >= 0.1)
      aside.push(esc(T("orAlt", { x: alt[0], p: pct(alt[1]) })));
    return field(key, o.choice, aside);
  };
  return one("modern", "occModern") + one("1920", "occ1920");
}

function charBlock(chars = {}, sources = {}, derived = {}) {
  const keys = [...CHAR_ORDER.filter((k) => k in chars),
                ...Object.keys(chars).filter((k) => !CHAR_ORDER.includes(k))];
  const boxes = keys.map((k) => {
    const v = +chars[k], src = sources[k];               // 不知道來源（舊的分享連結）就不標
    return `<div class="cbox${src === "read" ? " cbox--read" : ""}">
      <span class="cbox-k">${esc(k)}</span><span class="cbox-n">${esc(T("ch_" + k))}</span>
      <b class="cbox-v typed">${v}</b>
      <span class="cbox-hf typed"><i>${Math.floor(v / 2)}</i><i>${Math.floor(v / 5)}</i></span>
      ${src ? `<span class="cbox-src">${esc(T("src_" + src))}</span>` : ""}
    </div>`;
  }).join("");
  const dv = ["HP", "MP", "SAN"].filter((k) => derived && k in derived).map((k) =>
    `<div class="dbox dbox--${k.toLowerCase()}"><span class="dbox-k">${k}</span>`
    + `<span class="dbox-n">${esc(T("dv_" + k))}</span><b class="typed">${derived[k]}</b></div>`).join("");
  return `<h3 class="band">${esc(T("charsBand"))}</h3>
    <div class="chars">${boxes}</div>
    ${dv ? `<div class="derived">${dv}</div>` : ""}`;
}

/** 技能：一律照系統包的順序（中文卡的慣例是英文字母序），不照分數排——這是一張卡，不是排行榜。
 *  打叉＝證據過半且高於基礎值；證據不到一半但數字有動的，淡墨。兩種讀法的在數字右上角加小註號。 */
let NOTE_N = 0;
function skillBlock(d) {
  const levels = d.levels || [];
  const noteId = `jev-notes-${++NOTE_N}`;
  const notes = [];
  const rows = Object.entries(d.skills || {}).map(([id, r]) => {
    const shown = d.final ? d.final[id] : r.value;
    const hasBase = r.base != null;
    const raised = !hasBase || shown >= r.base + 5;    // 只多兩三點是期望值的雜訊，不算拉高
    const strong = (r.evidence ?? 1) >= 0.5;
    let val = raised ? String(shown) : "";
    if (r.split && r.top && r.second) {
      notes.push(T("splitNote", {
        name: esc(r.label || id),
        a: T("readAs", { p: pct(r.top[1]), lv: esc(levels[r.top[0]] || "") }),
        b: T("readAs", { p: pct(r.second[1]), lv: esc(levels[r.second[0]] || "") }),
      }));
      val = `${val}<sup class="nref">${notes.length}</sup>`;      // 只在右上角放註號（不圈起來：圈看起來像「錯誤」）
    }
    return `<li class="sk${raised ? " sk--up" : ""}${raised && !strong ? " sk--faint" : ""}">
      <i class="sk-dot${raised && strong ? " on" : ""}"></i>
      <span class="sk-name">${esc(r.label || id)}${hasBase ? `<span class="sk-base">(${pad2(r.base)})</span>` : ""}</span>
      <span class="sk-val typed">${val}</span>
      <span class="sk-hf typed">${raised ? `<i>${Math.floor(shown / 2)}</i><i>${Math.floor(shown / 5)}</i>` : ""}</span>
    </li>`;
  }).join("");
  // 註解預設收起來：畫面上只有標題列右邊一顆「!」，點了才展開（右上角的註號也能點）
  const noteBtn = notes.length
    ? `<button type="button" class="note-btn" aria-expanded="false" aria-controls="${noteId}"
         title="${esc(T("notesBtn", { n: notes.length }))}" aria-label="${esc(T("notesBtn", { n: notes.length }))}">!</button>` : "";
  const noteList = notes.length ? `<div class="notes" id="${noteId}" hidden>
      <p class="notes-h">${esc(T("notesBand"))}</p>
      <ol>${notes.map((n, i) => `<li><sup>${i + 1}</sup>${n}</li>`).join("")}</ol>
    </div>` : "";
  return `<h3 class="band">${esc(T("skillsBand"))}${noteBtn}</h3>
    <p class="legend">${esc(T("skillsLegend"))}</p>
    <ul class="skills">${rows}</ul>${noteList}`;
}

function backBlock(back = {}) {
  const items = Object.entries(back).map(([k, v]) =>
    `<div class="bk"><dt>${esc(k)}</dt><dd class="typed">${esc(typeof v === "string" ? v : v.choice)}</dd></div>`).join("");
  return items ? `<h3 class="band">${esc(T("backBand"))}</h3><dl class="backstory">${items}</dl>` : "";
}

const footBlock = (lines) =>
  `<footer class="sh-foot">${lines.filter(Boolean).map((l) => `<p>${l}</p>`).join("")}</footer>`;

/** "[信箱]" → 該語言的「信箱」／"emails"；沒有對照就原樣 */
const tagName = (k) => T("tag_" + [...k].filter((c) => c !== "[" && c !== "]" && c.trim()).join("")) || k;
function redactLine(d) {
  if (!d.redacted) return "";
  const red = Object.keys(d.redacted).map(tagName);
  return esc(red.length ? T("redactedSome") + red.join(LANG === "en" ? ", " : "、") : T("redactedNone"));
}

/* ── 兩種卡 ──────────────────────────────────────────────────────────── */
function resumeSheet(d, { mini = false, stamp = "stampDone" } = {}) {
  const occNames = Object.values(d.occupations || {}).map((o) => (typeof o === "string" ? o : o.choice));
  const cap = d.capped ? T("withCap", { occ: d.budget.occupation, int: d.budget.interest }) : T("noCap");
  return `<article class="sheet paper${mini ? " sheet--mini" : ""}">
    ${sheetHead({ kind: T("sheetKind"), sub: T("sheetKindSub"),
                  no: fileNo(JSON.stringify([d.chars, occNames])), stamp })}
    <div class="sh-fields">
      ${d.character ? field("fieldCharacter", d.character, [], true) : ""}
      ${occFields(d.occupations)}
    </div>
    ${charBlock(d.chars, d.sources, d.derived)}
    ${skillBlock(d)}
    ${backBlock(d.backstory)}
    ${footBlock([esc(cap), esc(T("notAsked")),
                 d.model ? `${esc(T("modelLine"))} <span class="typed">${esc(d.model)}</span>` : "",
                 redactLine(d)])}
  </article>`;
}

/** 點數帳的順序：職業點、興趣點，其他（系統包若有）排後面 */
const budgetEntries = (b) => Object.entries(b).sort(([a], [c]) =>
  ["occupation", "interest"].indexOf(a) - ["occupation", "interest"].indexOf(c));

function checkSheet(d, { mini = false } = {}) {
  const levels = d.levels || [];
  const total = Object.values(d.budget).reduce((a, b) => a + b, 0);
  const over = d.spent - total;
  const rows = Object.entries(d.skills);
  const bad = over > 0 || rows.some(([, r]) => r.verdict === "撐不起");
  // Worker 回傳的判定值是內部代碼（中文），這裡只拿來選記號與字串
  const MARK = { "撐不起": "ring", "爭議": "dash", "邊緣": "line" };
  const review = rows.map(([n, r]) => {
    const v = r.verdict;
    const note = v === "邊緣" ? esc(T("kpEdge", { d: r.claimed - r.ceiling }))
      : v === "撐不起" ? esc(T("kpUnsupported", { n: r.ceiling }))
      : v === "爭議" ? T("kpDisputed", {
          a: T("readAs", { p: pct(r.top[1]), lv: esc(levels[r.top[0]] || "") }),
          b: T("readAs", { p: pct(r.second[1]), lv: esc(levels[r.second[0]] || "") }) })
      : esc(T("kpOk"));
    return `<div class="rv-row${MARK[v] ? " rv--flag" : ""}">
      <span class="rv-name">${esc(n)}${r.known ? "" : ` <small>${esc(T("unknownSkill"))}</small>`}</span>
      <span class="rv-claim typed"><span class="${MARK[v] || ""}">${r.claimed}</span></span>
      <span class="rv-ceil typed">${r.ceiling}</span>
      <span class="rv-note">${note}</span>
    </div>`;
  }).join("");
  const ledger = `<p class="ledger">
      ${budgetEntries(d.budget).map(([k, v]) =>
        `<span>${esc(T("budget_" + k))} <b class="typed">${v}</b></span>`).join('<span class="op">+</span>')}
      <span class="op">=</span><b class="typed">${total}</b>
      <span class="lg-gap"></span>
      <span>${esc(T("spent"))} <b class="typed">${d.spent}</b></span>
      <b class="lg-res typed${over > 0 ? " ring" : ""}">${esc(over > 0 ? T("over", { n: over }) : T("left", { n: -over }))}</b>
    </p>`;
  return `<article class="sheet paper sheet--kp${mini ? " sheet--mini" : ""}">
    ${sheetHead({ kind: T("sheetKindKP"), sub: T("sheetKindKPSub"),
                  no: fileNo(JSON.stringify([d.chars, Object.keys(d.skills)])),
                  stamp: bad ? "stampReturned" : "stampApproved" })}
    ${d.character ? `<div class="sh-fields">${field("fieldCharacter", d.character, [], true)}</div>` : ""}
    ${charBlock(d.chars, Object.fromEntries(Object.keys(d.chars).map((k) => [k, "player"])), d.derived)}
    <h3 class="band">${esc(T("budgetTitle"))}</h3>
    ${ledger}
    <h3 class="band">${esc(T("reviewBand"))}</h3>
    <div class="review">
      <span class="rv-h">${esc(T("thSkill"))}</span><span class="rv-h c">${esc(T("thClaimed"))}</span>
      <span class="rv-h c">${esc(T("thCeiling"))}</span><span class="rv-h">${esc(T("thNote"))}</span>
      ${review}
    </div>
    ${footBlock([d.model ? `${esc(T("modelLine"))} <span class="typed">${esc(d.model)}</span>` : "", redactLine(d)])}
  </article>`;
}

const renderSheet = (d, opts) => (d.mode === "check" ? checkSheet(d, opts) : resumeSheet(d, opts));

/* ── 分享連結：把卡壓進網址，不需要後端存任何東西 ───────────────────────
   編碼細節在 card-codec.js（與測試共用）：技能、職業、背景選項只記「第幾項」，連結約 80 字元。
   「第幾項」的對照表向 GET /api/wire 拿（一小時快取），所以編碼與解碼一定用同一份。 */
let CODEC = null;
const codec = () => (CODEC ||= import("/card-codec.js"));
const WIRES = {};
/** fp：連結上記的表的指紋。歷代的表 Worker 都留著，依指紋給對應那一代；不給就是最新一代（做新連結用） */
const getWire = (locale, fp = null) => {
  const key = `${locale}:${fp ?? ""}`;
  return (WIRES[key] ||= fetch(`/api/wire?locale=${encodeURIComponent(locale)}${fp == null ? "" : `&fp=${fp}`}`)
    .then((r) => { if (!r.ok) throw new Error(`wire ${r.status}`); return r.json(); })
    .catch((e) => { delete WIRES[key]; throw e; }));
};

async function makeHash(d, name) {
  const wire = await getWire(d.locale || LANG);
  const C = await codec();
  return "#c=" + C.encodeCard(C.cardOf(d, name), wire);
}

/** 連結 → 畫面。讀不出來或表已更新就直接說，不猜。 */
async function showShared(str) {
  try {
    const C = await codec();
    const link = C.peekLink(str);
    if (!link) return fail(T("sharedBad"));
    const wire = await getWire(link.locale, link.fp);
    const card = C.decodeCard(str, wire);
    if (!card) return fail(T("sharedBad"));
    if (card.stale) return fail(T("sharedStale"));
    VIEW = "shared";
    showResult(sharedSheet(card, wire), `<p class="sheet-note">${esc(T("sharedNote"))}</p>${btn("saveimg", "saveImg")}${btn("again", "makeMine")}<span class="sheet-note" id="img-msg" role="status"></span>`);
    bindTools(null);
  } catch { fail(T("sharedBad")); }
}

/** 連結只帶名字與數字（沒有基礎值、沒有機率），畫成同一張卡的簡版；名稱依連結裡記的語言查表 */
function sharedSheet(card, wire) {
  const label = Object.fromEntries(wire.skills.map((s) => [s.id, s.label]));
  return resumeSheet({
    character: card.n || "",
    occupations: card.o, chars: card.c, sources: card.x, derived: card.d, backstory: card.b,
    skills: Object.fromEntries(card.s.map(([id, v, weak]) => [id, { label: label[id] || id, value: v, base: null, evidence: weak ? 0.3 : 1 }])),
  }, { stamp: "stampCopy" });
}

/* ── #out：結果、範例、讀取中、錯誤 ─────────────────────────────────── */
function showResult(sheetHtml, toolsHtml) {
  $("out").innerHTML = `<div class="result">${sheetHtml}<div class="sheet-tools">${toolsHtml}</div></div>`;
  if (!REDUCED) $("out").querySelector(".sheet")?.classList.add("enter");
  showAds();
}

function bindTools(makeHash, d = null) {
  // d 有值＝自己剛做出來的卡：分享與存圖共用同一個「角色名字（選填）」表單，按哪個鈕就做哪件事。
  // 範例與別人分享的卡沒有這一步，存圖直接存。
  let mode = "share";
  const openForm = (m) => {
    const f = $("share-form"), same = !f.hidden && mode === m;
    f.hidden = same;
    $("share")?.setAttribute("aria-expanded", String(!same && m === "share"));
    $("saveimg")?.setAttribute("aria-expanded", String(!same && m === "image"));
    if (same) return;
    mode = m;
    $("share-do").textContent = T(m === "share" ? "shareDo" : "imgDo");
    $("share-hint").textContent = T(m === "share" ? "shareNameHint" : "imgNameHint");
    $("share-name").focus();
  };
  $("saveimg")?.addEventListener("click", d ? () => openForm("image") : () => saveImage());
  if (d) $("saveimg")?.setAttribute("aria-controls", "share-form");
  $("again")?.addEventListener("click", () => {
    $("text").scrollIntoView({ behavior: smooth(), block: "center" });
    $("text").focus({ preventScroll: true });
  });
  if (d) {
    // 「分享這張卡」與「存成圖片」都先展開一個填名字的小表單（選填）；名字只進連結的 # 後面或只印在圖上，不送到伺服器
    if ($("share")) $("share").onclick = () => openForm("share");
    $("share-form").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("share-name").value.trim().slice(0, 24);
      d._name = name;                                            // 重骰重畫之後表單還記得
      if (mode === "image") { $("share-form").hidden = true; $("saveimg").setAttribute("aria-expanded", "false"); track("image_named", { page: PAGE, lang: LANG, named: !!name }); return saveImage(name); }
      const b = $("share-do");
      let hash;
      try { hash = await makeHash(name); } catch { b.textContent = T("shareFail"); return; }
      const url = location.origin + location.pathname + location.search + hash;
      track("share_copy", { page: PAGE, lang: LANG, named: !!name });    // 只記有沒有填，不記名字
      try { await navigator.clipboard.writeText(url); b.textContent = T("shared"); }
      catch { location.hash = hash.slice(1); b.textContent = T("sharedFallback"); }
    };
  }
}

/** 「!」按鈕與右上角註號：展開或收起同一張卡上的註解。縮圖上的不處理（那整塊是開範例的連結）。 */
document.addEventListener("click", (e) => {
  const t = e.target.closest?.(".note-btn, sup.nref");
  if (!t || t.closest(".preview-frame")) return;
  const sheet = t.closest(".sheet");
  const panel = sheet?.querySelector(".notes");
  const btn = sheet?.querySelector(".note-btn");
  if (!panel || !btn) return;
  const open = t.matches("sup.nref") ? true : panel.hidden;          // 點數字一律展開；點「!」開關
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (open && t.matches("sup.nref")) panel.scrollIntoView({ behavior: smooth(), block: "nearest" });
});

/* ── 存成圖片 ────────────────────────────────────────────────────────────
   不是列印、也不是 PDF：多半沒人要 PDF，要的是一張能貼進聊天室的圖。
   做法：在畫面外複製那張卡，固定成桌面版面（所以手機上存出來的也是完整版面），
   用 html-to-image 轉成 PNG。它把 HTML 包進 SVG 再畫成圖，SVG 裡讀不到外部字型，
   所以字型要自己嵌進去——但**只嵌卡上用到的那幾個子集**，而且是頁面本來就載入過的同一批檔案
   （Google Fonts 依字元切成很多檔），不多打任何請求，卡上的字也不會被送去別處。
   （另一種做法是伺服器端用 Satori 重畫一棵版面樹，在各種裝置上更一致；我們的卡本來就是網頁，
   直接轉。代價：Safari 對這種轉法偶爾不穩，見 README。） */
let H2I = null;
function loadH2I() {
  return (H2I ||= new Promise((res, rej) => {
    if (window.htmlToImage) return res(window.htmlToImage);
    const s = document.createElement("script");
    s.src = "vendor/html-to-image.js";
    s.onload = () => res(window.htmlToImage);
    s.onerror = () => rej(new Error("html-to-image 載不進來"));
    document.head.append(s);
  }));
}
const inUnicodeRange = (cp, range) => range.split(",").some((part) => {
  const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
  if (!m) return false;
  if (m[1].includes("?")) return cp >= parseInt(m[1].replace(/\?/g, "0"), 16) && cp <= parseInt(m[1].replace(/\?/g, "f"), 16);
  const lo = parseInt(m[1], 16), hi = m[2] ? parseInt(m[2], 16) : lo;
  return cp >= lo && cp <= hi;
});
const toDataUrl = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
let FONT_CSS_SRC = null;
/** 只挑「這段文字真的會用到」的 @font-face 子集，抓成 data URI。抓不到就回空字串，圖仍會產生（只是字型退回系統字）。 */
async function fontCssFor(text) {
  const link = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
  if (!link) return "";
  try {
    FONT_CSS_SRC ||= await (await fetch(link.href)).text();
    const cps = new Set([...text].map((c) => c.codePointAt(0)));
    const blocks = FONT_CSS_SRC.match(/@font-face\s*\{[^}]*\}/g) || [];
    const need = blocks.filter((b) => {
      const r = /unicode-range:\s*([^;]+);/.exec(b);
      return !r || [...cps].some((cp) => inUnicodeRange(cp, r[1]));
    });
    const out = await Promise.all(need.map(async (b) => {
      const url = /url\(([^)]+)\)/.exec(b)?.[1]?.replace(/['"]/g, "");
      if (!url) return "";
      const data = await toDataUrl(await (await fetch(url)).blob());
      return b.replace(/url\([^)]+\)/, `url(${data})`);
    }));
    return out.join("\n");
  } catch { return ""; }
}
/** 卡上會印出來的字（含姓名欄）＋基本拉丁字元。 */
const exportChars = (el) => el.textContent + " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;()[]-+/×%·";

/** 紙的紋理與印章的粗糙遮罩是「帶 SVG 濾鏡（feTurbulence）的 data-URI」。包進 html-to-image 的 SVG 之後，
 *  這種巢狀濾鏡在 Chrome 會失效——紋理變成整塊黑、遮罩讓印章整個消失。所以轉圖前先在 canvas 上把它們畫成 PNG。
 *  （直接當 <img> 或 CSS 背景顯示時濾鏡是好的，只有被包進另一層 SVG 才壞。） */
// 瀏覽器回報的計算值一律是 url("…")，而 SVG 的 data-URI 裡面本身有單引號（xmlns='…'），所以只認雙引號包住的整段
const svgUrlRe = /url\("(data:image\/svg\+xml[^"]*)"\)/g;
const rasterCache = new Map();
async function rasterizeSvg(dataUri) {
  if (rasterCache.has(dataUri)) return rasterCache.get(dataUri);
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 240, h = img.naturalHeight || 240;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      res(c.toDataURL("image/png"));
    };
    img.onerror = rej;
    img.src = dataUri;
  });
  rasterCache.set(dataUri, p);
  return p;
}
async function rasterizeFilteredBackgrounds(root) {
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const cs = getComputedStyle(el);
    for (const [prop, css] of [["backgroundImage", "background-image"], ["webkitMaskImage", "-webkit-mask-image"], ["maskImage", "mask-image"]]) {
      const v = cs[prop];
      if (!v || !v.includes("data:image/svg+xml")) continue;
      const uris = [...v.matchAll(svgUrlRe)].map((m) => m[1]);
      let out = v;
      for (const u of uris) out = out.split(u).join(await rasterizeSvg(u));
      el.style.setProperty(css, out);
    }
  }
}

function buildExportNode(name = "") {
  const src = document.querySelector("#out .sheet");
  if (!src) return null;
  const host = document.createElement("div");
  host.className = "export-host";                                   // 寬 940 = 結果區最大寬度，桌面版面
  const wrap = document.createElement("div");
  wrap.className = "result";
  const clone = src.cloneNode(true);
  clone.classList.remove("enter");
  clone.style.boxShadow = "none";
  clone.querySelectorAll(".note-btn, .notes").forEach((e) => e.remove());   // 註解是給畫面上看的，圖上不放
  if (name) {
    // 名字印在「角色」欄：卡上已有這一欄（角色頁的【角色】）就換掉值，沒有就補一欄放在最前面
    let box = clone.querySelector(".sh-fields");
    if (!box) {
      box = document.createElement("div");
      box.className = "sh-fields";
      (clone.querySelector("h3.band") || clone.lastElementChild).before(box);
    }
    const has = [...box.querySelectorAll(".fld")].find((f) => f.querySelector(".fld-l")?.textContent === T("fieldCharacter"));
    if (has) has.querySelector(".fld-v").textContent = name;
    else box.insertAdjacentHTML("afterbegin", field("fieldCharacter", name, [], true));
  }
  const mark = document.createElement("p");
  mark.className = "export-mark";
  mark.textContent = `${location.host} · JevTRPG`;
  wrap.append(clone, mark);
  host.append(wrap);
  document.body.append(host);
  return { host, wrap, clone };
}
const slug = (s) => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** 預覽對話框：使用者再按一次「下載」才存檔——產生要好幾秒，之後才自動下載會被瀏覽器當成沒有手勢的下載
 *  （Chrome 對同一網站第二次起會擋或跳「允許下載多個檔案」）。手機上可以長按圖片，或走系統分享面板。 */
function showImageDialog(blob, filename) {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], filename, { type: "image/jpeg" });
  // 手機：「下載」只會落成一個 jpg 檔（iPhone 進「檔案」App、Android 進下載資料夾），不會進相簿。
  // 要進相簿得走系統分享選單（iPhone 的「儲存影像」、Android 的相簿／照片），所以支援就把它當主按鈕。
  const touch = matchMedia("(pointer: coarse)").matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const canShare = touch && !!navigator.canShare?.({ files: [file] });
  const d = document.createElement("dialog");
  d.className = "img-dialog";
  d.setAttribute("aria-label", T("saveImg"));
  d.innerHTML = `<img src="${url}" alt="" class="img-preview">
    <div class="img-actions">
      ${canShare ? `<button type="button" class="btn-stamp btn-small" id="img-share">${esc(T("imgSaveAlbum"))}</button>` : ""}
      <a class="${canShare ? "btn-text" : "btn-stamp btn-small"}" id="img-dl" href="${url}" download="${esc(filename)}">${esc(T(canShare ? "imgDownloadFile" : "imgDownload"))}</a>
      <button type="button" class="btn-text" id="img-close">${esc(T("imgClose"))}</button>
    </div>
    <p class="img-hint">${esc(T(canShare ? "imgHintTouch" : "imgHint"))}</p>`;
  document.body.append(d);
  const close = () => { d.close(); };
  d.addEventListener("close", () => { URL.revokeObjectURL(url); d.remove(); });
  d.querySelector("#img-close").onclick = close;
  d.addEventListener("click", (e) => { if (e.target === d) close(); });        // 點圖外的暗處也關
  d.querySelector("#img-dl").addEventListener("click", () => track("image_save", { page: PAGE, lang: LANG, via: "download" }));
  d.querySelector("#img-share")?.addEventListener("click", async () => {
    try { await navigator.share({ files: [file] }); track("image_save", { page: PAGE, lang: LANG, via: "share" }); } catch { /* 使用者取消 */ }
  });
  d.showModal();
}

async function saveImage(name = "") {
  const b = $("saveimg"), msg = $("img-msg");
  if (!b || b.disabled) return;
  const label = b.textContent;
  b.disabled = true; b.textContent = T("imgMaking"); if (msg) msg.textContent = "";
  const parts = buildExportNode(name);
  if (!parts) { b.disabled = false; b.textContent = label; return; }
  try {
    const h2i = await loadH2I();
    await document.fonts.ready;
    await rasterizeFilteredBackgrounds(parts.wrap);
    const fontEmbedCSS = await fontCssFor(exportChars(parts.wrap));
    // JPEG：紙張噪點讓 PNG 變 ~8 MB（實測），社群常見上限 5 MB；JPEG 0.9 預期約 1 MB
    const blob = await h2i.toJpeg(parts.wrap, { pixelRatio: 2, quality: 0.9, fontEmbedCSS, backgroundColor: "#131915", cacheBust: false })
      .then((u) => fetch(u).then((r) => r.blob()));
    if (!blob) throw new Error("empty");
    const name = slug(parts.clone.querySelector(".fld-v")?.textContent) || "sheet";
    showImageDialog(blob, `JevTRPG-${name}.jpg`);
  } catch (e) {
    if (msg) msg.textContent = T("imgFail");
    track("image_fail", { page: PAGE, lang: LANG });
  } finally {
    parts.host.remove();
    b.disabled = false; b.textContent = label;
  }
}

const btn = (id, key) => `<button type="button" class="btn-text" id="${id}">${esc(T(key))}</button>`;

function renderResult(d) {
  VIEW = "result";
  const canShare = d.mode !== "check";
  const shareForm = `<form class="share-form" id="share-form" hidden>
      <label for="share-name">${esc(T("shareNameLabel"))}</label>
      <input id="share-name" maxlength="24" autocomplete="off" value="${esc(d._name || "")}" placeholder="${esc(T("shareNamePh"))}">
      <button type="submit" class="btn-stamp btn-small" id="share-do">${esc(T("shareDo"))}</button>
      <p class="share-hint" id="share-hint">${esc(T("shareNameHint"))}</p>
    </form>`;
  // 重骰只給履歷頁的一般結果：角色頁有玩家填的數值、點數上限（有配點）是照特性值算的，重骰會弄亂
  const canReroll = PAGE === "resume" && d.mode === "build" && !d.capped;
  showResult(renderSheet(d), (canShare ? btn("share", "share").replace("<button ", '<button aria-expanded="false" aria-controls="share-form" ') : "")
    + (canReroll ? btn("reroll", "reroll") : "")
    + btn("saveimg", "saveImg") + btn("again", "again") + `<span class="sheet-note" id="img-msg" role="status"></span>`
    + (canReroll && d._rerolls ? `<p class="sheet-note reroll-note" id="reroll-note">${esc(T("rerollNote", { n: d._rerolls }))}</p>` : "")
    + shareForm);
  bindTools(canShare ? (name) => makeHash(d, name) : null, d);
  if (canShare) { getWire(d.locale || LANG).catch(() => {}); codec().catch(() => {}); }
  if (canReroll) $("reroll").addEventListener("click", () => reroll(d));
}

/** 重骰：只換擲骰的特性值（不呼叫 Jev、不用人機驗證）。同一個 d 被改掉再重畫，所以分享、存圖拿到的就是現在這組。 */
async function reroll(d) {
  const b = $("reroll");
  b.disabled = true;
  try {
    const r = await fetch("/api/reroll", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chars: d.chars, system: "coc", locale: d.locale || LANG }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const out = await r.json();
    d.chars = out.chars; d.derived = out.derived; d._rerolls = (d._rerolls || 0) + 1;
    track("reroll", { page: PAGE, lang: LANG, n: d._rerolls });
    renderResult(d);
    $("reroll")?.focus({ preventScroll: true });
  } catch {
    b.disabled = false;
    $("img-msg").textContent = T("rerollFail");
  }
}

function showLoading() {
  $("out").innerHTML = `<div class="result"><div class="sheet paper sheet--loading" aria-busy="true">
      <p class="typing typed">${esc(T("working"))}<span class="caret"></span></p>
      <p class="typing-sub">${esc(T("workingSub"))}</p>
      <div class="skel-chars" aria-hidden="true">${"<i></i>".repeat(9)}</div>
      <div class="skel-lines" aria-hidden="true">${"<i></i>".repeat(18)}</div>
    </div></div>`;
}

function fail(msg) {
  VIEW = null;
  $("out").innerHTML = `<div class="result"><div class="paper err" role="alert"><p class="typed">${esc(msg)}</p></div></div>`;
}

/* ── 縮圖與範例：範例是真的跑出來的結果，存在 samples/ ────────────── */
const SAMPLES = {};
function getSample(lang = LANG) {
  const key = `${PAGE === "character" ? "character" : "resume"}.${lang}`;
  SAMPLES[key] ||= fetch(`samples/${key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return SAMPLES[key];
}

async function loadPreview() {
  const lang = LANG;
  const d = await getSample(lang);
  if (d && lang === LANG) $("preview-sheet").innerHTML = renderSheet(d, { mini: true });
}

async function showSample(scroll = true) {
  const d = await getSample();
  if (!d) return fail(T("errNetwork"));
  VIEW = "sample";
  showResult(renderSheet(d), `<p class="sheet-note">${esc(T("sampleNote"))}</p>${btn("saveimg", "saveImg")}${btn("again", "makeMine")}<span class="sheet-note" id="img-msg" role="status"></span>`);
  bindTools(null);
  if (scroll) {
    track("sample_open", { page: PAGE, lang: LANG });
    $("out").scrollIntoView({ behavior: smooth(), block: "start" });
  }
}

/* ── 送出 ────────────────────────────────────────────────────────────── */
async function submit() {
  const text = $("text").value.trim();
  if (!text) return fail(T("empty"));
  if (text.length > MAX) return fail(T("tooLong", { max: MAX, n: text.length }));

  const body = { text, system: "coc", locale: LANG };
  if (PAGE === "character") body.bonus = parseInt($("bonus").value, 10) || 0;
  if (PAGE === "resume") {
    // 履歷頁：信箱、電話…與使用者列的字詞在這裡先遮掉，那些字不會離開瀏覽器；Worker 收到後還會再遮一次。
    // 遮蔽模組載不到就不送（寧可失敗，也不要讓人以為遮了其實沒遮）。
    try {
      const { clean, hits } = await currentRedaction();
      body.text = clean;
      if (Object.keys(hits).length) body.masked = hits;      // 只回報「遮了幾個什麼」，讓卡片頁腳誠實
    } catch { return fail(T("rvFail")); }
  }

  // 先停用按鈕、顯示載入，再等 Turnstile token（最多 10 秒）：不然等待期間沒有任何回饋，還能連點送兩次
  $("go").disabled = true;
  VIEW = null;
  showLoading();
  $("out").scrollIntoView({ behavior: smooth(), block: "start" });
  let status = 0, code = "", info = {};
  try {
    if (ts.siteKey) {
      body.turnstile = await turnstileToken();
      if (!body.turnstile) track("turnstile_timeout", { page: PAGE, lang: LANG });
      // 沒拿到憑證也照送：伺服器會把它當成「沒通過驗證」，走較小的額度，而不是整個擋掉
    }
    // 角色頁交給 Worker 判斷要配點還是檢查——只有它有三語的區塊標記表
    let r;
    try {
      r = await fetch(PAGE === "character" ? "/api/character" : "/api/build", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { code = "network"; throw new Error(code); }
    status = r.status;
    const d = await r.json().catch(() => ({}));             // 不是 JSON（例如邊緣節點的錯誤頁）也不能讓使用者看到「Unexpected token <」
    if (!r.ok) { code = d.code || ""; info = d; throw new Error(code || `HTTP ${status}`); }
    renderResult(d);
    track("sheet_generated", { page: PAGE, lang: LANG, mode: d.mode, capped: !!d.capped });
  } catch {
    fail(errText(status, code, text, info));
    track("sheet_failed", { page: PAGE, lang: LANG, status, code });   // 只記狀態碼與我們自己的錯誤代碼，不記原因文字（可能夾帶使用者內容）
  } finally {
    $("go").disabled = false;
    if (ts.siteKey && window.turnstile) { ts.token = null; try { window.turnstile.reset(ts.id); } catch { /* ignore */ } }
  }
}

/* ── 角色頁：加一項技能 ───────────────────────────────────────────────────
   技能清單（名稱、基礎值、別名、區塊標記）來自 GET /api/skills，跟檢查時用的是同一份系統包。
   「加入」只是把 `名稱 值` 這一行寫進文字框的【技能】區塊（沒有就補一個區塊；同名就換掉值）——
   文字框仍是唯一的真相，送出走原本的解析，所以手打與點選的結果一定一樣。 */
let SKILL_LIST = null;
async function loadSkillList() {
  const lang = LANG;
  try {
    const r = await fetch(`/api/skills?locale=${encodeURIComponent(lang)}`);
    if (!r.ok || lang !== LANG) return;
    SKILL_LIST = await r.json();
    $("as-list").innerHTML = SKILL_LIST.skills.map((s) =>
      `<option value="${esc(s.label)}" label="(${pad2(s.base)})"></option>`).join("");
  } catch { /* 清單載不到就只能手打，不影響檢查 */ }
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function skillHeaderRe(sections, keys) {
  const names = keys.flatMap((k) => sections[k] || []).sort((a, b) => b.length - a.length).map(reEsc);
  return new RegExp("^[ \\t]*[【\\[［]\\s*(" + names.join("|") + ")\\s*[】\\]］]", "i");
}
/** 把一行技能放進文字：有【技能】區塊就放到區塊尾，同名的換掉值；沒有就補一個區塊在最後。 */
function putSkillLine(text, sections, header, name, value) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const skillsRe = skillHeaderRe(sections, ["skills"]);
  const anyRe = skillHeaderRe(sections, Object.keys(sections));
  const start = lines.findIndex((l) => skillsRe.test(l));
  const entry = `${name} ${value}`;
  if (start < 0) return text.replace(/\s+$/, "") + (text.trim() ? "\n\n" : "") + header + "\n" + entry + "\n";
  let end = lines.findIndex((l, i) => i > start && anyRe.test(l));
  if (end < 0) end = lines.length;
  const sameRe = new RegExp("^\\s*" + reEsc(name) + "\\s*[:：]?\\s+\\d+\\s*%?\\s*$", "i");
  for (let i = start + 1; i < end; i++) if (sameRe.test(lines[i])) { lines[i] = entry; return lines.join("\n"); }
  let at = end;
  while (at - 1 > start && lines[at - 1].trim() === "") at--;          // 插在區塊最後一行之後、空行之前
  lines.splice(at, 0, entry);
  return lines.join("\n");
}
function startAddSkill() {
  const say = (k, vars) => { $("as-msg").textContent = T(k, vars); };
  const add = () => {
    const name = $("as-name").value.trim(), v = parseInt($("as-val").value, 10);
    if (!name) return say("asNeedName");
    if (!(v >= 0 && v <= 99)) return say("asNeedValue");
    const low = name.toLowerCase();
    const known = SKILL_LIST?.skills.some((s) => [s.id, s.label, ...s.aliases].some((n) => n.toLowerCase() === low));
    $("text").value = putSkillLine($("text").value, SKILL_LIST?.sections || {}, T("skillsHeader"), name, v);
    setCount();
    $("as-name").value = ""; $("as-val").value = "";
    say(known === false ? "asAddedUnknown" : "asAdded", { n: name });
    $("as-name").focus();
  };
  $("as-add").addEventListener("click", add);
  for (const id of ["as-name", "as-val"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
}

/* ── 履歷頁：拖檔、遮蔽預覽 ───────────────────────────────────────────────
   檔案只在瀏覽器裡讀成文字（extract.js）；遮蔽用跟 Worker 同一份規則（redact.js）。
   文字框仍是唯一的真相：拖進來的內容只是被「填進」文字框，使用者看得到、改得了，送出走原本的路。 */
let REDACT_MOD = null, EXTRACT_MOD = null;
const redactMod = () => (REDACT_MOD ||= import("/redact.js"));
const extractMod = () => (EXTRACT_MOD ||= import("/extract.js"));
const listTags = (hits) => Object.entries(hits).map(([k, n]) => `${tagName(k)} ×${n}`).join(LANG === "en" ? ", " : "、");

async function currentRedaction() {
  const R = await redactMod();
  const { terms, tooShort } = R.parseTerms($("mask-terms").value);
  const [clean, hits] = R.redact($("text").value.trim(), terms);
  return { clean, hits, tooShort, TAGS: R.TAGS };
}

let rvTimer = 0;
const scheduleRv = () => { clearTimeout(rvTimer); rvTimer = setTimeout(updateRv, 200); };
async function updateRv() {
  const line = $("rv-line"), tg = $("rv-toggle"), view = $("rv-view");
  if (!$("text").value.trim()) { line.textContent = ""; tg.hidden = true; view.hidden = true; return; }
  try {
    const { clean, hits, tooShort, TAGS } = await currentRedaction();
    const n = Object.keys(hits).length;
    line.textContent = (n ? T("rvWill", { list: listTags(hits) }) : T("rvNone"))
      + tooShort.map((s) => " " + T("maskShort", { t: s })).join("");
    tg.hidden = false;
    tg.textContent = T(view.hidden ? "rvShow" : "rvHide");
    if (!view.hidden) {
      const re = new RegExp(TAGS.map(reEsc).join("|"), "g");
      view.innerHTML = esc(clean.slice(0, 20000)).replace(re, (m) => `<mark>${m}</mark>`);
    }
  } catch { line.textContent = ""; }
}

async function loadFile(files) {
  const msg = $("file-msg");
  if (!files.length) return;
  const f = files[0], multi = files.length > 1 ? T("fileMulti") + " " : "";
  msg.textContent = T("fileReading");
  try {
    const E = await extractMod();
    const { text, kind } = await E.extractText(f);
    if ($("text").value.trim().length >= 30 && !confirm(T("fileReplace"))) { msg.textContent = ""; return; }
    $("text").value = text;
    setCount(); updateRv();
    msg.textContent = multi + T("fileOk", { name: f.name, n: text.length.toLocaleString() });
    track("file_loaded", { page: PAGE, lang: LANG, kind });                 // 只記種類，不記檔名與內容
  } catch (e) {
    const code = ["unsupported", "toobig", "corrupt", "encrypted", "empty"].includes(e?.code) ? e.code : "corrupt";
    msg.textContent = T("fileErr_" + code);
    track("file_failed", { page: PAGE, lang: LANG, code: e?.code || "other" });
  }
}

function startDrop() {
  const box = document.querySelector(".intake");
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  // 整個視窗都接：不然手滑放到文字框外面，瀏覽器會直接把 PDF 開起來、把還沒送出的文字弄丟
  window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { e.preventDefault(); box.classList.add("drag"); } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  window.addEventListener("dragleave", (e) => { if (hasFiles(e) && e.relatedTarget === null) box.classList.remove("drag"); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); box.classList.remove("drag");
    loadFile([...e.dataTransfer.files]);
  });
  $("pick").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", () => { loadFile([...$("file").files]); $("file").value = ""; });
  $("mask-terms").addEventListener("input", scheduleRv);
  $("text").addEventListener("input", scheduleRv);
  $("rv-toggle").addEventListener("click", () => {
    const view = $("rv-view");
    view.hidden = !view.hidden;
    $("rv-toggle").setAttribute("aria-expanded", String(!view.hidden));
    updateRv();
  });
}

/* ── 啟動 ────────────────────────────────────────────────────────────── */
applyLang();
if (PAGE !== "privacy") startTool();

function startTool() {
  if (PAGE === "character") startAddSkill();
  if (PAGE === "resume") startDrop();
  $("text").addEventListener("input", setCount);
  $("go").addEventListener("click", submit);
  $("sample").addEventListener("click", () => {
    const resumeSample = { en: SAMPLE_RESUME_EN, ja: SAMPLE_RESUME_JA }[LANG] || SAMPLE_RESUME;
    const charSample = { en: SAMPLE_CHAR_EN, ja: SAMPLE_CHAR_JA }[LANG] || SAMPLE_CHAR;
    $("text").value = PAGE === "resume" ? resumeSample : charSample;
    setCount();
    if (PAGE === "resume") updateRv();
    $("text").focus();
  });
  $("preview-open").addEventListener("click", (e) => { e.preventDefault(); showSample(); });
  // 縮圖是一張 860px 寬的正卡整張 zoom 下去，比例跟著框寬走
  const fitPreview = () => $("preview-open").style.setProperty("--z", ($("preview-open").clientWidth / 860).toFixed(3));
  new ResizeObserver(fitPreview).observe($("preview-open"));

  // 分享連結進來的話直接畫，不打判讀 API（只拿一份編碼表）
  if (location.hash.startsWith("#c=")) showShared(location.hash.slice(3));
}
