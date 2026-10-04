/**
 * Cloudflare Worker：代打 Jev，金鑰留在這裡，履歷不落地。
 *
 * 沒有資料庫，故意的。三種狀態分開看：
 *   履歷 → 永遠不寫任何地方，只在這個 request 的記憶體裡走一趟
 *   卡片 → 前端把結果編碼進網址，分享不需要後端存東西
 *   防濫用 → Turnstile + 輸入長度上限 + Cloudflare 儀表板的 Rate Limiting Rule
 *
 * 計分邏輯跟 engine/scoring.py 是一份東西的兩種語言。動其中一邊就要動另一邊，
 * 所以規則本身（技能、量表、題目措辭）全部來自 system.json，由 web/build.py
 * 從 systems/<name>/system.yaml 編出來——資料只有一份真相，這裡只有算法。
 */
import SYSTEMS from "../system.js";
import FROZEN from "../wire-frozen.js";
import { Quota, limitsFrom } from "./quota.js";
export { Quota };   // Durable Object：wrangler 要從進入點匯出它
import { META, OG_LOCALE, PAGE_OF } from "../../public/meta.js";
import { redact, sanitizeHits } from "../../public/redact.js";   // 瀏覽器共用同一份（見該檔頭註）

const API = "https://api.typesafe.ai/v1/systemone";
const MAX_CHARS = 12000;   // 一份履歷約 1,400 字元；上限同時是成本上限
const SPLIT_MIN = 0.25;    // 第二高的等級機率超過這個就算「有兩種讀法」

/* ── 計分：三個量千萬不要混（見 engine/scoring.py 的長註解）──────────────
   有沒有證據 = 1 − P(最低級)   多強 = Σ 機率×各級的值   信心 = 對「哪一級」的確定度 */
function read(answer, values, ceilings) {
  const p = {};
  for (const [k, v] of Object.entries(answer.probabilities || {})) p[+k] = +v;
  const ranked = Object.entries(p).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] || [0, 0];
  const second = ranked[1] || [0, 0];
  const sum = (arr) => arr.reduce((s, v, i) => s + (p[i] || 0) * v, 0);
  return {
    level: answer.score, confidence: answer.confidence,
    evidence: 1 - (p[0] || 0),
    value: Math.round(sum(values)),
    ceiling: Math.round(sum(ceilings)),
    top, second, split: second[1] >= SPLIT_MIN,
    probabilities: p,
  };
}

/** 貪婪配點：配到目標值為止、用完為止。比例平分會把點攤薄成一堆中庸的 40 幾。 */
function allocate(rows, budget, cap = 90) {
  const final = {};
  for (const [n, r] of Object.entries(rows)) final[n] = r.base;
  const order = Object.keys(rows).sort(
    (a, b) => rows[b].evidence * rows[b].level - rows[a].evidence * rows[a].level);
  const used = [];
  for (const n of order) {
    const want = rows[n].value - rows[n].base;
    if (want <= 1 || budget <= 0) continue;
    const give = Math.min(want, budget, cap - rows[n].base);
    if (give <= 0) continue;
    final[n] = Math.round(rows[n].base + give);
    budget -= give;
    used.push(n);
  }
  return { final, used, left: Math.round(budget) };
}

function rollDice(spec, rng) {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(spec.dice);
  let total = +(m[3] || 0);
  for (let i = 0; i < +m[1]; i++) total += 1 + Math.floor(rng() * +m[2]);
  return total * (spec.mul || 1);
}

/** 種子綁文件內容：同一份文件永遠得到同一個角色。 */
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 點數公式的算式解析器。**不能用 Function()／eval**：Cloudflare Workers 禁止執行期
 *  產生程式碼（Node 允許，所以單元測試抓不到，端到端才撞出來）。
 *  只認特性值名稱、數字、+ - * /、括號，一般運算優先序。 */
function evalFormula(src, vars) {
  const toks = src.match(/[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[-+*/()]/g) || [];
  if (toks.join("") !== src.replace(/\s+/g, "")) throw new Error(`bad formula: ${src}`);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  function atom() {
    const t = take();
    if (t === "(") { const v = sum(); if (take() !== ")") throw new Error("missing )"); return v; }
    if (t === "-") return -atom();
    if (t === "+") return atom();
    if (/^\d/.test(t)) return parseFloat(t);
    if (/^[A-Za-z_]/.test(t)) {
      if (!(t in vars)) throw new Error(`unknown characteristic in formula: ${t}`);
      return vars[t];
    }
    throw new Error(`unexpected token: ${t}`);
  }
  function product() {
    let v = atom();
    while (peek() === "*" || peek() === "/") v = take() === "*" ? v * atom() : v / atom();
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + product() : v - product();
    return v;
  }
  const v = sum();
  if (i !== toks.length) throw new Error(`trailing tokens in formula: ${src}`);
  return v;
}

function budgetOf(sys, chars) {
  const out = {};
  for (const [k, f] of Object.entries(sys.budget)) out[k] = Math.trunc(evalFormula(f, chars));
  return out;
}

/** HP／MP／SAN 這類衍生值。需要的特性值缺了就不算（不擲骰補）；同一套在 engine/system.py。 */
function derivedOf(sys, chars) {
  const out = {};
  for (const [k, f] of Object.entries(sys.derived || {})) {
    try { out[k] = Math.trunc(evalFormula(f, chars)); } catch { /* 缺特性值：這格留空 */ }
  }
  return out;
}

/** 重骰：只換要擲骰的那幾格（STR、CON…），履歷讀出來的（EDU）與其他都照原值；衍生值跟著重算。
 *  不呼叫模型、不花錢，所以不需要人機驗證。rng 可注入（測試用）。 */
function rerollChars(sys, chars, rng = Math.random) {
  const out = {};
  for (const [k, spec] of Object.entries(sys.characteristics)) {
    if (spec.dice) out[k] = rollDice(spec, rng);
    else if (Number.isFinite(+chars?.[k])) out[k] = Math.max(1, Math.min(99, Math.trunc(+chars[k])));
  }
  return { chars: out, derived: derivedOf(sys, out) };
}

/** 分享連結的編碼表：把「職業名、技能名、背景選項」換成編號用的順序。
 *  順序一律排序過（不靠 YAML 或建置順序），並附一個指紋（fp）。連結裡記著它是用哪一版表做的。
 *
 *  ⚠ 已經發出去的連結不能因為我們改了職業表／技能表就失效（2026-09-30 擴充職業表時踩過：
 *  表一變、指紋就變，所有已分享的連結都成了「舊版本讀不了」）。所以歷代的表都凍結在
 *  wire-frozen.js（由 wire-freeze.mjs 產生、只增不改），解碼時依連結上的指紋取對應那一版；
 *  新連結永遠用最新一版。測試會擋：目前的表沒有凍結、或凍結版裡的項目在目前的系統包已不存在。 */
function listsOf(sys) {
  const sortKeys = (o) => Object.keys(o).sort();
  return {
    chars: sortKeys(sys.characteristics),
    derived: sortKeys(sys.derived || {}),
    eras: sortKeys(sys.occupations),
    occ: Object.fromEntries(sortKeys(sys.occupations).map((e) => [e, sortKeys(sys.occupations[e])])),
    skills: sortKeys(sys.skills),
    bs: sortKeys(sys.backstory).map((k) => ({ title: sys.backstory[k].title || k, options: sortKeys(sys.backstory[k].options) })),
  };
}
/** 指紋只看「順序與內容的鍵」，不看標籤文字 */
function fpOf(l) {
  const basis = JSON.stringify([l.chars, l.derived, l.eras, l.occ, l.skills, l.bs]);
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) & 0xffff;
}
/** wantFp：連結上的指紋。等於目前這版就給目前的；是凍結過的舊版就給舊版；都不是就給目前的（解碼時會判成「舊版」）。 */
function wireOf(sys, locale, wantFp = null) {
  let lists = listsOf(sys);
  if (wantFp != null && +wantFp !== fpOf(lists)) {
    const old = (FROZEN[locale] || []).find((g) => fpOf(g) === +wantFp);
    if (old) lists = old;
  }
  return {
    v: 1, locale, ...lists, fp: fpOf(lists),
    skills: lists.skills.map((id) => ({ id, label: sys.skills[id]?.label || id })),   // 名稱一律用目前的
  };
}

/** 使用者打的技能名 → canonical id；認不出來或有歧義回 null（寧可標未知，不猜）。
 *  同一套邏輯在 engine/system.py 的 _match_id（fixtures.json 的 matching 樣本由那邊算）。
 *
 *  ⚠ 不能先砍括號再模糊比對：Language (Own) 與 Language (Other) 砍完都是 "language"，
 *  誰贏取決於字典順序——這邊讀的是 build.py 排序過的 system.js，Python 讀 YAML 順序，
 *  兩邊剛好相反，各錯一個方向（2026-09-30）。 */
function matchSkillId(sys, name) {
  const norm = (s) => String(s).toLowerCase().replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, " ").trim();
  const full = norm(name);
  const entries = Object.entries(sys.skills);
  const names = Object.fromEntries(entries.map(([k, v]) =>
    [k, new Set([norm(k), norm(v.label), ...(v.aliases || []).map(norm)])]));
  let hit = entries.filter(([k]) => names[k].has(full)).map(([k]) => k);         // 1 全名（含括號）
  if (hit.length === 1) return hit[0];
  const bare = full.split("(")[0].trim();                                          // 2 去掉尾端限定詞
  if (bare !== full) {
    hit = entries.filter(([k, v]) => names[k].has(bare) || (v.family && bare === norm(v.family))).map(([k]) => k);
    if (hit.length === 1) return hit[0];
    if (hit.length) return null;
  }
  hit = entries.filter(([k]) => [...names[k]].some((n) => n.includes(bare) || bare.includes(n))).map(([k]) => k);
  return hit.length === 1 ? hit[0] : null;                                         // 3 子字串，唯一命中才算
}
function matchSkill(sys, name) {
  const id = matchSkillId(sys, name);
  return id ? sys.skills[id] : null;
}

async function askJev(env, state, questions) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
      // 不收 brotli：題目一多，httpx/部分 runtime 的 br 解碼會出事，gzip 最穩
      "Accept-Encoding": "gzip",
    },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ── 兩個模式 ────────────────────────────────────────────────────────── */

async function build(env, sys, text, { cap = false, bonus = 0, charsOverride = null, pre = {} } = {}) {
  const [clean, found] = redact(text.trim());
  // 瀏覽器已經先遮過一次（那些字沒有送上來），所以這裡的計數要加上它回報的
  const hits = { ...pre };
  for (const [k, v] of Object.entries(found)) hits[k] = (hits[k] || 0) + v;
  const P = sys.prompts;
  const questions = {
    edu: { type: "score", instructions: P.education,
           criteria: sys.education.map((e) => e.level) },
  };
  for (const [era, table] of Object.entries(sys.occupations))
    questions[`occ::${era}`] = { type: "choice", instructions: P.occupation, criteria: table };
  const skills = Object.fromEntries(Object.entries(sys.skills).filter(([, v]) => v.reachable));
  for (const [name, spec] of Object.entries(skills)) {
    const clause = spec.evidence
      ? P.build_evidence_clause.replace("{evidence}", spec.evidence) : "";
    questions[`s::${name}`] = {
      type: "score", criteria: sys.levels,
      instructions: P.build.replace("{name}", spec.label || name)
        .replace("{meaning}", spec.meaning).replace("{evidence}", clause),
    };
  }
  for (const [cid, bs] of Object.entries(sys.backstory))
    questions[`b::${cid}`] = { type: "choice", criteria: bs.options,
      instructions: P.backstory.replace("{name}", bs.title) };

  const res = await askJev(env, clean, questions);
  const a = res.answers;
  const eduVals = sys.education.map((e) => e.value);
  const edu = read(a.edu, eduVals, eduVals).value;

  const rng = seeded(clean);
  const chars = {};
  for (const [k, spec] of Object.entries(sys.characteristics))
    if (spec.dice) chars[k] = rollDice(spec, rng);
  chars.EDU = edu;
  // 玩家自己填了特性值就照填的算，不擲骰、不讓模型判 EDU（check 模式本來就這樣）
  Object.assign(chars, charsOverride || {});
  // 卡面要標每一格從哪來：擲骰、Jev 判讀、還是玩家自己填的
  const sources = {};
  for (const k of Object.keys(chars))
    sources[k] = (charsOverride && k in charsOverride) ? "player" : k === "EDU" ? "read" : "rolled";
  const budget = budgetOf(sys, chars);
  budget.occupation += bonus;

  const rows = {};
  for (const [name, spec] of Object.entries(skills)) {
    const values = [spec.base, ...sys.value.slice(1)];
    rows[name] = { ...read(a[`s::${name}`], values, sys.ceiling),
                   base: spec.base, label: spec.label || name };
  }
  const capped = cap
    ? allocate(rows, Object.values(budget).reduce((x, y) => x + y, 0))
    : { final: null, used: [], left: 0 };

  return {
    mode: "build", model: res.model, redacted: hits, chars, sources, derived: derivedOf(sys, chars),
    budget, capped: cap,
    skills: rows, final: capped.final, occupationSkills: capped.used,
    occupations: Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith("occ::"))
      .map(([k, v]) => [k.slice(5), { choice: v.choice, confidence: v.confidence,
        alternatives: Object.entries(v.probabilities).sort((x, y) => y[1] - x[1]).slice(1, 4) }])),
    backstory: Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith("b::"))
      .map(([k, v]) => [sys.backstory[k.slice(3)]?.title || k.slice(3),
                        { choice: v.choice, confidence: v.confidence }])),
  };
}

/** 依別名表切區塊。標記要在行首；【】、[]、［］都認；英文不分大小寫。
 *  同一套邏輯在 engine/modes.py 的 split_sections，改一邊要改另一邊（test.mjs 會抓）。 */
function splitSections(text, sections) {
  const alias = {};
  for (const [key, names] of Object.entries(sections)) for (const n of names) alias[n.toLowerCase()] = key;
  const names = Object.keys(alias).sort((a, b) => b.length - a.length);   // 長的先比
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^[ \\t]*[【\\[［]\\s*(" + names.map(esc).join("|")
    + ")\\s*[】\\]］]", "gmi");
  const hits = [...text.matchAll(re)];
  const out = {};
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    const key = alias[m[1].toLowerCase()];
    out[key] = ((out[key] || "") + "\n" + text.slice(m.index + m[0].length, end)).trim();
  });
  return out;
}

/** {別名小寫: 特性值代碼}，從系統包的 characteristics.aliases 來。同一套在 engine/system.py。 */
function charAliases(sys) {
  const out = {};
  for (const [k, spec] of Object.entries(sys.characteristics || {}))
    for (const a of [k, ...(spec.aliases || [])]) out[String(a).toLowerCase()] = k;
  return out;
}

/** aliases 給了就把「幸運」「筋力」這類名字換回代碼，不然會跟擲骰的那格並存。 */
function parseCharacter(text, sections, aliases = null) {
  const s = splitSections(text, sections);
  const chars = {}, claimed = {};
  for (const m of (s.characteristics || "").matchAll(
      /([A-Za-z\u3040-\u30ff\u4e00-\u9fff]+)\s*[:：]?\s*(\d+)/g)) {
    const k = (aliases || {})[m[1].toLowerCase()]
      || (/^[\x00-\x7f]+$/.test(m[1]) ? m[1].toUpperCase() : m[1]);
    chars[k] = +m[2];
  }
  for (const line of (s.skills || "").split("\n")) {
    const m = /^\s*(.+?)\s*[:：]?\s+(\d+)\s*%?\s*$/.exec(line);
    if (m) claimed[m[1].trim()] = +m[2];
  }
  return { state: { 角色: s.character || "", 背景: s.backstory || "" }, chars, claimed };
}

async function check(env, sys, text, { bonus = 0 } = {}) {
  const [clean, hits] = redact(text);
  const { state, chars, claimed } = parseCharacter(clean, sys.sections, charAliases(sys));
  if (!Object.keys(claimed).length)
    throw new Error("找不到【技能】區塊，或沒有「名稱 數值」格式的行");

  const P = sys.prompts;
  const questions = {};
  for (const [n, v] of Object.entries(claimed)) {
    const spec = matchSkill(sys, n) || {};
    const clause = spec.evidence
      ? P.build_evidence_clause.replace("{evidence}", spec.evidence) : "";
    questions[`sup::${n}`] = {
      type: "score", criteria: sys.levels,
      instructions: P.check.replace("{name}", n).replace("{value}", String(v))
        .replace("{meaning}", spec.meaning || P.unknown_skill)
        .replace("{evidence}", clause),
    };
  }
  const res = await askJev(env, state, questions);

  const budget = budgetOf(sys, chars);
  budget.occupation += bonus;
  let spent = 0;
  const rows = {};
  for (const [n, v] of Object.entries(claimed)) {
    const spec = matchSkill(sys, n);
    const base = spec ? spec.base : 5;
    spent += Math.max(0, v - base);
    const r = read(res.answers[`sup::${n}`], sys.ceiling, sys.ceiling);
    r.claimed = v; r.base = base; r.known = !!spec;
    r.verdict = r.split ? "爭議"
      : v <= r.ceiling ? "ok"
      : v - r.ceiling <= 10 ? "邊緣" : "撐不起";
    rows[n] = r;
  }
  return { mode: "check", model: res.model, redacted: hits, chars,
           derived: derivedOf(sys, chars), budget, spent, skills: rows };
}

/* ── HTTP ────────────────────────────────────────────────────────────── */

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json; charset=utf-8" },
});

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;   // 本機開發沒設就跳過
  if (!token) return false;                 // 沒帶憑證（驗證元件壞了、或根本是程式直接打）：不用浪費一趟去問
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    return r.ok && (await r.json()).success === true;
  } catch { return false; }                 // 驗證服務連不上：當作沒通過（走小額度），不要讓整站跟著掛
}

/** 用量額度（邏輯在 quota.js）。tier：ok＝驗證通過、weak＝沒通過。
 *  IP 只存加鹽雜湊、只記「這一小時幾次」。額度服務自己出問題時：驗證過的放行、沒驗證的擋下（寧可擋小額度，不開大門）。 */
async function takeQuota(env, ip, tier) {
  if (!env.QUOTA) return { allow: true };    // 本機沒綁 Durable Object 就不限
  try {
    const data = new TextEncoder().encode((env.QUOTA_SALT || "dev") + "|" + (ip || "?"));
    const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
    const stub = env.QUOTA.get(env.QUOTA.idFromName("global"));
    const r = await stub.fetch("https://quota/take", { method: "POST", body: JSON.stringify({ ip: h, tier, limits: limitsFrom(env) }) });
    return await r.json();
  } catch { return tier === "ok" ? { allow: true } : { allow: false, scope: "busy", retryAfter: 60 }; }
}

/** 前端要的公開設定。全部都是「本來就會送到每個瀏覽器」的東西（AdSense 發布者 ID、
 *  PostHog 專案金鑰、Turnstile site key），沒設就回 null——對應功能整個不啟動：
 *  沒有 script、沒有版位、沒有追蹤。POSTHOG_KEY 放 wrangler secret 只是不讓掃描器誤報。 */
function publicConfig(env) {
  const client = env.ADSENSE_CLIENT || "";
  const slots = Object.fromEntries(Object.entries({
    results: env.ADSENSE_SLOT_RESULTS, footer: env.ADSENSE_SLOT_FOOTER,
  }).filter(([, v]) => v));
  return {
    turnstileSiteKey: env.PUBLIC_TURNSTILE_SITEKEY || null,
    // 只有發布者 ID 也夠載 script：自動廣告需要它，即使沒有手動版位
    ads: client ? { client, slots } : null,
    posthog: env.POSTHOG_KEY
      ? { key: env.POSTHOG_KEY, host: env.POSTHOG_HOST || "https://us.i.posthog.com" } : null,
  };
}

/** 角色頁「加一項技能」要的清單：名稱（該語系）、基礎值、別名，外加區塊標記別名（讓前端知道把行插在哪）。
 *  全是系統包裡本來就公開的資料。 */
function skillList(sys) {
  return {
    sections: sys.sections,
    skills: Object.entries(sys.skills).map(([id, v]) => ({ id, label: v.label, base: v.base, aliases: v.aliases || [] })),
  };
}

/** 英文／日文連結（?lang=en）的 <head> 改成該語言：社群爬蟲不跑 JS、也不帶 Accept-Language，
 *  不重寫的話預覽卡永遠是繁中。繁中、沒帶 lang、或不是 HTML 的一律原樣放行。文字在 public/meta.js。 */
async function localizedPage(request, env, url) {
  const res = await env.ASSETS.fetch(request);
  const lang = url.searchParams.get("lang");
  const m = META[lang]?.[PAGE_OF[url.pathname]];
  if (!m || !res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const attr = (v) => ({ element: (e) => e.setAttribute("content", v) });
  const here = `https://${url.host}${url.pathname === "/index.html" ? "/" : url.pathname}?lang=${lang}`;
  return new HTMLRewriter()
    .on("html", { element: (e) => e.setAttribute("lang", lang) })
    .on("title", { element: (e) => e.setInnerContent(m.title) })
    .on('meta[name="description"]', attr(m.desc))
    .on('meta[property="og:title"]', attr(m.ogTitle))
    .on('meta[property="og:description"]', attr(m.ogDesc))
    .on('meta[property="og:url"]', attr(here))
    .on('meta[name="twitter:title"]', attr(m.title))
    .on('meta[name="twitter:description"]', attr(m.desc))
    .on("head", { element: (e) => e.append(`<meta property="og:locale" content="${OG_LOCALE[lang]}">`, { html: true }) })
    .transform(res);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    // 三個頁面的入口（wrangler.toml 的 run_worker_first 讓它們先經過這裡）
    if ((request.method === "GET" || request.method === "HEAD") && PAGE_OF[url.pathname]) return localizedPage(request, env, url);
    // 不記訪客、不寫任何東西：這條只回設定。頁面瀏覽的統計交給 PostHog（前端載入後才有）。
    if (url.pathname === "/api/config" && request.method === "GET") return json(publicConfig(env));
    if (url.pathname === "/api/skills" && request.method === "GET") {
      const pack = SYSTEMS[url.searchParams.get("system") || "coc"];
      if (!pack) return json({ error: "沒有這個系統包", code: "bad_system" }, 400);
      const res = json(skillList(pack[url.searchParams.get("locale")] || pack["zh-Hant"]));
      res.headers.set("Cache-Control", "public, max-age=3600");
      return res;
    }
    if (url.pathname === "/api/quota-status" && request.method === "GET") {
      if (!env.QUOTA || !env.QUOTA_STATUS_TOKEN || request.headers.get("x-watch-token") !== env.QUOTA_STATUS_TOKEN)
        return new Response("not found", { status: 404 });
      const r = await env.QUOTA.get(env.QUOTA.idFromName("global")).fetch("https://quota/status");
      return json({ ...(await r.json()), limits: limitsFrom(env) });
    }
    if (url.pathname === "/api/wire" && request.method === "GET") {
      const pack = SYSTEMS[url.searchParams.get("system") || "coc"];
      if (!pack) return json({ error: "沒有這個系統包", code: "bad_system" }, 400);
      const locale = pack[url.searchParams.get("locale")] ? url.searchParams.get("locale") : "zh-Hant";
      const fp = url.searchParams.get("fp");
      const asked = /^\d{1,5}$/.test(fp || "") ? +fp : null;
      const res = json(wireOf(pack[locale], locale, asked));
      // 指定指紋的那一代不會變，可以快取；「目前這一代」每次都要問（快取一小時會讓瀏覽器拿部署前的表去做新連結）
      res.headers.set("Cache-Control", asked == null ? "no-cache" : "public, max-age=3600");
      return res;
    }
    if (!url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 });
    if (request.method !== "POST") return json({ error: "POST only", code: "bad_request" }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json", code: "bad_request" }, 400); }

    if (url.pathname === "/api/reroll") {
      const pack = SYSTEMS[body.system || "coc"];
      if (!pack) return json({ error: "沒有這個系統包", code: "bad_system" }, 400);
      return json(rerollChars(pack[pack[body.locale] ? body.locale : "zh-Hant"], body.chars));
    }

    const text = String(body.text || "");
    if (!text.trim()) return json({ error: "沒有內容", code: "empty" }, 400);
    if (text.length > MAX_CHARS)
      return json({ error: `太長了：上限 ${MAX_CHARS} 字元，你給了 ${text.length}`, code: "too_long" }, 413);

    // 人機驗證不再擋人：沒通過的照樣可以用，只是走小額度（見 quota.js）。機器人繞過驗證也只拿得到小額度。
    const ip = request.headers.get("CF-Connecting-IP");
    const tier = (await verifyTurnstile(env, body.turnstile, ip)) ? "ok" : "weak";
    const q = await takeQuota(env, ip, tier);
    if (!q.allow)
      return new Response(JSON.stringify({ error: "用量已達上限", code: "quota", scope: q.scope, tier }), {
        status: 429, headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(q.retryAfter || 60) } });

    const pack = SYSTEMS[body.system || "coc"];
    if (!pack) return json({ error: "沒有這個系統包", code: "bad_system" }, 400);
    // 判準語言會移動數字（實測約是履歷語言的兩倍），所以回傳裡要寫明用的是哪一套
    const locale = pack[body.locale] ? body.locale : "zh-Hant";
    const sys = pack[locale];

    const bonus = Math.max(0, Math.min(500, parseInt(body.bonus, 10) || 0));
    try {
      let out;
      if (url.pathname === "/api/character") {
        // 角色頁：有填技能就檢查，沒填就照點數上限幫他配。判斷放在這裡而不是前端，
        // 因為只有這裡有系統包的區塊別名表。
        const [clean] = redact(text);
        const p = parseCharacter(clean, sys.sections, charAliases(sys));
        const doc = [p.state.角色, p.state.背景].filter(Boolean).join("\n\n") || clean;
        out = Object.keys(p.claimed).length
          ? await check(env, sys, text, { bonus })
          : await build(env, sys, doc, { cap: true, bonus, charsOverride: p.chars });
        // 卡頭那一行（【角色】區塊的第一行）；是玩家自己寫的、也已經過 redact
        out.character = p.state.角色.split("\n")[0].trim().slice(0, 80);
      } else if (url.pathname === "/api/check") {
        out = await check(env, sys, text, { bonus });
      } else {
        out = await build(env, sys, text, { cap: !!body.cap, bonus, pre: sanitizeHits(body.masked) });
      }
      return json({ ...out, systemTitle: sys.title, levels: sys.levels, locale });
    } catch (e) {
      return json({ error: String(e.message || e).slice(0, 300), code: "upstream" }, 502);   // 上游（Jev）出錯：前端只顯示「稍後再試」，不把原始訊息丟給使用者
    }
  },
};

/* 給 web/worker/test.mjs 用：純函式匯出，讓漂移閘能跟 Python 對答案。
   Worker 的進入點是上面的 default export，這幾行不影響部署。 */
export { build, rerollChars, wireOf, listsOf, fpOf, read, allocate, redact, splitSections, parseCharacter, charAliases, budgetOf, derivedOf, publicConfig, skillList, evalFormula, matchSkill, matchSkillId };
