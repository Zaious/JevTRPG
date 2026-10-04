// 產生 PDF 測試檔（用 Chrome 印出來，內嵌字型、有 ToUnicode，跟一般 Word／Google Docs 匯出的相近）。
//   node web/worker/e2e/fixtures/make_pdf.mjs
// resume.pdf   有文字層、兩頁
// scanned.pdf  只有一張圖（沒有文字層）——模擬掃描檔，該被判成「讀不到文字」
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../package.json"));
const puppeteer = require("puppeteer-core");

const txt = readFileSync(join(HERE, "resume.txt"), "utf8").split("\n");
const html = `<!doctype html><meta charset="utf-8"><style>
  body{font:14px/1.7 "Microsoft JhengHei","Noto Sans TC",sans-serif;margin:0}
  h1{font-size:22px;margin:0 0 6px} p{margin:0}
  .pb{page-break-before:always}
</style>
<h1>${txt[0]}</h1>
${txt.slice(1, 9).map((l) => `<p>${l || "&nbsp;"}</p>`).join("")}
<div class="pb"></div>
${txt.slice(9).map((l) => `<p>${l || "&nbsp;"}</p>`).join("")}`;

const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-proxy-server"] });
const p = await b.newPage();
await p.setContent(html, { waitUntil: "load" });
await p.pdf({ path: join(HERE, "resume.pdf"), format: "A4", margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" } });

// 掃描檔：把文字畫成一張 PNG，PDF 裡只放這張圖
const png = await (async () => {
  const q = await b.newPage();
  await q.setViewport({ width: 700, height: 300 });
  await q.setContent(`<body style="margin:0;background:#fff;font:26px 'Microsoft JhengHei',sans-serif;padding:20px">${txt.slice(0, 5).join("<br>")}</body>`);
  const buf = await q.screenshot({ type: "png" });
  await q.close();
  return buf.toString("base64");
})();
const s = await b.newPage();
await s.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png}" style="width:100%"></body>`, { waitUntil: "load" });
await s.pdf({ path: join(HERE, "scanned.pdf"), format: "A4" });
await b.close();
console.log("ok");
