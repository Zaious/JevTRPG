/**
 * 個資遮蔽：Worker 與瀏覽器共用同一份（ESM；Worker 直接 import，瀏覽器 dynamic import）。
 *
 * 兩層：
 *   1. 規則：信箱、手機、市話、身分證字號、社群連結、地址／生日欄位（有標籤的那行）。
 *   2. 使用者自己列的字詞（姓名、公司、學校……）：規則抓不到這些，所以讓人自己指定。
 *
 * 瀏覽器先遮一次再送出，所以這些字根本不會離開使用者的電腦；Worker 收到後照樣再遮一次
 * （沒有人能保證請求一定來自我們的前端）。兩邊跑的是同一份程式，結果一致。
 *
 * 誠實的限制：沒有標籤的地址、夾在句子裡的姓名、公司與學校名稱，規則都抓不到。
 */
export const REDACT = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[信箱]"],
  [/(?<!\d)(?:\+?886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)/g, "[手機]"],
  [/(?<!\d)0\d{1,2}[- ]?\d{6,8}(?!\d)/g, "[市話]"],
  [/(?<![A-Za-z])[A-Z][12]\d{8}(?![A-Za-z0-9])/g, "[身分證]"],
  // 以下是台灣以外的格式（英文版推廣之後才補：原本只認台灣號碼，貼美國／英國／日本履歷時電話會原樣送出去）。
  // 刻意只認「有明確電話形狀」的寫法，避免吃到日期（2019-01-02）、年份區間（2019-2025）、版本號。
  [/(?<![\w+])\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}(?!\d)/g, "[手機]"],                 // +44 20 7946 0958、+1 415-555-0123、+81 90-1234-5678
  [/(?<![\w-])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w-])/g, "[手機]"],                                       // (415) 555-0123、415-555-0123
  [/(?<!\d)07\d{3}[ ]?\d{6}(?!\d)|(?<!\d)0\d{2,3}[ ]\d{3,4}[ ]\d{4}(?!\d)/g, "[手機]"],                  // 英國 07700 900123、020 7946 0958
  [/(?<![\w-])0\d{1,3}-\d{3,4}-\d{4}(?![\w-])/g, "[手機]"],                                              // 日本 090-1234-5678、03-1234-5678
  [/(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])/g, "[身分證]"],                                                  // 美國 SSN
  [/https?:\/\/\S*(?:linkedin|facebook|instagram|threads)\S*/gi, "[社群連結]"],
  [/(^|\n)[ \t]*(?:地址|住址|通訊地址|address|home address|mailing address|住所|現住所|ご住所)[ \t]*[:：].*/gi, "\n[地址]"],
  [/(^|\n)[ \t]*(?:生日|出生年月日|date of birth|birth date|birthday|dob|生年月日|誕生日)[ \t]*[:：].*/gi, "\n[生日]"],
];

/** 使用者列的字詞被換成這個 */
export const TERM_TAG = "[已遮]";
/** 卡片頁腳「已遮掉：…」可能出現的標記（Worker 收前端回報的計數時用它驗證） */
export const TAGS = [...new Set([...REDACT.map((r) => r[1].replace(/^\n/, "")), TERM_TAG])];
/** 太短的字詞（一個字）會把不相干的字一起遮掉，不接受 */
export const MIN_TERM = 2;

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 「王小明, Acme 公司」→ ["王小明","Acme 公司"]；逗號、頓號、分號、換行都能分；去重、去太短的 */
export function parseTerms(raw) {
  const seen = new Set(), out = [], tooShort = [];
  for (const t of String(raw || "").split(/[,，、;；\n]/)) {
    const s = t.trim().replace(/\s+/g, " ");
    if (!s) continue;
    if ([...s].length < MIN_TERM) { tooShort.push(s); continue; }
    if (!seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return { terms: out, tooShort };
}

/** @returns {[string, Record<string, number>]} 遮完的文字，與各標記出現幾次 */
export function redact(text, terms = []) {
  const hits = {};
  // 使用者的字詞先遮：長的先，免得「Acme 公司」被「Acme」先咬掉一半
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const re = new RegExp(reEsc(term).replace(/ /g, "\\s+"), "gi");
    let n = 0;
    text = text.replace(re, () => (n++, TERM_TAG));
    if (n) hits[TERM_TAG] = (hits[TERM_TAG] || 0) + n;
  }
  for (const [re, tag] of REDACT) {
    const before = text;
    text = text.replace(re, tag);
    if (text !== before) hits[tag.replace(/^\n/, "")] = (hits[tag.replace(/^\n/, "")] || 0) + 1;
  }
  return [text, hits];
}

/** 把前端回報的計數（{"[信箱]":1}）洗成只含已知標記、1–99 的整數；其他一律丟掉。只用來顯示，不影響判讀。 */
export function sanitizeHits(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const n = Math.trunc(+v);
    if (TAGS.includes(k) && n >= 1) out[k] = Math.min(n, 99);
  }
  return out;
}
