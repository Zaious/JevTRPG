// 該報錯的都有報錯：每一種失敗，使用者都看得到一句「他的語言、知道怎麼辦」的話，而且不是原始技術訊息。
//   node e2e/errors.mjs        （要先開著 npm run dev）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = "http://127.0.0.1:8787";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const results = [];
const ok = (n, c, d = "") => results.push(`${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`);
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-proxy-server"] });
const TEXT = "在圖書館做過三年館員，負責採購、分類與讀者服務，也帶過兩位工讀生。";
const RAW = "jev 500: {\"detail\":\"upstream exploded internal-secret-trace\"}";

/** mode：該次 POST 要怎麼回；ts：Turnstile 的行為 */
async function open({ lang = "zh-Hant", path = "/", post = null, ts = null, abortSamples = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const posts = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.endsWith("/api/config"))
      return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ turnstileSiteKey: ts ? "0xTEST" : null, ads: null, posthog: { key: "phc_test", host: "https://us.i.posthog.com" } }) });
    if (/posthog.*array\.js/.test(u))
      return r.respond({ status: 200, contentType: "text/javascript", body: `window.posthog = { __loaded: false, init(k, o) { this.__loaded = true; o.loaded && o.loaded(this); }, register() {}, capture(n, p) { (window.__ev = window.__ev || []).push([n, p]); } };` });
    if (/turnstile\/v0\/api\.js/.test(u)) {
      if (ts === "load-fails") return r.abort();
      return r.respond({ status: 200, contentType: "text/javascript", body: `
        window.turnstile = { render(sel, o) { window.__ts = o; ${ts === "error" ? `setTimeout(() => o["error-callback"]("300010"), 30);` : `setTimeout(() => o.callback("tok"), 30);`} return "w"; }, reset() {} };
        setTimeout(() => window.onTurnstileLoad && window.onTurnstileLoad(), 0);` });
    }
    if (u.startsWith(BASE) && r.method() === "POST") {
      posts.push(u);
      if (post === "network") return r.abort();
      if (post) return r.respond({ status: post.status, contentType: post.type || "application/json", body: post.body });
    }
    if (abortSamples && u.includes("/samples/")) return r.abort();
    if (u.startsWith(BASE) || u.startsWith("data:")) return r.continue();
    return r.abort();
  });
  await page.goto(`${BASE}${path}?lang=${lang}`, { waitUntil: "networkidle0" });
  return { page, posts };
}
const generate = async (page, text = TEXT) => { await page.type("#text", text); await page.click("#go"); };
const outText = (page) => page.$eval("#out", (e) => e.textContent);
const waitErr = (page) => page.waitForSelector("#out .err", { timeout: 15000 });
const noTech = (s) => !/jev 500|upstream exploded|internal-secret|Unexpected token|Failed to fetch|HTTP \d{3}|undefined|\[object/.test(s);

/* ── 1. 伺服器端各種失敗 ─────────────────────────────────────── */
const CASES = [
  ["429 當日全站額度滿", { status: 429, body: JSON.stringify({ error: "用量已達上限", code: "quota", scope: "day", tier: "ok" }) }, "今天的使用量已經滿了", "明天"],
  ["429 每小時額度（驗證通過）", { status: 429, body: JSON.stringify({ error: "用量已達上限", code: "quota", scope: "hour", tier: "ok" }) }, "這個小時用的次數太多", ""],
  ["429 每小時額度（驗證沒通過，額度較小）", { status: 429, body: JSON.stringify({ error: "用量已達上限", code: "quota", scope: "hour", tier: "weak" }) }, "人機驗證沒通過的話", "讓驗證通過"],
  ["429 額度服務忙碌", { status: 429, body: JSON.stringify({ error: "用量已達上限", code: "quota", scope: "busy", tier: "weak" }) }, "現在比較忙", ""],
  ["502 上游（Jev）出錯，帶一大串技術訊息", { status: 502, body: JSON.stringify({ error: RAW, code: "upstream" }) }, "判讀服務現在沒有回應", "沒有被存下來"],
  ["502 邊緣節點的 HTML 錯誤頁（不是 JSON）", { status: 502, type: "text/html", body: "<html><body>Bad gateway</body></html>" }, "判讀服務現在沒有回應", ""],
  ["429 沒有 code（邊緣節點的限流）", { status: 429, body: "{}" }, "太多", ""],
  ["500 沒有 code 的未知錯誤", { status: 500, body: JSON.stringify({ error: "boom" }) }, "判讀服務現在沒有回應", ""],
  ["418 其他狀態", { status: 418, body: "{}" }, "出了點問題", "jevtrpg@"],
  ["網路連不上", "network", "連不上伺服器", ""],
];
for (const [name, post, must1, must2] of CASES) {
  const { page } = await open({ post });
  await generate(page);
  await waitErr(page);
  const t = await outText(page);
  ok(`${name} → 說得出人話、沒有技術訊息`, t.includes(must1) && (!must2 || t.includes(must2)) && noTech(t), t.slice(0, 60));
  ok(`${name} → 按鈕恢復可再按`, await page.$eval("#go", (b) => !b.disabled));
  await page.close();
}
// 同一個失敗，英文與日文也是他的語言
for (const [lang, want] of [["en", "judging service isn't responding"], ["ja", "判定サービスが今は応答していません"]]) {
  const { page } = await open({ lang, post: { status: 502, body: JSON.stringify({ error: RAW, code: "upstream" }) } });
  await generate(page, "I worked three years as a librarian handling acquisitions, cataloguing and reader services.");
  await waitErr(page);
  const t = await outText(page);
  ok(`${lang}：上游出錯 → 用 ${lang} 說`, t.includes(want) && noTech(t), t.slice(0, 70));
  await page.close();
}
// 太長（伺服器擋下的）
{
  const { page } = await open({ post: { status: 413, body: JSON.stringify({ error: "太長了", code: "too_long" }) } });
  await generate(page);
  await waitErr(page);
  ok("413 太長 → 顯示上限", (await outText(page)).includes("12,000") || (await outText(page)).includes("12000"), (await outText(page)).slice(0, 50));
  await page.close();
}
// 角色頁同一條路
{
  const { page } = await open({ path: "/character", post: { status: 502, body: JSON.stringify({ error: RAW, code: "upstream" }) } });
  await generate(page, "阿明是個圖書館員，做過很多年。");
  await waitErr(page);
  ok("角色頁：上游出錯 → 同樣說人話", (await outText(page)).includes("判讀服務現在沒有回應") && noTech(await outText(page)));
  await page.close();
}
// 事件只記狀態碼與代碼，不記原因文字
{
  const { page } = await open({ post: { status: 502, body: JSON.stringify({ error: RAW, code: "upstream" }) } });
  await generate(page);
  await waitErr(page);
  const ev = (await page.evaluate(() => window.__ev)).find((e) => e[0] === "sheet_failed");
  ok("sheet_failed 事件帶 status 與 code、沒有原始訊息與使用者文字", ev && ev[1].status === 502 && ev[1].code === "upstream" && !JSON.stringify(ev).includes("exploded") && !JSON.stringify(ev).includes("圖書館"), JSON.stringify(ev && ev[1]));
  await page.close();
}

/* ── 2. 人機驗證元件壞了：立刻說明、但不擋人（請求照送，伺服器走小額度）──────── */
{
  const { page, posts } = await open({ ts: "error", post: { status: 429, body: JSON.stringify({ error: "用量已達上限", code: "quota", scope: "hour", tier: "weak" }) } });
  await page.waitForFunction(() => !document.getElementById("ts-msg").hidden, { timeout: 5000 });
  const note = await page.$eval("#ts-msg", (e) => e.textContent);
  ok("驗證出錯 → 一出錯就在按鈕附近說明（錯誤碼、仍可使用但次數較少、怎麼恢復）", note.includes("300010") && note.includes("還是可以使用") && note.includes("次數比較少") && note.includes("廣告攔截") && note.includes("jevtrpg@"), note.slice(0, 80));
  const t0 = Date.now();
  await generate(page);
  await waitErr(page);
  const dt = Date.now() - t0;
  ok("驗證出錯 → 請求照樣送出（不再被擋在前端）", posts.length === 1, `${posts.length} 次 POST`);
  ok("驗證出錯 → 按產生後約 2 秒（寬限）就送、不空等 10 秒", dt < 5000, `${dt} ms`);
  const t = await outText(page);
  ok("驗證出錯 → 小額度用完時，說明是因為驗證沒過、怎麼恢復", t.includes("人機驗證沒通過的話") && noTech(t), t.slice(0, 60));
  const ev = (await page.evaluate(() => window.__ev)).find((e) => e[0] === "sheet_failed");
  ok("事件記 status 429 與 code quota", ev && ev[1].status === 429 && ev[1].code === "quota", JSON.stringify(ev && ev[1]));
  await page.close();
}
{
  // 驗證出錯、但伺服器放行（小額度內）→ 正常出卡
  const SAMPLE = (await import("node:fs")).readFileSync(new URL("../../public/samples/resume.zh-Hant.json", import.meta.url), "utf8");
  const { page, posts } = await open({ ts: "error", post: { status: 200, body: SAMPLE } });
  await page.waitForFunction(() => !document.getElementById("ts-msg").hidden, { timeout: 5000 });
  await generate(page);
  await page.waitForSelector("#out .sheet:not(.sheet--loading)", { timeout: 15000 });
  ok("驗證出錯但在小額度內 → 照常產出角色卡", posts.length === 1 && !!(await page.$("#out .sheet")) && !(await page.$("#out .err")));
  await page.close();
}
{
  const { page, posts } = await open({ ts: "load-fails", post: { status: 429, body: JSON.stringify({ error: "x", code: "quota", scope: "day", tier: "weak" }) } });
  await page.waitForFunction(() => !document.getElementById("ts-msg").hidden, { timeout: 5000 });
  ok("驗證腳本載不進來（被廣告攔截）→ 立刻說明、錯誤碼 load", (await page.$eval("#ts-msg", (e) => e.textContent)).includes("load"));
  await generate(page);
  await waitErr(page);
  ok("驗證腳本載不進來 → 一樣照送，由伺服器決定額度", posts.length === 1 && (await outText(page)).includes("今天的使用量已經滿了"));
  await page.close();
}
{
  const { page } = await open({ ts: "error", lang: "en" });
  await page.waitForFunction(() => !document.getElementById("ts-msg").hidden, { timeout: 5000 });
  const n = await page.$eval("#ts-msg", (e) => e.textContent);
  ok("英文：驗證出錯的說明是英文（仍可使用、次數較少）", n.includes("human check didn't pass") && n.includes("fewer tries"));
  await page.close();
}
{
  const { page } = await open({ ts: "ok", post: { status: 502, body: JSON.stringify({ error: RAW, code: "upstream" }) } });
  await new Promise((r) => setTimeout(r, 500));
  ok("驗證正常 → 不出現說明", await page.$eval("#ts-msg", (e) => e.hidden));
  await page.close();
}
{
  for (const [lang, want] of [["en", "usage limit has been reached"], ["ja", "本日の利用上限に達しました"]]) {
    const { page } = await open({ lang, post: { status: 429, body: JSON.stringify({ error: "x", code: "quota", scope: "day", tier: "ok" }) } });
    await generate(page, "I worked three years as a librarian handling acquisitions and reader services.");
    await waitErr(page);
    ok(`${lang}：額度滿 → 用 ${lang} 說`, (await outText(page)).includes(want), (await outText(page)).slice(0, 60));
    await page.close();
  }
}

/* ── 3. 範例檔載不到：不能按了沒反應 ─────────────────────────── */
{
  const { page } = await open({ abortSamples: true });
  await page.waitForSelector("#preview-open").catch(() => {});
  await page.$eval("#preview-open", (e) => e.click());
  await waitErr(page);
  ok("範例檔載不到 → 顯示連不上，不是沒反應", (await outText(page)).includes("連不上伺服器"));
  await page.close();
}

await browser.close();
console.log(results.join("\n"));
console.log(errors.length ? "⚠ console 錯誤：\n" + [...new Set(errors)].join("\n") : "console 沒有錯誤");
if (results.some((r) => r.startsWith("✗")) || errors.length) process.exitCode = 1;
