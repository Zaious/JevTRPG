// 英文／日文連結的 <head>（社群預覽卡讀的就是這些）：要是該語言；繁中與沒帶 lang 的維持原樣；圖片等靜態檔不受影響。
//   node e2e/meta.mjs        （要先開著 npm run dev）
import { readFileSync } from "node:fs";
import { META, PAGE_OF } from "../../public/meta.js";
const BASE = "http://127.0.0.1:8787";
const results = [];
const ok = (n, c, d = "") => results.push(`${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`);
const get = async (path, headers = {}) => { const r = await fetch(BASE + path, { headers }); return { r, t: await r.text() }; };
const tag = (html, re) => (html.match(re) || [])[1];
const metaContent = (html, key, val) => tag(html, new RegExp(`<meta ${key}="${val}" content="([^"]*)"`));
const dec = (s) => (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// i18n.js 的 docTitle*：meta.js 的 title 必須與它一致（不讓兩份文字漂開）
const win = {};
new Function("window", readFileSync(new URL("../../public/i18n.js", import.meta.url), "utf8"))(win);
const DOC_KEY = { resume: "docTitleResume", character: "docTitleChar", privacy: "docTitlePrivacy" };

for (const lang of ["en", "ja"]) {
  for (const [path, page] of [["/", "resume"], ["/character", "character"], ["/privacy", "privacy"]]) {
    const m = META[lang][page];
    const { r, t } = await get(`${path}?lang=${lang}`);
    const tt = `${lang} ${path}`;
    ok(`${tt}：<title>`, dec(tag(t, /<title>([^<]*)<\/title>/)) === m.title);
    ok(`${tt}：description／og／twitter 都是 ${lang}`,
      dec(metaContent(t, "name", "description")) === m.desc && dec(metaContent(t, "property", "og:title")) === m.ogTitle && dec(metaContent(t, "property", "og:description")) === m.ogDesc
      && dec(metaContent(t, "name", "twitter:title")) === m.title && dec(metaContent(t, "name", "twitter:description")) === m.desc);
    ok(`${tt}：html lang、og:locale、og:url 帶 ?lang`, tag(t, /<html lang="([^"]*)"/) === lang && /og:locale/.test(t) && metaContent(t, "property", "og:url").endsWith(`${path === "/" ? "/" : path}?lang=${lang}`));
    ok(`${tt}：body 沒被動到（腳本、頁面主體都在）`, t.includes('<script src="app.js"') && t.includes('id="out"') === (page !== "privacy") || page === "privacy");
    ok(`${tt}：title 與 i18n.js 的 ${DOC_KEY[page]} 一致`, win.I18N?.[lang]?.[DOC_KEY[page]] === m.title, win.I18N?.[lang]?.[DOC_KEY[page]]);
    ok(`${tt}：Content-Type 仍是 HTML`, (r.headers.get("content-type") || "").includes("text/html"));
  }
}
for (const [path, q] of [["/", ""], ["/", "?lang=zh-Hant"], ["/", "?lang=xx"], ["/character", ""]]) {
  const { t } = await get(path + q);
  ok(`${path}${q || "（沒帶 lang）"}：維持繁中原文`, tag(t, /<html lang="([^"]*)"/) === "zh-Hant" && /[一-鿿]/.test(tag(t, /<title>([^<]*)<\/title>/)) && !/og:locale/.test(t));
}
{
  const { r } = await get("/og.png?v=3");
  ok("圖片等靜態檔不受影響", r.status === 200 && (r.headers.get("content-type") || "").includes("image/png"));
  const { r: r2 } = await get("/app.js");
  ok("app.js 不受影響", r2.status === 200 && (r2.headers.get("content-type") || "").includes("javascript"));
  const r3 = await fetch(BASE + "/?lang=en", { method: "HEAD" });
  ok("HEAD 也能用", r3.status === 200);
  ok("每個入口路徑都有英日文字（沒有漏）", Object.keys(PAGE_OF).length >= 6 && Object.values(PAGE_OF).every((p) => META.en[p] && META.ja[p]));
}
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("✗"))) process.exitCode = 1;
