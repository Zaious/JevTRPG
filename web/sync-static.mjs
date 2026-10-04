/**
 * 把「繁中正本」同步進靜態 HTML，並檢查兩份聲明文字沒有漂。
 *
 * 為什麼要有這支：頁面文字的單一來源是 public/i18n.js，但 HTML 裡也寫了一份繁中
 * （SEO 與爬蟲不執行 JS 時看得到）。隱私頁整篇內文尤其重要——AdSense 會看它，
 * 手抄兩份遲早不同步（ccweb-footer：聲明文字定義一次，其他地方引用）。
 *
 *   node web/sync-static.mjs            # 重寫 privacy.html 的內文區塊
 *   node web/sync-static.mjs --check    # 只檢查，不一致 exit 1（test.mjs 也會呼叫）
 *
 * 檢查兩件事：
 *   1. privacy.html 標記區間 = 由 i18n zh-Hant 算出來的內文
 *   2. 所有頁面裡 data-i18n="key" 的靜態文字 = i18n zh-Hant[key]（頁尾、標題等）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "public");
const PAGES = ["index.html", "character.html", "privacy.html"];

export function loadI18n() {
  const win = {};
  vm.runInNewContext(readFileSync(join(PUB, "i18n.js"), "utf8"), { window: win });
  return { I18N: win.I18N, SITE: win.SITE };
}

/** 跟 app.js 的 T() 同一套規則，只做繁中 */
function makeT({ I18N, SITE }) {
  const T = (key) => {
    const s = I18N["zh-Hant"][key];
    if (s == null) throw new Error(`i18n 缺 zh-Hant.${key}`);
    return s.replace(/\{(mail|studio|support|adsSettings|partnerSites)\}/g, (_, k) =>
      k === "mail" ? SITE.contact : k === "studio" ? SITE.studioUrl
        : k === "support" ? SITE.support : T(k));
  };
  return T;
}

const SECTIONS = [["pvAboutH", "pvAbout"], ["pvFreeH", "pvFree"], ["pvTextH", "pvText"],
  ["pvShareH", "pvShare"], ["pvBotH", "pvBot"], ["pvAdsH", "pvAds"], ["pvAnalyticsH", "pvAnalytics"], ["pvSupportH", "pvSupport"],
  ["pvHostH", "pvHost"], ["pvJudgeH", "pvJudge"]];
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// app.js 的 renderPrivacy 是同一個形狀；改一邊要改另一邊（本檔的 --check 只保護靜態那份）
export function privacyBody(data) {
  const T = makeT(data);
  return SECTIONS.map(([h, b]) => {
    const body = T(b);
    return `<h2>${esc(T(h))}</h2>${body.startsWith("<ul>") ? body : `<p>${body}</p>`}`;
  }).join("");
}

const START = "<!-- pv:start (由 web/sync-static.mjs 產生，別手改) -->";
const END = "<!-- pv:end -->";
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export function check(data = loadI18n()) {
  const problems = [];
  const T = makeT(data);
  const pv = readFileSync(join(PUB, "privacy.html"), "utf8");
  const a = pv.indexOf(START), b = pv.indexOf(END);
  if (a < 0 || b < 0) problems.push("privacy.html 找不到 pv:start / pv:end 標記");
  else if (pv.slice(a + START.length, b).trim() !== privacyBody(data))
    problems.push("privacy.html 內文與 i18n.js 的繁中不一致（跑 node web/sync-static.mjs）");

  for (const f of PAGES) {
    const html = readFileSync(join(PUB, f), "utf8");
    for (const m of html.matchAll(/data-i18n="(\w+)"[^>]*>([^<]*)</g)) {
      const want = T(m[1]);
      if (decode(m[2]).trim() !== want.trim()) problems.push(`${f}: data-i18n="${m[1]}" 靜態文字與 i18n.js 不同`);
    }
    // 聲明裡的站台常數只在 SITE 定義一處，HTML 裡出現的必須是同一個值
    {
      for (const m of html.matchAll(/[\w.+-]+@chroniclecore\.com/g))
        if (m[0] !== data.SITE.contact) problems.push(`${f}: 信箱 ${m[0]} ≠ SITE.contact`);
      for (const m of html.matchAll(/https:\/\/portaly\.cc\/[\w\/.-]+/g))
        if (m[0] !== data.SITE.support) problems.push(`${f}: 贊助網址 ${m[0]} ≠ SITE.support`);
      for (const m of html.matchAll(/https:\/\/studio\.[\w.]+/g))
        if (m[0] !== data.SITE.studioUrl) problems.push(`${f}: 工作室網址 ${m[0]} ≠ SITE.studioUrl`);
    }
  }
  return problems;
}

if (process.argv[1] && process.argv[1].endsWith("sync-static.mjs")) {
  const data = loadI18n();
  if (process.argv.includes("--check")) {
    const p = check(data);
    if (p.length) { console.error(p.map((x) => "✗ " + x).join("\n")); process.exit(1); }
    console.log("✓ 靜態繁中與 i18n.js 一致");
  } else {
    const path = join(PUB, "privacy.html");
    let pv = readFileSync(path, "utf8");
    const a = pv.indexOf('<div id="pv-body">');
    if (a < 0) throw new Error("privacy.html 沒有 #pv-body");
    const endTag = "</div>";
    const rest = pv.indexOf(endTag, pv.indexOf(END) >= 0 ? pv.indexOf(END) : a) + endTag.length;
    const block = `<div id="pv-body">\n${START}\n${privacyBody(data)}\n${END}\n</div>`;
    pv = pv.slice(0, a) + block + pv.slice(rest);
    writeFileSync(path, pv);
    console.log("✓ privacy.html 內文已同步");
  }
}
