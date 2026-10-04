/**
 * 分享連結的編碼：把一張卡壓成幾十個位元組，放進網址 # 後面（伺服器看不到、不需要資料庫）。
 *
 * 為什麼可以這麼短：卡上的字幾乎都來自系統包裡有限的清單（55 項技能、每個年代約 30 種職業、
 * 每個背景欄位 6 個選項）。與其把「圖書館使用」四個字塞進網址，不如只記它是第幾項。
 * 「第幾項」的對照表由 Worker 的 GET /api/wire 提供（排序過、附指紋），編碼與解碼兩邊讀同一份；
 * 表一變，指紋就變，舊連結會被認出是舊版、顯示「連結失效」，而不是被讀成別的東西。
 *
 * 版面（位元組）：
 *   [0] 版本  [1] 語言(0 zh-Hant / 1 en / 2 ja)  [2-3] 表的指紋  [4] 旗標(1=有名字 2=有來源 4=有衍生值)
 *   名字：長度 + UTF-8
 *   特性值：依表的順序，每格 varint(值+1)，0＝沒有
 *   來源：每格 2 bit（0 無 1 擲骰 2 讀出 3 玩家填），依特性值順序打包
 *   衍生值：依表的順序，每格 varint(值+1)
 *   職業：每個年代 1 byte（編號+1，0＝沒有）
 *   背景：每個欄位 1 byte（同上）
 *   技能：⌈N/8⌉ byte 的位元圖（哪幾項有列），再依序每項 varint(值×2 + 淡字旗標)
 *   最後 1 byte：前面所有 byte 的校驗碼（手抄錯一個字的連結會被擋下，不會悄悄讀成另一張卡）
 * 卡上顯示用的名稱都在解碼時從表裡查，所以連結是「用發送者的語言判準」畫出來的，跟現在一樣。
 *
 * 瀏覽器與測試共用這一份（ESM）。
 */
export const LOCALES = ["zh-Hant", "en", "ja"];
export const VERSION = 1;
const SRC = [null, "rolled", "read", "player"];

/** 結果資料 → 要編碼的卡（不含任何履歷原文） */
export function cardOf(data, name = "") {
  const finals = data.final || Object.fromEntries(Object.entries(data.skills).map(([n, r]) => [n, r.value]));
  return {
    n: name || "",
    o: Object.fromEntries(Object.entries(data.occupations || {}).map(([k, v]) => [k, v.choice])),
    c: data.chars || {},
    x: data.sources || {},
    d: data.derived || {},
    // 跟原卡同一個判準：高過基礎值 5 點以上才算；第三格 1＝證據不到一半（淡字、不打叉）
    s: Object.entries(finals)
      .filter(([id, v]) => v >= (data.skills[id]?.base ?? 5) + 5)
      .map(([id, v]) => [id, v, (data.skills[id]?.evidence ?? 1) >= 0.5 ? 0 : 1]),
    b: Object.fromEntries(Object.entries(data.backstory || {}).map(([k, v]) => [k, v.choice])),
  };
}

/* ── byte 層 ─────────────────────────────────────────────────────────── */
class Writer {
  constructor() { this.b = []; }
  byte(n) { this.b.push(n & 255); }
  varint(n) { n = Math.max(0, Math.trunc(n)); while (n >= 128) { this.b.push((n & 127) | 128); n = Math.floor(n / 128); } this.b.push(n); }
}
class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  byte() { if (this.i >= this.b.length) throw new Error("eof"); return this.b[this.i++]; }
  varint() { let n = 0, mul = 1; for (;;) { const x = this.byte(); n += (x & 127) * mul; if (x < 128) return n; mul *= 128; if (mul > 2 ** 28) throw new Error("varint"); } }
  done() { return this.i === this.b.length; }
}
const b64 = {
  enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};

/** 8 位元校驗碼（FNV-1a 折成一個 byte） */
const sum8 = (bytes) => { let h = 2166136261; for (const x of bytes) { h ^= x; h = Math.imul(h, 16777619); } h >>>= 0; return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 255; };

/** 第 i 項的編號 +1；找不到＝0（解碼時當作沒有）。 */
const idx = (list, x) => { const i = list.indexOf(x); return i < 0 ? 0 : i + 1; };

export function encodeCard(card, wire) {
  const w = new Writer();
  const nameBytes = card.n ? new TextEncoder().encode(card.n.slice(0, 24)) : [];
  const hasSrc = Object.keys(card.x || {}).length > 0;
  const hasDer = Object.keys(card.d || {}).length > 0;
  w.byte(VERSION);
  w.byte(Math.max(0, LOCALES.indexOf(wire.locale)));
  w.byte(wire.fp >> 8); w.byte(wire.fp & 255);
  w.byte((nameBytes.length ? 1 : 0) | (hasSrc ? 2 : 0) | (hasDer ? 4 : 0));
  if (nameBytes.length) { w.byte(nameBytes.length); for (const x of nameBytes) w.byte(x); }
  for (const k of wire.chars) w.varint(card.c?.[k] == null ? 0 : card.c[k] + 1);
  if (hasSrc) {
    let acc = 0, n = 0;
    for (const k of wire.chars) {
      acc |= Math.max(0, SRC.indexOf(card.x[k])) << (n * 2);
      if (++n === 4) { w.byte(acc); acc = 0; n = 0; }
    }
    if (n) w.byte(acc);
  }
  if (hasDer) for (const k of wire.derived) w.varint(card.d?.[k] == null ? 0 : card.d[k] + 1);
  for (const e of wire.eras) w.byte(idx(wire.occ[e], card.o?.[e]));
  for (const bs of wire.bs) w.byte(idx(bs.options, card.b?.[bs.title]));
  const ids = wire.skills.map((s) => s.id);
  const have = new Map((card.s || []).map(([id, v, weak]) => [id, [v, weak]]));
  const bits = new Array(Math.ceil(ids.length / 8)).fill(0);
  ids.forEach((id, i) => { if (have.has(id)) bits[i >> 3] |= 1 << (i & 7); });
  for (const x of bits) w.byte(x);
  ids.forEach((id) => { if (have.has(id)) { const [v, weak] = have.get(id); w.varint(v * 2 + (weak ? 1 : 0)); } });
  w.byte(sum8(w.b));
  return b64.enc(w.b);
}

/** 只看語言與表的指紋：要先知道是哪種語言、哪一代的表，才知道去拿哪一份（Worker 依指紋給對應那一代） */
export function peekLink(str) {
  try { const b = b64.dec(str); return b[0] === VERSION && LOCALES[b[1]] ? { locale: LOCALES[b[1]], fp: (b[2] << 8) | b[3] } : null; } catch { return null; }
}

/** 只看語言（舊介面，測試用） */
export function peekLocale(str) {
  try { const b = b64.dec(str); return b[0] === VERSION ? LOCALES[b[1]] || null : null; } catch { return null; }
}

/** @returns {object|null|{stale:true}} 卡；讀不懂＝null；表已經變了（舊版連結）＝{stale:true} */
export function decodeCard(str, wire) {
  try {
    const all = b64.dec(str);
    if (all.length < 6 || sum8(all.subarray(0, -1)) !== all[all.length - 1]) return null;
    const r = new Reader(all.subarray(0, -1));
    if (r.byte() !== VERSION) return null;
    if (LOCALES[r.byte()] !== wire.locale) return null;
    const fp = (r.byte() << 8) | r.byte();
    if (fp !== wire.fp) return { stale: true };
    const flags = r.byte();
    const card = { n: "", o: {}, c: {}, x: {}, d: {}, s: [], b: {} };
    if (flags & 1) { const n = r.byte(); const bytes = []; for (let i = 0; i < n; i++) bytes.push(r.byte()); card.n = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); }
    for (const k of wire.chars) { const v = r.varint(); if (v) card.c[k] = v - 1; }
    if (flags & 2) {
      let acc = 0, n = 4;
      for (const k of wire.chars) {
        if (n === 4) { acc = r.byte(); n = 0; }
        const s = SRC[(acc >> (n * 2)) & 3]; n++;
        if (s && k in card.c) card.x[k] = s;
      }
    }
    if (flags & 4) for (const k of wire.derived) { const v = r.varint(); if (v) card.d[k] = v - 1; }
    for (const e of wire.eras) { const i = r.byte(); if (i) { if (i > wire.occ[e].length) return null; card.o[e] = wire.occ[e][i - 1]; } }
    for (const bs of wire.bs) { const i = r.byte(); if (i) { if (i > bs.options.length) return null; card.b[bs.title] = bs.options[i - 1]; } }
    const bits = []; for (let i = 0; i < Math.ceil(wire.skills.length / 8); i++) bits.push(r.byte());
    wire.skills.forEach((s, i) => {
      if (bits[i >> 3] & (1 << (i & 7))) { const v = r.varint(); card.s.push([s.id, v >> 1, v & 1]); }
    });
    if (bits.length && (bits[bits.length - 1] >> ((wire.skills.length - 1 & 7) + 1)) !== 0) return null;   // 位元圖最後一個 byte 多出來的位元必須是 0
    return r.done() ? card : null;
  } catch { return null; }
}
