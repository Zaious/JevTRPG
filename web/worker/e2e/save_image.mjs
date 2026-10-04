// 「存成圖片」的瀏覽器測試：真的點按鈕→看預覽→按下載、接住 JPEG、驗尺寸與大小；同一頁連存兩次。
// 要放行 Google Fonts，才驗得到字型有沒有嵌進圖裡（其餘外部請求照常擋掉）。
//   node e2e/save_image.mjs [輸出資料夾]
import { createRequire } from "node:module";
import { readFileSync, readdirSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = "http://127.0.0.1:8787";
const OUT = process.argv[2];
const SAMPLE = readFileSync(new URL("../../public/samples/resume.zh-Hant.json", import.meta.url), "utf8");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const ok = (n, c, d = "") => results.push(`${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`);
const DL = join(tmpdir(), "jevsheet-dl-" + Date.now());
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-proxy-server"] });
const errors = [];
// 下載用瀏覽器層級的事件計數：無頭 Chrome 遇到同名檔案是直接覆蓋，看資料夾多不多檔會誤判
const done = [];
const bcdp = await browser.target().createCDPSession();
await bcdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });
const names = new Map();
bcdp.on("Browser.downloadWillBegin", (e) => names.set(e.guid, e.suggestedFilename));
bcdp.on("Browser.downloadProgress", (e) => e.state === "completed" && done.push({ name: names.get(e.guid), bytes: e.receivedBytes }));
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
async function open(lang, vp = { width: 1280, height: 900 }, { touch = false } = {}) {
  const page = await browser.newPage();
  if (touch) {
    // 模擬手機：觸控＋iPhone UA；桌面 Chrome 沒有真的分享選單，所以把 canShare／share 換成記錄用的替身
    await page.emulate({ viewport: { ...vp, isMobile: true, hasTouch: true }, userAgent: IPHONE_UA });
    await page.evaluateOnNewDocument(() => {
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = async (d) => { window.__shared = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }; };
    });
  } else await page.setViewport(vp);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.endsWith("/api/config")) return r.respond({ status: 200, contentType: "application/json", body: '{"turnstileSiteKey":null,"ads":null,"posthog":null}' });
    if (r.method() === "POST") return r.respond({ status: 200, contentType: "application/json", body: SAMPLE });
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort();
    r.continue();
  });
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#preview-sheet .sheet");
  await page.click("#sample");
  await page.$eval("#go", (b) => b.click());
  await page.waitForSelector("#out .sheet:not(.sheet--loading)");
  await new Promise((r) => setTimeout(r, 1200));
  return page;
}
// JPEG：FFD8 開頭，掃到 SOF0/SOF2（FFC0/FFC2）讀高寬
const jpgSize = (buf) => {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return { sig: "?", w: 0, h: 0 };
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xc0 || m === 0xc2) return { sig: "JPEG", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { sig: "?", w: 0, h: 0 };
};
async function waitDownload(count, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (done.length > count) return done[done.length - 1].name;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// 自己做出來的卡：按「存成圖片」先出現名字表單（選填），按「產生圖片」才開始做；範例／別人分享的卡直接存（direct=true）
async function saveOnce(page, tag, keep, name = "", direct = false) {
  const count = done.length;
  await page.$eval("#saveimg", (b) => b.click());
  if (!direct) {
    await page.waitForSelector("#share-form:not([hidden])");
    const en = (await page.evaluate(() => document.documentElement.lang)) === "en";
    ok(`${tag} 按存圖→出現名字表單、按鈕是「產生圖片」、提示是圖片版`, (await page.$eval("#share-do", (e) => e.textContent)) === (en ? "Make image" : "產生圖片") && (await page.$eval("#share-hint", (e) => e.textContent)).includes(en ? "printed on the image" : "印在這張圖上"));
    await page.$eval("#share-name", (e) => { e.value = ""; });
    if (name) await page.type("#share-name", name);
    await page.click("#share-do");
  }
  const t0 = Date.now();
  await page.waitForSelector("dialog.img-dialog[open] img", { timeout: 60000 });
  const make = Date.now() - t0;
  const nat = await page.$eval("dialog.img-dialog img", (i) => new Promise((r) => (i.complete ? r([i.naturalWidth, i.naturalHeight]) : (i.onload = () => r([i.naturalWidth, i.naturalHeight])))));
  ok(`${tag} 預覽出現、圖寬 ≥ 1800（940×2 倍）`, nat[0] >= 1800, `${nat[0]}×${nat[1]}，產生 ${make} ms`);
  if (!(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)))
    ok(`${tag} 桌面：下載是主按鈕、沒有「存到相簿」`, !(await page.$("#img-share")) && (await page.$eval("#img-dl", (e) => e.classList.contains("btn-stamp"))));
  await page.click("#img-dl");                                 // 真的點擊＝真的使用者手勢
  const f = await waitDownload(count);
  ok(`${tag} 按「下載圖片」→ 拿到檔案`, !!f, f || "逾時");
  if (f) {
    const buf = readFileSync(join(DL, f));
    const s = jpgSize(buf);
    ok(`${tag} 檔案是 JPEG、與預覽同尺寸、小於 3 MB`, s.sig === "JPEG" && s.w === nat[0] && s.h === nat[1] && buf.length < 3 * 1024 * 1024, `${(buf.length / 1024).toFixed(0)} KB`);
    if (OUT && keep) { mkdirSync(OUT, { recursive: true }); copyFileSync(join(DL, f), join(OUT, keep)); }
  }
  await page.click("#img-close");
  ok(`${tag} 關掉後對話框與畫面外的複製品都清掉了`, (await page.$$("dialog.img-dialog")).length === 0 && (await page.$$(".export-host")).length === 0
     && await page.$eval("#saveimg", (b) => !b.disabled));
  return f;
}

for (const lang of ["zh-Hant", "en"]) {
  const page = await open(lang);
  ok(`${lang} 有「存成圖片」、沒有「列印」`, !!(await page.$("#saveimg")) && !(await page.$("#print")));
  const f1 = await saveOnce(page, `${lang} 第一次（不填名字）`, `saved-${lang}.jpg`);
  ok(`${lang} 沒填名字→檔名帶職業`, /^JevTRPG-.+\.jpg$/.test(f1 || ""), f1 || "");
  const f2 = await saveOnce(page, `${lang} 第二次（同一頁；填名字）`, `saved-${lang}-named.jpg`, "阿明");
  ok(`${lang} 填了名字→檔名帶名字`, f2 === "JevTRPG-阿明.jpg", f2 || "");
  const f3 = await saveOnce(page, `${lang} 第三次（名字清空）`);
  ok(`${lang} 名字清空→回到職業`, f3 === f1, f3 || "");
  ok(`${lang} 畫面上的註解沒被動到`, (await page.$$("#out .note-btn")).length === 1);
  await page.close();
}

// 手機視窗：存出來的圖仍是桌面版面
{
  const page = await open("zh-Hant", { width: 390, height: 844, deviceScaleFactor: 2 });
  await saveOnce(page, "手機寬度 390", "saved-mobile-viewport.jpg");
  await page.close();
}

// 手機（觸控＋支援分享檔案）：主按鈕是「存到相簿」＝系統分享選單（iPhone 的「儲存影像」才會進相簿）；
// 「下載」只會落成 jpg 檔，退為次要。2026-10-01 使用者回報：手機上按下載只得到一個 jpg 檔、沒進相簿。
{
  const page = await open("zh-Hant", { width: 390, height: 844, deviceScaleFactor: 2 }, { touch: true });
  ok("手機：媒體查詢判成觸控", await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
  await page.$eval("#saveimg", (b) => b.click());
  await page.waitForSelector("#share-form:not([hidden])");
  await page.type("#share-name", "阿明");
  await page.click("#share-do");
  await page.waitForSelector("dialog.img-dialog[open] img", { timeout: 60000 });
  ok("手機：主按鈕是「存到相簿」", await page.$eval("#img-share", (e) => e.classList.contains("btn-stamp") && e.textContent === "存到相簿"));
  ok("手機：下載退為次要連結（不是主按鈕）", await page.$eval("#img-dl", (e) => !e.classList.contains("btn-stamp") && e.textContent === "下載檔案"));
  ok("手機：提示說明選「儲存影像」", (await page.$eval(".img-hint", (e) => e.textContent)).includes("儲存影像"));
  const prev = await page.$eval(".img-preview", (e) => ({ w: e.getBoundingClientRect().width, cs: getComputedStyle(e).webkitTouchCallout, pe: getComputedStyle(e).pointerEvents }));
  ok("手機：預覽圖可長按（沒關掉 callout／pointer-events）", prev.cs !== "none" && prev.pe !== "none" && prev.w > 300, JSON.stringify(prev));
  await page.click("#img-share");
  await page.waitForFunction(() => window.__shared, { timeout: 5000 });
  const sh = await page.evaluate(() => window.__shared);
  ok("手機：按「存到相簿」→ 交給系統分享一個 jpeg 檔、檔名帶名字、有內容", sh.n === 1 && sh.type === "image/jpeg" && sh.name === "JevTRPG-阿明.jpg" && sh.size > 200 * 1024, JSON.stringify(sh));
  await page.close();
}

// 角色頁的 KP 審核單：也能填名字；沒有「角色」欄時會補一欄
{
  const CH = readFileSync(new URL("../../public/samples/character.zh-Hant.json", import.meta.url), "utf8");
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.endsWith("/api/config")) return r.respond({ status: 200, contentType: "application/json", body: '{"turnstileSiteKey":null,"ads":null,"posthog":null}' });
    if (r.method() === "POST") return r.respond({ status: 200, contentType: "application/json", body: CH });
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort();
    r.continue();
  });
  await page.goto(`${BASE}/character?lang=zh-Hant`, { waitUntil: "networkidle0" });
  await page.type("#text", "阿明是個圖書館員，做過很多年。");
  await page.click("#go");
  await page.waitForSelector("#out .sheet:not(.sheet--loading)");
  ok("角色頁結果：有分享鈕嗎（審核單不給分享）", !(await page.$("#share")));
  const before = await page.$$eval("#out .fld-v", (e) => e.map((x) => x.textContent));
  const f = await saveOnce(page, "角色頁 KP 審核單", "saved-kp.jpg", "林小雅");
  ok("角色頁：檔名帶名字", f === "JevTRPG-林小雅.jpg", f || "");
  ok("角色頁：畫面上的卡沒被動到（名字只進圖）", JSON.stringify(await page.$$eval("#out .fld-v", (e) => e.map((x) => x.textContent))) === JSON.stringify(before));
  await page.close();
}

// 看範例的畫面也能存
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (/googlesyndication|adtrafficquality|recaptcha|doubleclick|posthog/.test(r.url()) ? r.abort() : r.continue()));
  await page.goto(`${BASE}/?lang=zh-Hant`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#preview-sheet .sheet");
  await page.click("#preview-open");
  await page.waitForSelector("#out .sheet");
  ok("看範例的畫面也有「存成圖片」", !!(await page.$("#saveimg")));
  await saveOnce(page, "看範例（直接存、沒有名字表單）", undefined, "", true);
  ok("看範例：不出現名字表單", (await page.$("#share-form")) === null);
  await page.close();
}

await browser.close();
rmSync(DL, { recursive: true, force: true });
console.log(results.join("\n"));
console.log(errors.length ? "⚠ console 錯誤：\n" + [...new Set(errors)].join("\n") : "console 沒有錯誤");
if (results.some((r) => r.startsWith("✗")) || errors.length) process.exitCode = 1;   // 有 ✗ 或 console 錯誤就讓 npm run e2e 失敗（原本只有印出來，exit code 永遠是 0）
