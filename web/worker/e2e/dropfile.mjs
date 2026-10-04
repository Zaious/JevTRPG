// 拖檔、遮蔽預覽、重骰的瀏覽器測試（判讀 API 用替身回範例結果；/api/reroll 與 /api/wire 打真的 Worker）。
//   node e2e/dropfile.mjs        （要先開著 npm run dev）
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = "http://127.0.0.1:8787";
const FIX = new URL("./fixtures/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const SAMPLE = readFileSync(new URL("../../public/samples/resume.zh-Hant.json", import.meta.url), "utf8");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const ok = (n, c, d = "") => results.push(`${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-proxy-server"] });
await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write"]);

async function open(path = "/?lang=zh-Hant", { rerollStatus = 200 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const posts = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.endsWith("/api/config")) return r.respond({ status: 200, contentType: "application/json", body: '{"turnstileSiteKey":null,"ads":null,"posthog":null}' });
    if (u.startsWith(BASE) && r.method() === "POST" && u.endsWith("/api/reroll") && rerollStatus !== 200) return r.respond({ status: rerollStatus, body: "{}" });
    if (u.startsWith(BASE) && r.method() === "POST" && !u.endsWith("/api/reroll")) {
      posts.push(JSON.parse(r.postData() || "{}"));
      return r.respond({ status: 200, contentType: "application/json", body: SAMPLE });
    }
    if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue();
    return r.abort();                                            // 字型等外部請求不是這裡要測的
  });
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  return { page, posts };
}
const msgOf = (page) => page.$eval("#file-msg", (e) => e.textContent);
async function upload(page, name) {
  await page.$eval("#file-msg", (e) => (e.textContent = ""));
  await (await page.$("#file")).uploadFile(join(FIX, name));
  await page.waitForFunction(() => { const t = document.getElementById("file-msg").textContent; return t && t !== "讀取中…"; }, { timeout: 60000 });
  return { msg: await msgOf(page), text: await page.$eval("#text", (e) => e.value) };
}

/* ── 1. 各種檔案 ───────────────────────────────────────────── */
{
  const { page } = await open();
  ok("有選擇檔案鈕與提示，檔案 input 是藏起來的", await page.$eval("#pick", (e) => !!e.textContent) && await page.$eval("#file", (e) => e.hidden));
  const MUST = ["林大明", "0912-345-678", "星海科技", "圖書館系統整合", "專長"];   // 專長：PDF 文字層常把「長」存成部首字元
  const MUST_DOCX = ["林大明", "0912-345-678", "星海科技", "資訊工程學系", "保留的字"];   // docx 檔本身沒放最後一行專長
  for (const name of ["resume.txt", "resume-big5.txt", "resume.md", "resume.docx", "resume-stored.docx", "resume.pdf"]) {
    const r = await upload(page, name);
    ok(`${name}：讀進文字框、提示「已讀入」`, (name.endsWith(".docx") ? MUST_DOCX : MUST).every((s) => r.text.includes(s)) && r.msg.startsWith("已讀入"), r.msg.slice(0, 40));
    if (name === "resume.pdf") ok("resume.pdf：第二頁的字也讀到（PDF 有兩頁）", r.text.includes("國立示範大學") && r.text.includes("Python"));
    if (name === "resume.pdf") ok("resume.pdf：沒有亂碼（不含替代字元 �）", !r.text.includes("\ufffd"));
    await page.$eval("#text", (e) => (e.value = ""));       // 下一個檔案不要跳「要換掉嗎」
  }
  for (const [name, want] of [["scanned.pdf", "OCR"], ["old.doc", ".doc"], ["not-really.docx", "打不開"], ["too-short.txt", "足夠的文字"]]) {
    await page.$eval("#text", (e) => (e.value = ""));
    const r = await upload(page, name);
    ok(`${name}：說得出原因`, r.msg.includes(want) && r.text === "", r.msg.slice(0, 50));
  }
  ok("計數會跟著更新", await (async () => { await upload(page, "resume.txt"); return (await page.$eval("#count", (e) => e.textContent)).includes("/ 12,000"); })());
  await page.close();
}

/* ── 2. 拖放（不是選檔）、放在文字框外也接、已有內容要問 ─────── */
{
  const { page } = await open();
  const b64 = readFileSync(join(FIX, "resume.docx")).toString("base64");
  const fire = (types) => page.evaluate((b64, types) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    const res = {};
    for (const t of types) { const e = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }); window.dispatchEvent(e); res[t] = e.defaultPrevented; }
    res.dragClass = document.querySelector(".intake").classList.contains("drag");
    return res;
  }, b64, types);
  const over = await fire(["dragenter", "dragover"]);
  ok("拖進視窗：預設行為被擋（不會被瀏覽器開起來）、紙張有虛線框", over.dragenter && over.dragover && over.dragClass, JSON.stringify(over));
  const drop = await fire(["drop"]);
  ok("放開：預設行為被擋、虛線框收掉", drop.drop && !drop.dragClass);
  await page.waitForFunction(() => document.getElementById("text").value.includes("星海科技"), { timeout: 30000 });
  ok("拖放的檔案填進文字框", (await msgOf(page)).startsWith("已讀入"));
  // 已有內容 → 問一次；取消就不動
  let asked = 0;
  page.on("dialog", async (d) => { asked++; await (asked === 1 ? d.dismiss() : d.accept()); });
  await page.$eval("#text", (e) => (e.value = "我自己先打的一段話，已經有超過三十個字了，不應該被靜悄悄蓋掉。這是為了確認會先問。"));
  await (await page.$("#file")).uploadFile(join(FIX, "resume.txt"));
  await wait(1500);
  ok("已有內容：跳確認、按取消→原文不動", asked === 1 && (await page.$eval("#text", (e) => e.value)).startsWith("我自己先打"));
  await (await page.$("#file")).uploadFile(join(FIX, "resume.txt"));
  await page.waitForFunction(() => document.getElementById("text").value.includes("星海科技"), { timeout: 30000 });
  ok("已有內容：按確定→換成檔案內容", asked === 2);
  const non = await page.evaluate(() => { const dt = new DataTransfer(); dt.setData("text/plain", "x"); const e = new DragEvent("dragover", { dataTransfer: dt, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  ok("拖文字（不是檔案）不攔", non === false);
  await page.close();
}

/* ── 3. 遮蔽預覽與送出 ──────────────────────────────────────── */
{
  const { page, posts } = await open();
  await upload(page, "resume.txt");
  await wait(400);
  const before = await page.$eval("#rv-line", (e) => e.textContent);
  ok("預覽：只有規則能抓的（信箱、手機、地址）", /信箱 ×1/.test(before) && /手機 ×1/.test(before) && /地址 ×1/.test(before) && !before.includes("你列的字詞"), before);
  await page.type("#mask-terms", "林大明, 星海科技，國立示範大學, 王");
  await wait(500);
  const line = await page.$eval("#rv-line", (e) => e.textContent);
  ok("預覽：加上你列的字詞（姓名×1、星海科技×1、大學×1）", /你列的字詞 ×3/.test(line), line);
  ok("預覽：一個字的字詞被略過並說明", line.includes("「王」太短"), line);
  await page.click("#rv-toggle");
  const view = await page.$eval("#rv-view", (e) => ({ hidden: e.hidden, text: e.textContent, marks: e.querySelectorAll("mark").length }));
  ok("「看遮完的樣子」：展開、沒有原文、標記有畫出來", !view.hidden && !/林大明|星海科技|國立示範大學|lin\.daming|0912|虛構路/.test(view.text) && view.marks >= 5, `${view.marks} 個標記`);
  ok("按鈕文字變成「收起」", (await page.$eval("#rv-toggle", (e) => e.textContent)) === "收起");
  await page.click("#go");
  await page.waitForSelector("#out .sheet:not(.sheet--loading)");
  const body = posts.at(-1);
  ok("送出的文字：姓名、公司、學校、信箱、手機、地址都不在了", !/林大明|星海科技|國立示範大學|lin\.daming|0912|虛構路/.test(body.text), JSON.stringify(body.text.slice(0, 60)));
  ok("送出的文字：標記在、其餘內容還在", body.text.includes("[已遮]") && body.text.includes("[信箱]") && body.text.includes("圖書館系統整合"));
  ok("回報遮了什麼（只有標記與次數）", body.masked?.["[已遮]"] === 3 && body.masked?.["[信箱]"] === 1 && body.masked?.["[手機]"] === 1 && body.masked?.["[地址]"] === 1, JSON.stringify(body.masked));
  ok("送出的欄位沒有多餘的東西", Object.keys(body).sort().join() === "locale,masked,system,text", Object.keys(body).join());
  await page.close();
}
{
  // 沒有任何個資、沒列字詞：不回報 masked，文字原樣
  const { page, posts } = await open();
  await page.type("#text", "在圖書館做過三年館員，負責採購、分類與讀者服務，也帶過兩位工讀生。");
  await page.click("#go");
  await page.waitForSelector("#out .sheet:not(.sheet--loading)");
  ok("沒個資也沒字詞：文字原樣送出、不帶 masked", posts.at(-1).text.startsWith("在圖書館做過三年館員") && !("masked" in posts.at(-1)));
  await page.close();
}
{
  const { page } = await open("/character?lang=zh-Hant");
  ok("角色頁沒有拖檔與遮蔽欄（範圍只在履歷頁）", !(await page.$("#pick")) && !(await page.$("#mask-terms")));
  await page.close();
}

/* ── 4. 重骰 ─────────────────────────────────────────────── */
const charsOf = (page) => page.$$eval("#out .cbox", (els) => Object.fromEntries(els.map((e) => [e.querySelector(".cbox-k").textContent, +e.querySelector(".cbox-v").textContent])));
const derivedOf = (page) => page.$$eval("#out .dbox", (els) => Object.fromEntries(els.map((e) => [e.querySelector(".dbox-k").textContent, +e.querySelector("b").textContent])));
{
  const { page } = await open();
  await page.type("#text", "在圖書館做過三年館員，負責採購、分類與讀者服務，也帶過兩位工讀生。");
  await page.click("#go");
  await page.waitForSelector("#out .sheet:not(.sheet--loading)");
  ok("履歷結果有「重骰能力值」", (await page.$eval("#reroll", (e) => e.textContent)) === "重骰能力值");
  const sk0 = await page.$$eval("#out .sk", (e) => e.map((x) => x.textContent).join("|"));
  const c0 = await charsOf(page), srcs0 = await page.$$eval("#out .cbox-src", (e) => e.map((x) => x.textContent).join());
  let c1 = c0, tries = 0;
  while (JSON.stringify(c1) === JSON.stringify(c0) && tries++ < 3) {
    await page.click("#reroll");
    await page.waitForFunction((n) => document.querySelector("#reroll-note")?.textContent.includes(`${n} 次`), { timeout: 15000 }, tries);
    c1 = await charsOf(page);
  }
  ok("重骰：數值真的換了", JSON.stringify(c1) !== JSON.stringify(c0), `${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
  ok("重骰：EDU（Jev 讀的）不動", c1.EDU === c0.EDU, `EDU ${c0.EDU}`);
  ok("重骰：來源標示不變（8 擲骰＋1 Jev 判讀）", (await page.$$eval("#out .cbox-src", (e) => e.map((x) => x.textContent).join())) === srcs0, srcs0);
  const d1 = await derivedOf(page);
  ok("重骰：HP／MP／SAN 跟著新數值算", d1.HP === Math.trunc((c1.CON + c1.SIZ) / 10) && d1.MP === Math.trunc(c1.POW / 5) && d1.SAN === c1.POW, JSON.stringify(d1));
  ok("重骰：說明「已重骰 N 次」", (await page.$eval("#reroll-note", (e) => e.textContent)).includes(`已重骰 ${tries} 次`));
  ok("重骰：技能沒動", (await page.$$eval("#out .sk", (e) => e.map((x) => x.textContent).join("|"))) === sk0);
  ok("重骰後按鈕還在、可再按", await page.$eval("#reroll", (e) => !e.disabled));
  // 分享的是「現在這組」
  await page.click("#share");
  await page.type("#share-name", "重骰測試");
  await page.click("#share-do");
  await page.waitForFunction(() => document.getElementById("share-do").textContent !== "分享這張卡" && document.getElementById("share-do").textContent !== "複製連結", { timeout: 10000 }).catch(() => {});
  const link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null) || await page.evaluate(() => location.href);
  const p2 = (await open("/?lang=zh-Hant" + link.slice(link.indexOf("#c=")))).page;
  await p2.waitForSelector("#out .sheet");
  const shared = await charsOf(p2), sd = await derivedOf(p2);
  ok("分享連結帶的是重骰後那組（特性值一致）", JSON.stringify(shared) === JSON.stringify(c1), JSON.stringify(shared));
  ok("分享連結的 HP／MP／SAN 也一致", JSON.stringify(sd) === JSON.stringify(await derivedOf(page)));
  ok("分享版沒有重骰鈕", !(await p2.$("#reroll")));
  await p2.close();
  await page.close();
}
{
  const { page } = await open();
  await page.click("#preview-open");
  await page.waitForSelector("#out .sheet");
  ok("看範例：不給重骰（範例是固定的真實結果）", !(await page.$("#reroll")));
  await page.close();
  const c = await open("/character?lang=zh-Hant");
  await c.page.type("#text", "阿明是個圖書館員，做過很多年。");
  await c.page.click("#go");
  await c.page.waitForSelector("#out .sheet:not(.sheet--loading)");
  ok("角色頁結果：不給重骰", !(await c.page.$("#reroll")));
  await c.page.close();
  const f = await open("/?lang=zh-Hant", { rerollStatus: 500 });
  await f.page.type("#text", "在圖書館做過三年館員，負責採購、分類與讀者服務，也帶過兩位工讀生。");
  await f.page.click("#go");
  await f.page.waitForSelector("#out .sheet:not(.sheet--loading)");
  await f.page.click("#reroll");
  await f.page.waitForFunction(() => document.getElementById("img-msg").textContent.includes("重骰失敗"), { timeout: 10000 });
  ok("重骰失敗：說一句、按鈕恢復", await f.page.$eval("#reroll", (e) => !e.disabled));
  await f.page.close();
}

/* ── 5. 英文與日文的介面字串有出來 ─────────────────────────── */
for (const [lang, pick, terms] of [["en", "Choose a file", "Other words to hide"], ["ja", "ファイルを選ぶ", "ほかに隠したい語"]]) {
  const { page } = await open(`/?lang=${lang}`);
  ok(`${lang}：檔案與遮蔽欄的字有翻`, (await page.$eval("#pick", (e) => e.textContent)) === pick && (await page.$eval(".mask-label", (e) => e.textContent)).startsWith(terms));
  await page.close();
}

await browser.close();
console.log(results.join("\n"));
console.log(errors.length ? "⚠ console 錯誤：\n" + [...new Set(errors)].join("\n") : "console 沒有錯誤");
if (results.some((r) => r.startsWith("✗")) || errors.length) process.exitCode = 1;
