/**
 * 把使用者拖進來的檔案讀成純文字——全部在瀏覽器裡做，檔案不會上傳到任何地方。
 *
 *   .txt / .md   直接讀（UTF-8；不是 UTF-8 就試 Big5，舊版 Windows 記事本存的繁中檔常是這個）
 *   .docx        自己解 zip（DecompressionStream）＋抽 word/document.xml 的文字；不引入套件
 *   .pdf         自架的 pdf.js（vendor/pdfjs/，第一次拖 PDF 才載入，約 1.7 MB）
 *
 * 讀不了就丟帶 code 的 Error，由呼叫端翻成使用者看得懂的話：
 *   unsupported（.doc、圖片、其他）／toobig／corrupt（壞檔）／encrypted（PDF 要密碼）／
 *   empty（讀到的字太少——通常是掃描成圖片的 PDF，這種需要 OCR，這裡不做）
 *
 * 瀏覽器與測試共用（ESM）。PDF 那條只能在瀏覽器跑（要 worker），測試走 e2e。
 */
export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_CHARS = 30;                 // 除了空白以外少於這麼多字＝視為讀不到內容
const MAX_TEXT = 60000;                      // 讀到這麼多就停（後面本來就會被 12,000 字上限擋掉）
const MAX_PAGES = 20;

const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

export const kindOf = (name = "", type = "") => {
  const n = name.toLowerCase();
  if (/\.pdf$/.test(n) || type === "application/pdf") return "pdf";
  if (/\.docx$/.test(n) || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (/\.(txt|md|markdown|text)$/.test(n) || type === "text/plain" || type === "text/markdown") return "text";
  return null;
};

/** 部首補充區（U+2E80–2EFF）大多沒有 Unicode 的相容對應，NFKC 換不回來；這裡只列「名稱就是那個字」、
 *  看得出來對應的（長、青、食、骨、鬼、龜、雨、足、角）。Kangxi 部首區與相容漢字區由 NFKC 全部處理。
 *  沒列到的部首字元原樣留著——寧可少換，不要換錯。 */
const RADICAL = { "⻑": "長", "⻒": "長", "⻘": "青", "⻝": "食", "⻞": "食", "⻟": "食", "⻣": "骨",
  "⻤": "鬼", "⻱": "龜", "⻗": "雨", "⻊": "足", "⻇": "角" };

/** 版面清理：統一換行、去掉零寬字元、行尾空白，連續空行壓成一行。
 *  另外把「康熙部首／部首補充／相容漢字」換回一般漢字：很多 PDF（Chrome、部分 Word 匯出）的文字層把
 *  「大、手、工、示、長」存成 ⼤⼿⼯⽰⻑ 這類部首字元——看起來一樣、碼不同，會讓姓名比對與判讀都失靈。 */
export function tidy(s) {
  return s.replace(/[⺀-⻿⼀-⿟豈-﫿]/g, (c) => RADICAL[c] || c.normalize("NFKC"))
    .replace(/\r\n?/g, "\n").replace(/[​-‍⁠﻿]/g, "")
    .replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { try { return new TextDecoder("big5").decode(bytes); } catch { throw fail("corrupt"); } }
}

/* ── docx ────────────────────────────────────────────────────────────── */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** 只讀需要的那一個檔：從 zip 尾端的目錄找到它、解壓。不支援 zip64、加密。 */
export async function zipEntry(buf, wanted) {
  const b = new Uint8Array(buf), v = new DataView(buf);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw fail("corrupt", "找不到 zip 目錄");
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw fail("corrupt");
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    if (name === wanted) {
      if (flags & 1) throw fail("encrypted");
      if (v.getUint32(off, true) !== 0x04034b50) throw fail("corrupt");
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const data = b.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) { try { return await inflateRaw(data); } catch { throw fail("corrupt"); } }
      throw fail("corrupt", "不支援的壓縮方式");
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, h, d, n) =>
  n ? ENT[n.toLowerCase()] : String.fromCodePoint(h ? parseInt(h, 16) : parseInt(d, 10)));

/** word/document.xml → 文字。段落、表格列換行，儲存格與 tab 用 tab。
 *  文字方塊 Word 會寫兩份（mc:Choice 與 mc:Fallback），只留 Choice，不然每個字出現兩次。 */
export function docxXmlToText(xml) {
  xml = xml.replace(/<mc:Fallback[\s\S]*?<\/mc:Fallback>/g, "");
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/?>|<w:cr\s*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  for (let m; (m = re.exec(xml)); ) {
    const t = m[0];
    if (m[1] !== undefined) out += unescapeXml(m[1]);
    else if (t === "</w:tc>") out = out.replace(/\n$/, "") + "\t";   // 儲存格裡的段落結尾不算換行，格與格之間用 tab
    else if (t.startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

export async function docxText(buf) {
  let xml;
  try { xml = await zipEntry(buf, "word/document.xml"); } catch (e) { throw e.code ? e : fail("corrupt"); }
  if (!xml) throw fail("corrupt", "不是 docx");
  return docxXmlToText(new TextDecoder("utf-8").decode(xml));
}

/* ── pdf ─────────────────────────────────────────────────────────────── */
let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  }
  return pdfjs;
}

export async function pdfText(buf) {
  const lib = await loadPdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(buf), cMapUrl: "/vendor/pdfjs/cmaps/", cMapPacked: true, isEvalSupported: false, useSystemFonts: false }).promise;
  } catch (e) {
    throw fail(e?.name === "PasswordException" ? "encrypted" : "corrupt", String(e?.message || e));
  }
  let out = "";
  try {
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES) && out.length < MAX_TEXT; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let lastY = null;
      for (const it of content.items) {
        if (typeof it.str !== "string") continue;
        const y = it.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2 && it.str && !out.endsWith("\n")) out += "\n";
        out += it.str;
        if (it.str) lastY = y ?? lastY;
        if (it.hasEOL) out += "\n";
      }
      out += "\n\n";
    }
  } finally { doc.destroy?.(); }
  return out;
}

/* ── 進入點 ──────────────────────────────────────────────────────────── */
/** @param {File} file @returns {Promise<{text: string, kind: string}>} */
export async function extractText(file) {
  const kind = kindOf(file.name, file.type);
  if (!kind) throw fail("unsupported");
  if (file.size > MAX_BYTES) throw fail("toobig");
  const buf = await file.arrayBuffer();
  const raw = kind === "pdf" ? await pdfText(buf) : kind === "docx" ? await docxText(buf) : decodeText(buf);
  const text = tidy(raw);
  if (text.replace(/\s/g, "").length < MIN_CHARS) throw fail("empty");
  return { text, kind };
}
