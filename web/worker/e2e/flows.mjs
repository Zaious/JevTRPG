// 功能走一遍：縮圖→完整範例、切語言、分享連結、角色頁縮圖、減少動態偏好
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = "http://127.0.0.1:8787";
const OUT = process.argv[2];

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new",
  args: ["--no-proxy-server"],
});
const results = [];
const ok = (name, cond, detail = "") => results.push(`${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
const errors = [];
async function open(path, vp = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on("pageerror", (e) => errors.push(`${path}: ${e}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${path}: ${m.text()}`));   // 被我們擋掉的廣告請求會印這句
  // 真的 AdSense／PostHog 會一直補開 iframe 與請求，networkidle0 有時等不到（環境因素、與程式無關）；這裡不測它們，擋掉
  await page.setRequestInterception(true);
  page.on("request", (r) => (/googlesyndication|adtrafficquality|recaptcha|doubleclick|posthog/.test(r.url()) ? r.abort() : r.continue()));
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await page.waitForSelector("#preview-sheet .sheet");
  return page;
}

// 1. 縮圖點下去 → 完整範例出現在 #out
let p = await open("/?lang=zh-Hant");
await p.click("#preview-open");
await p.waitForSelector("#out .sheet");
ok("縮圖→完整範例", await p.$eval("#out .sheet-note", (e) => e.textContent.includes("範例")));
ok("範例的戳記是真的判讀結果", await p.$eval("#out .stamp", (e) => e.textContent) === "已判讀");
// 有沒有廣告單元看 /api/config（公開倉庫的預設設定沒有廣告；正式部署有）：設了就該有一個，沒設就不該有
const cfgAds = (await (await fetch(BASE + "/api/config")).json()).ads;
ok("打開範例後結果卡下方的廣告單元與設定一致", (await p.$$("#ad-results .adbox ins")).length === (cfgAds?.slots?.results ? 1 : 0));

// 2. 切到英文 → 縮圖與正在看的範例都換成英文
await p.click('button.lang[data-lang="en"]');
await p.waitForFunction(() => document.querySelector("#preview-sheet .sh-kind")?.textContent === "Investigator Dossier");
ok("切英文：縮圖換語言", true);
await p.waitForFunction(() => document.querySelector("#out .sh-kind")?.textContent === "Investigator Dossier");
ok("切英文：範例換語言", true);
ok("切英文：網址帶 lang", p.url().includes("lang=en"));
ok("切英文：<html lang>", await p.evaluate(() => document.documentElement.lang) === "en");
ok("切英文：頁面標題", (await p.title()).startsWith("Turn your résumé"));

// 3. 分享連結：用範例編一條，重新開頁應畫出「副本」
const hash = await p.evaluate(async () => makeHash(await getSample(), "阿明"));
ok("分享連結夠短", hash.length < 200, `${hash.length} 字元（含 #c=）`);
await p.close();
p = await open("/?lang=zh-Hant" + hash);
await p.waitForSelector("#out .sheet");
ok("分享連結：名字在卡上", await p.$eval("#out .fld-v", (e) => e.textContent) === "阿明");
ok("分享連結：技能名稱用連結裡記的語言（英文卡）", await p.$$eval("#out .sk-name", (els) => els.some((e) => /^[A-Za-z]/.test(e.textContent))));
// 已經發出去的舊連結（擴充職業表之前做的）：在瀏覽器裡照樣讀得出來
{
  const LEG = JSON.parse(readFileSync(new URL("../legacy-links.fixture.json", import.meta.url), "utf8"));
  for (const l of LEG.links.filter((x) => x.name)) {
    const q = await open("/?lang=zh-Hant#c=" + l.link);
    await q.waitForSelector("#out .sheet, #out .err");
    ok(`舊連結（${l.loc}）在瀏覽器裡讀得出來、名字在、有技能`, (await q.$("#out .err")) === null && (await q.$eval("#out .fld-v", (e) => e.textContent)) === l.name && (await q.$$("#out .sk")).length > 5);
    await q.close();
  }
}
// 壞連結：截掉一段、亂寫、舊格式——都要有一句人話，不是空白也不是丟例外
for (const [name, bad] of [["截斷", hash.slice(0, -4)], ["亂寫", "#c=!!!"], ["舊格式（JSON→base64）", "#c=eyJuIjoiYSJ9"]]) {
  const q = await open("/?lang=zh-Hant" + bad);
  await q.waitForSelector("#out .err");
  ok(`壞連結（${name}）→ 顯示讀不出來`, (await q.$eval("#out .err", (e) => e.textContent)).includes("讀不出來"));
  await q.close();
}
ok("分享連結畫出副本", await p.$eval("#out .stamp", (e) => e.textContent) === "副本");
ok("分享連結有技能", await p.$$eval("#out .sk", (els) => els.length) > 5,
   `${await p.$$eval("#out .sk", (els) => els.length)} 項`);
ok("分享連結有 HP/MP/SAN", await p.$$eval("#out .dbox", (els) => els.length) === 3);
const srcs = await p.$$eval("#out .cbox-src", (els) => els.map((e) => e.textContent));
ok("分享連結的特性值來源", srcs.filter((s) => s === "擲骰").length === 8 && srcs.includes("Jev 判讀"), srcs.join(","));
if (OUT) await (await p.$("#out .result")).screenshot({ path: OUT + "/8-shared.png" });
await p.close();

// 4. 角色頁日文：縮圖是 KP 審查票
p = await open("/character?lang=ja");
ok("角色頁日文縮圖是審查票", await p.$eval("#preview-sheet .sh-kind", (e) => e.textContent) === "KP 審査票");
ok("角色頁日文縮圖有角色名", await p.$eval("#preview-sheet .fld-v", (e) => e.textContent.includes("林書涵")));
await p.close();

// 5. 減少動態：卡不加進場動畫
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.goto(BASE + "/?lang=zh-Hant", { waitUntil: "networkidle0" });
await page.waitForSelector("#preview-sheet .sheet");
await page.click("#preview-open");
await page.waitForSelector("#out .sheet");
ok("減少動態：沒有進場動畫", !(await page.$eval("#out .sheet", (e) => e.classList.contains("enter"))));
ok("減少動態：觸手不擺動", await page.$eval(".t-a", (e) => getComputedStyle(e).animationName) === "none");
await page.close();

await browser.close();
console.log(results.join("\n"));
console.log(errors.length ? "⚠ console：\n" + errors.join("\n") : "console 沒有錯誤");
if (results.some((r) => r.startsWith("✗")) || errors.length) process.exitCode = 1;   // 有 ✗ 或 console 錯誤就讓 npm run e2e 失敗（原本只有印出來，exit code 永遠是 0）
