// 驗證 PostHog / AdSense / Turnstile 的接線（全部用攔截請求，不需要真金鑰或廣告單元）
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = "http://127.0.0.1:8787";
const W = await import("../src/index.js");
const PACKS = (await import("../system.js")).default.coc;
const { run: runAddSkill } = await import("./wiring_addskill.mjs");
const SAMPLE = readFileSync(new URL("../../public/samples/resume.zh-Hant.json", import.meta.url), "utf8");
const OUT = process.argv[2];

const results = [];
const ok = (name, cond, detail = "") => results.push(`${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new",
  args: ["--no-proxy-server"],
});
const errors = [];
await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write"]);

async function session({ config, vp = { width: 1280, height: 900 } }) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const external = [], posts = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith(BASE)) {
      if (u.endsWith("/api/config") && config !== "real")
        return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(config) });
      if (req.method() === "POST") {
        posts.push({ url: u, body: JSON.parse(req.postData() || "{}") });
        return req.respond({ status: 200, contentType: "application/json", body: SAMPLE });
      }
      return req.continue();
    }
    if (u.startsWith("data:")) return req.continue();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return req.abort();      // 字型不是這裡要測的
    external.push(u);
    if (/posthog.*array\.js/.test(u))
      return req.respond({ status: 200, contentType: "text/javascript", body: `
        window.posthog = { __loaded: false,
          init(k, o) { window.__ph = { key: k, opts: o }; this.__loaded = true; o.loaded && o.loaded(this); },
          register(p) { window.__reg = p; },
          capture(n, p) { (window.__ev = window.__ev || []).push([n, p]); } };` });
    if (/adsbygoogle\.js/.test(u))
      return req.respond({ status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: "window.__adScript = true;" });
    if (/turnstile\/v0\/api\.js/.test(u))
      return req.respond({ status: 200, contentType: "text/javascript", body: `
        window.turnstile = { render(sel, o) { window.__ts = { sel, o }; setTimeout(() => o.callback("tok-123"), 30); return "w1"; },
          reset(id) { window.__tsReset = (window.__tsReset || 0) + 1; } };
        setTimeout(() => window.onTurnstileLoad && window.onTurnstileLoad(), 0);` });
    return req.abort();
  });
  return { page, external, posts };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─ A. 本機真實設定（讀 /api/config 回來的樣子，不寫死任何人的 ID）─────────────
//   公開倉的預設設定全是空的＝什麼第三方都不載；部署用的設定（有 AdSense 單元等）在私有倉。
//   這一段檢查的是「設定了什麼，頁面就照做；沒設定就整套不啟動」。
{
  const cfg = await (await fetch(BASE + "/api/config")).json();
  const { page, external } = await session({ config: "real" });
  await page.goto(BASE + "/?lang=zh-Hant", { waitUntil: "networkidle0" });
  await page.waitForSelector("#preview-sheet .sheet");
  await wait(300);
  ok("A 本機設定：AdSense script 與設定一致（有發布者 ID 才載）", external.some((u) => u.includes("adsbygoogle.js")) === !!cfg.ads?.client,
     cfg.ads ? "有設定" : "沒設定＝不載");
  ok("A 本機設定：PostHog 與設定一致（沒設 key＝不追蹤）", external.some((u) => /posthog/.test(u)) === !!cfg.posthog);
  ok("A 本機設定：Turnstile 與設定一致", external.some((u) => /turnstile/.test(u)) === !!cfg.turnstileSiteKey);
  if (cfg.ads?.slots?.footer)
    ok("A 設定了頁尾廣告單元 → 頁面用的就是那個 ID", await page.$eval("#ad-footer .adbox.wide ins", (e, s) => e.dataset.adSlot === s, cfg.ads.slots.footer));
  else
    ok("A 沒設頁尾廣告單元 → 頁面上沒有廣告框", (await page.$$("#ad-footer .adbox")).length === 0);
  ok("A 結果出現前沒有結果卡下方的廣告", (await page.$$("#ad-results .adbox")).length === 0);
  await page.click("#preview-open"); await page.waitForSelector("#out .sheet");
  if (cfg.ads?.slots?.results)
    ok("A 設定了結果卡下方的廣告單元 → 結果出現後用那個 ID", await page.$eval("#ad-results .adbox.rect ins", (e, s) => e.dataset.adSlot === s, cfg.ads.slots.results));
  else
    ok("A 沒設結果卡廣告單元 → 結果出現後仍然沒有廣告框", (await page.$$("#ad-results .adbox")).length === 0);
  await page.close();
}

// ─ B. 全開設定（攔截）────────────────────────────────────────────────────
const FULL = { turnstileSiteKey: "0xTESTKEY", ads: { client: "ca-pub-TEST", slots: { results: "111", footer: "222" } },
  posthog: { key: "phc_TEST", host: "https://us.i.posthog.com" } };
{
  const { page, external, posts } = await session({ config: FULL });
  await page.goto(BASE + "/?lang=zh-Hant", { waitUntil: "networkidle0" });
  await page.waitForSelector("#preview-sheet .sheet");
  await wait(400);
  const ph = await page.evaluate(() => window.__ph);
  ok("B PostHog 用 assets 網域載入", external.some((u) => u.startsWith("https://us-assets.i.posthog.com/static/array.js")));
  ok("B PostHog key 與 host", ph?.key === "phc_TEST" && ph.opts.api_host === "https://us.i.posthog.com");
  ok("B PostHog 不用 Cookie（記憶體儲存）", ph?.opts.persistence === "memory");
  ok("B PostHog 不自動抓取、不錄影", ph?.opts.autocapture === false && ph.opts.disable_session_recording === true);
  ok("B PostHog 每個事件帶 site=jevsheet", (await page.evaluate(() => window.__reg))?.site === "jevsheet");
  ok("B 頁尾廣告：單元 ID 正確", await page.$eval("#ad-footer .adbox.wide ins", (e) => e.dataset.adSlot === "222" && e.dataset.adClient === "ca-pub-TEST"));
  ok("B 結果前沒有結果卡下方的廣告", (await page.$$("#ad-results .adbox")).length === 0);
  ok("B Turnstile 載入並渲染到 #turnstile-slot", await page.evaluate(() => window.__ts?.sel === "#turnstile-slot" && window.__ts.o.sitekey === "0xTESTKEY"));

  await page.evaluate(() => window.__ts.o["error-callback"]("110200"));
  ok("B Turnstile 失敗 → turnstile_error 事件帶錯誤碼", (await page.evaluate(() => window.__ev)).some((e) => e[0] === "turnstile_error" && e[1].code === "110200"));
  await page.evaluate(() => window.__ts.o.callback("tok-123"));   // 錯誤會清掉 token（正確行為），測試要重新給一次才能接著測送出
  // 縮圖 → sample_open；結果出現 → 結果廣告只放一次
  await page.click("#preview-open"); await page.waitForSelector("#out .sheet");
  await wait(1200);   // 等「看範例」的平滑捲動停下來：頁面還在動時按鈕座標會變，點擊會落空
  ok("B 打開範例後放結果廣告", await page.$eval("#ad-results .adbox.rect ins", (e) => e.dataset.adSlot === "111"));
  // 送出：token 要跟著請求走；事件不得夾帶貼的文字
  const SECRET_TEXT = "SECRETMARK-我的履歷內文-abc123";
  await page.$eval("#text", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, SECRET_TEXT);
  await page.$eval("#go", (b) => b.click()); await page.waitForFunction(() => window.__ev?.some((e) => e[0] === "sheet_generated"));
  await wait(300);
  // ── 「!」按鈕與分享 ──
  const nBtn = await page.$("#out .note-btn");
  ok("B 有「!」按鈕，註解預設收起", !!nBtn && (await page.$eval("#out .note-btn", (e) => e.getAttribute("aria-expanded"))) === "false"
     && await page.$eval("#out .notes", (e) => getComputedStyle(e).display === "none"));
  const nNotes = await page.$$eval("#out .notes li", (e) => e.length);
  ok("B 按鈕的說明寫出項數", (await page.$eval("#out .note-btn", (e) => e.title)).includes(String(nNotes)), `${nNotes} 項`);
  await page.click("#out .note-btn");
  ok("B 點「!」展開註解", await page.$eval("#out .notes", (e) => getComputedStyle(e).display !== "none") && (await page.$eval("#out .note-btn", (e) => e.getAttribute("aria-expanded"))) === "true");
  await page.click("#out .note-btn");
  ok("B 再點一次收起", await page.$eval("#out .notes", (e) => getComputedStyle(e).display === "none"));
  ok("B 技能列沒有紅圈、只有右上角註號", (await page.$$("#out .sk .ring")).length === 0 && (await page.$$("#out .sk sup.nref")).length > 0);
  await page.click("#out sup.nref");
  ok("B 點右上角註號也會展開", await page.$eval("#out .notes", (e) => getComputedStyle(e).display !== "none"));
  const raised = await page.$$eval("#out .sk--up", (e) => e.length);
  const ticked = await page.$$eval("#out .sk-dot.on", (e) => e.length);

  ok("B 分享表單預設收起", await page.$eval("#share-form", (e) => e.hidden));
  await page.click("#share");
  ok("B 按「分享這張卡」展開名字欄", !(await page.$eval("#share-form", (e) => e.hidden)));
  await page.type("#share-name", "林小雅");
  await page.click("#share-do");
  // 產生連結現在是非同步（要等編碼表）：等按鈕字變了再讀，不靠固定的等待時間
  await page.waitForFunction(() => !["分享這張卡", "複製連結", "產生連結"].includes(document.getElementById("share-do").textContent), { timeout: 10000 }).catch(() => {});
  await page.bringToFront();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  const viaClipboard = clip.startsWith("http");
  const link = viaClipboard ? clip : page.url();       // 無頭瀏覽器的剪貼簿權限不一定給；App 的備援是把連結寫進網址列
  ok("B 複製後拿得到帶卡片的連結", link.includes("#c="), viaClipboard ? "走剪貼簿" : "剪貼簿被拒 → 走網址列備援（按鈕字：" + (await page.$eval("#share-do", (e) => e.textContent)) + "）");
  const evs = await page.evaluate(() => window.__ev);
  const sc = evs.find((e) => e[0] === "share_copy");
  ok("B share_copy 事件只記有沒有填名字、不含名字", sc && sc[1].named === true && !JSON.stringify(evs).includes("林小雅"), JSON.stringify(sc && sc[1]));
  // 開分享連結：名字在卡上、整張卡、沒有註解
  console.log("link=", link.slice(0, 70), "| 按鈕字:", await page.$eval("#share-do", (e) => e.textContent), "| 網址列:", page.url().slice(0, 80));
  const shared = await session({ config: FULL });
  await shared.page.goto(link, { waitUntil: "networkidle0" });
  await shared.page.waitForSelector("#out .sheet");
  const info = await shared.page.evaluate(() => ({
    name: document.querySelector("#out .fld-v")?.textContent, skills: document.querySelectorAll("#out .sk").length, ticked: document.querySelectorAll("#out .sk-dot.on").length,
    notes: document.querySelectorAll("#out .notes, #out .note-btn, #out .ring, #out sup").length,
    stamp: document.querySelector("#out .stamp")?.textContent }));
  ok("B 分享版：名字印在卡上", info.name === "林小雅", JSON.stringify(info));
  ok("B 分享版：跟原卡同一批技能、同樣的打叉", info.skills === raised && info.ticked === ticked, `分享版 ${info.skills} 項／打叉 ${info.ticked}；原卡 ${raised} 項／打叉 ${ticked}`);
  ok("B 分享版：沒有註解、註號、「!」", info.notes === 0);
  await shared.page.close();
  // 不填名字 → 卡上沒有角色欄
  await page.$eval("#share-name", (e) => { e.value = ""; });
  await page.click("#share-do"); await wait(200);
  await page.bringToFront();
  const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  const link2 = clip2.startsWith("http") ? clip2 : page.url();
  const s2 = await session({ config: FULL });
  await s2.page.goto(link2, { waitUntil: "networkidle0" });
  await s2.page.waitForSelector("#out .sheet");
  ok("B 不填名字 → 分享版沒有角色欄", (await s2.page.$$eval("#out .fld", (e) => e.map((x) => x.textContent).join("|"))).includes("角色") === false);
  await s2.page.close();

  ok("B 請求帶 Turnstile token", posts.at(-1)?.body.turnstile === "tok-123", `body.turnstile=${posts.at(-1)?.body.turnstile}`);
  ok("B 送出後 Turnstile reset", (await page.evaluate(() => window.__tsReset)) >= 1);
  ok("B 結果卡下方的廣告仍只有一個", (await page.$$("#ad-results .adbox")).length === 1);
  await page.click('button.lang[data-lang="en"]'); await wait(200);
  const ev = await page.evaluate(() => window.__ev);
  const names = ev.map((e) => e[0]);
  ok("B 事件：sample_open / sheet_generated / lang_switch", ["sample_open", "sheet_generated", "lang_switch"].every((n) => names.includes(n)), names.join(","));
  const gen = ev.find((e) => e[0] === "sheet_generated")[1];
  ok("B sheet_generated 欄位", gen.page === "resume" && gen.lang === "zh-Hant" && gen.mode === "build", JSON.stringify(gen));
  ok("B 事件與 PostHog 設定裡沒有使用者貼的文字", !JSON.stringify([ev, ph]).includes("SECRETMARK"));
  // AdSense 填不滿 → 整塊收掉
  await page.$eval("#ad-footer ins", (e) => e.setAttribute("data-ad-status", "unfilled"));
  ok("B 廣告沒填滿 → 廣告框收起來", await page.$eval("#ad-footer .adbox", (e) => getComputedStyle(e).display === "none"));
  if (OUT) await (await page.$("footer.foot")).screenshot({ path: OUT + "/9-footer-en.png" });
  await page.close();
}

// ─ C. 隱私頁：不放廣告、不驗證，但有 PostHog 瀏覽統計；三語都要畫得出來 ────
{
  const { page, external } = await session({ config: FULL });
  await page.goto(BASE + "/privacy?lang=zh-Hant", { waitUntil: "networkidle0" });
  await wait(300);
  ok("C 隱私頁：九個小節", (await page.$$eval("#pv-body h2", (e) => e.length)) === 10);
  ok("C 隱私頁：不載廣告 script、不載 Turnstile", !external.some((u) => /adsbygoogle|turnstile/.test(u)));
  ok("C 隱私頁：有 PostHog 瀏覽統計", external.some((u) => /posthog/.test(u)));
  for (const [lang, h1] of [["ja", "運営者情報とプライバシー"], ["en", "About and privacy"]]) {
    await page.click(`button.lang[data-lang="${lang}"]`); await wait(150);
    const got = await page.$eval("h1", (e) => e.textContent);
    const secs = await page.$$eval("#pv-body h2", (e) => e.length);
    const mail = await page.$eval("#pv-body", (e) => e.textContent.includes("jevtrpg@chroniclecore.com"));
    ok(`C 隱私頁 ${lang}：標題、十節、信箱`, got === h1 && secs === 10 && mail, got);
  }
  ok("C 頁尾連回隱私頁、工作室連結", await page.$eval("footer", (f) => !!f.querySelector('a[href="privacy"]') && !!f.querySelector('a[href="https://studio.chroniclecore.com"]')));
  if (OUT) await page.screenshot({ path: OUT + "/10-privacy-en.png", fullPage: true });
  await page.close();
}

await runAddSkill({ session, FULL, BASE, ok, W, PACKS });

await browser.close();
console.log(results.join("\n"));
console.log(errors.length ? "⚠ console 錯誤：\n" + errors.join("\n") : "console 沒有錯誤");
if (results.some((r) => r.startsWith("✗")) || errors.length) process.exitCode = 1;   // 有 ✗ 或 console 錯誤就讓 npm run e2e 失敗（原本只有印出來，exit code 永遠是 0）
