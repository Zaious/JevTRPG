/**
 * 開本機 Chrome 截圖：首屏、結果卡、手機寬度。
 * 用 puppeteer-core 驅動你機器上已裝的 Chrome，不另外下載瀏覽器。
 *
 *   npx wrangler dev --port 8787        # 另一個視窗先開著
 *   node shoot.mjs [輸出資料夾]
 *
 * hero 類只截視窗（看「第一眼」有什麼）；result 類按範例、送出、只截結果那張卡。
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:8787";
const OUT = process.argv[2] || "shots";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: "1-resume-zh-hero", path: "/", lang: "zh-Hant", w: 1280, h: 900 },
  { name: "2-resume-zh-result", path: "/", lang: "zh-Hant", w: 1280, h: 900, run: true },
  { name: "3-character-en-hero", path: "/character", lang: "en", w: 1440, h: 900 },
  { name: "4-character-zh-result", path: "/character", lang: "zh-Hant", w: 1280, h: 900, run: true },
  { name: "5-resume-ja-mobile-hero", path: "/", lang: "ja", w: 390, h: 844 },
  { name: "6-resume-zh-mobile-result", path: "/", lang: "zh-Hant", w: 390, h: 844, run: true },
  { name: "7-resume-en-full", path: "/", lang: "en", w: 1280, h: 900, full: true },
];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-proxy-server", "--lang=zh-TW"],
});
try {
  for (const s of SHOTS) {
    const page = await browser.newPage();
    const mobile = s.w < 600;
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${BASE}${s.path}?lang=${s.lang}`, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("#preview-sheet .sheet", { timeout: 15000 });
    const file = join(OUT, `${s.name}.png`);
    if (s.run) {
      await page.click("#sample");
      const t0 = Date.now();
      await page.click("#go");
      await page.waitForSelector("#out .sheet:not(.sheet--loading)", { timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1200));     // 等進場動畫跑完
      console.log(`${s.name}: 結果 ${Date.now() - t0} ms`);
      const el = await page.$("#out .result");
      await el.screenshot({ path: file });
    } else {
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: file, fullPage: !!s.full });
    }
    // 版面檢查：不能有橫向捲動
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`  → ${file}${overflow > 0 ? `   ⚠ 橫向溢出 ${overflow}px` : ""}${errors.length ? "   ⚠ " + errors.join(" | ") : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
