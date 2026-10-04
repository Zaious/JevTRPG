/**
 * 漂移閘：JS 的計分必須跟 Python 的 engine/scoring.py 算出一樣的東西。
 *
 * 兩份實作是這個專案唯一的重複——CLI 是 Python、Worker 是 JS。規則資料只有
 * 一份真相（system.yaml → build.py → system.json），但算法有兩份。所以拿
 * Python 真跑出來的機率分布當固定樣本，兩邊跑同一批數字，對不上就 exit 1。
 *
 *   node web/worker/test.mjs
 *
 * fixtures.json 由 runs/*.json 抽出來（真實 API 回應，不是編的）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check as checkStatic } from "../sync-static.mjs";
import { read, redact, parseCharacter, charAliases, matchSkill, evalFormula, derivedOf, publicConfig, skillList, matchSkillId } from "./src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = (await import("./system.js")).default.coc;
const SYS = PACK["zh-Hant"];
const FX = JSON.parse(readFileSync(join(HERE, "fixtures.json"), "utf8"));

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}: 得到 ${JSON.stringify(got)}，Python 是 ${JSON.stringify(want)}`);
};

// 1. build 模式：等級分布 → 技能值、有沒有證據、是不是雙峰
for (const [name, f] of Object.entries(FX.build)) {
  const values = [f.base, ...SYS.value.slice(1)];
  const r = read({ probabilities: f.probabilities, score: 0, confidence: 0 }, values, SYS.ceiling);
  eq(`build ${name} value`, r.value, f.expect.value);
  eq(`build ${name} evidence`, Math.round(r.evidence * 1e6) / 1e6, f.expect.evidence);
  eq(`build ${name} split`, r.split, f.expect.split);
}

// 2. check 模式：背景撐得起多少 + 判定
for (const [name, f] of Object.entries(FX.check)) {
  const r = read({ probabilities: f.probabilities, score: 0, confidence: 0 },
                 SYS.ceiling, SYS.ceiling);
  eq(`check ${name} ceiling`, r.ceiling, f.expect.ceiling);
  eq(`check ${name} split`, r.split, f.expect.split);
}

// 3. 遮蔽：送出去之前該拔掉的東西
const [clean, hits] = redact("聯絡 a.b+x@mail.example.com 或 0912-345-678\n地址：台北市某路一段 1 號");
eq("redact 信箱", clean.includes("[信箱]"), true);
eq("redact 手機", clean.includes("[手機]"), true);
eq("redact 地址", clean.includes("[地址]"), true);
eq("redact 原文不留", /mail\.example\.com|0912/.test(clean), false);
eq("redact 計數", Object.keys(hits).length >= 3, true);

// 4. 角色卡解析：跟 Python 的 modes.parse_character 同一套規則
const p = parseCharacter("【角色】某人\n【背景故事】他做過一些事。\n【特性值】\nEDU 65　INT 70\n【技能】\n圖書館使用 70\n外語（英文） 40\n", SYS.sections);
eq("parse 特性值", p.chars, { EDU: 65, INT: 70 });
eq("parse 技能", p.claimed, { "圖書館使用": 70, "外語（英文）": 40 });
eq("parse 背景", p.state["背景"], "他做過一些事。");

// 5. 系統包本身
eq("系統包有技能", Object.keys(SYS.skills).length > 40, true);
eq("量表長度一致", [SYS.levels.length, SYS.ceiling.length, SYS.value.length],
   [SYS.levels.length, SYS.levels.length, SYS.levels.length]);
eq("每項技能都有定義",
   Object.values(SYS.skills).every((s) => s.meaning && typeof s.base === "number"), true);

// 6. 語系：結構只有一份，各語系只准字串不同
const LOCS = Object.keys(PACK);
eq("有三個語系", LOCS.sort(), ["en", "ja", "zh-Hant"]);
const keys = (o) => Object.keys(o).sort();
for (const l of LOCS) {
  const s = PACK[l];
  eq(`${l} 技能 key 跟繁中一樣`, keys(s.skills), keys(SYS.skills));
  eq(`${l} 每項技能都有 label/meaning/evidence`,
     Object.values(s.skills).every((v) => v.label && v.meaning && v.evidence), true);
  eq(`${l} base 跟繁中一樣`,
     Object.entries(s.skills).every(([k, v]) => v.base === SYS.skills[k].base), true);
  eq(`${l} reachable 跟繁中一樣`,
     Object.entries(s.skills).every(([k, v]) => v.reachable === SYS.skills[k].reachable), true);
  eq(`${l} 量表五級`, s.levels.length, SYS.levels.length);
  eq(`${l} 題目措辭都有佔位符`,
     s.prompts.build.includes("{name}") && s.prompts.build.includes("{meaning}")
       && s.prompts.build.includes("{evidence}") && s.prompts.check.includes("{value}"), true);
  for (const era of keys(SYS.occupations))
    eq(`${l} 職業 ${era} 數量`, Object.keys(s.occupations[era]).length,
       Object.keys(SYS.occupations[era]).length);
  for (const cid of keys(SYS.backstory))
    eq(`${l} 背景 ${cid} 選項數`, Object.keys(s.backstory[cid].options).length,
       Object.keys(SYS.backstory[cid].options).length);
}

// 7. 各語系的技能名都比對得到（KP 模式裡玩家會用自己語言的名字打）
eq("英文名比對", matchSkill(PACK.en, "Library Use")?.base, 20);
eq("日文名比對", matchSkill(PACK.ja, "図書館")?.base, 20);
eq("帶括號的外語", matchSkill(PACK.en, "Language (Other)")?.base, 1);
eq("繁中 canonical 在英文包也比對得到", matchSkill(PACK.en, "圖書館使用")?.base, 20);

// 8. 區塊解析：三語標記、較長別名優先、行首才算標記——答案由 Python 算出
for (const [name, f] of Object.entries(FX.sections)) {
  const got = parseCharacter(f.text, SYS.sections, charAliases(SYS));
  eq(`解析 ${name} 角色/背景`, got.state, f.expect.state);
  eq(`解析 ${name} 特性值`, got.chars, f.expect.chars);
  eq(`解析 ${name} 技能`, got.claimed, f.expect.claimed);
}

// 9. 點數公式：跟 Python eval 對答案；且 Worker 原始碼不得出現 Function( / eval(
//    （Cloudflare Workers 禁止執行期產生程式碼，Node 不禁，所以要用字面檢查擋）
for (const [f, want] of Object.entries(FX.formulas.cases))
  eq(`公式 ${f}`, Math.trunc(evalFormula(f, FX.formulas.vars)), want);
let threw = false;
try { evalFormula("EDU; process.exit()", FX.formulas.vars); } catch { threw = true; }
eq("公式拒絕非算式內容", threw, true);
const SRC = readFileSync(join(HERE, "src", "index.js"), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
eq("Worker 沒有 Function(", /\bFunction\s*\(/.test(SRC), false);
eq("Worker 沒有 eval(", /\beval\s*\(/.test(SRC), false);

// 10. 衍生值：照系統包算；缺特性值的那格不算、不報錯
eq("衍生值 HP/MP/SAN", derivedOf(SYS, { CON: 60, SIZ: 65, POW: 55 }), { HP: 12, MP: 11, SAN: 55 });
eq("衍生值缺 CON/SIZ 只算得出的", derivedOf(SYS, { POW: 55 }), { MP: 11, SAN: 55 });

// 11. 公開設定：沒設就整個關掉；只有發布者 ID 也要能啟動廣告；金鑰類不得外洩
eq("config 全空＝全關", publicConfig({}), { turnstileSiteKey: null, ads: null, posthog: null });
eq("config 只有發布者 ID", publicConfig({ ADSENSE_CLIENT: "ca-pub-1" }).ads, { client: "ca-pub-1", slots: {} });
eq("config 空字串的版位不算", publicConfig({ ADSENSE_CLIENT: "ca-pub-1", ADSENSE_SLOT_RESULTS: "", ADSENSE_SLOT_FOOTER: "22" }).ads.slots, { footer: "22" });
eq("config PostHog 預設 host", publicConfig({ POSTHOG_KEY: "phc_x" }).posthog, { key: "phc_x", host: "https://us.i.posthog.com" });
const leak = JSON.stringify(publicConfig({ TYPESAFE_API_KEY: "SECRET1", TURNSTILE_SECRET: "SECRET2" }));
eq("config 不含 API 金鑰與 Turnstile 密鑰", /SECRET/.test(leak), false);

// 12. 聲明文字不漂：HTML 裡的靜態繁中要等於 i18n.js（頁尾、隱私頁內文、站台常數）
eq("靜態繁中與 i18n.js 一致", checkStatic(), []);

// 13. 技能名稱比對：跟 Python 的 _match_id 對答案。
//     Language (Own)／(Other) 曾經被互相送錯定義（Python 與 Worker 的字典順序相反，各錯一邊）
for (const [loc, cases] of Object.entries(FX.matching))
  for (const [name, want] of Object.entries(cases))
    eq(`比對 ${loc} ${name}`, matchSkillId(PACK[loc], name), want);
eq("Language (Own) 不會拿到外語的定義", matchSkill(PACK.en, "Language (Own)").meaning.includes("native language;"), true);
eq("Language (Other) 不會拿到母語的定義", matchSkill(PACK.en, "Language (Other)").meaning.includes("non-native"), true);

// 14. 技能清單端點：各語系都有完整清單；名稱就是卡上印的那個；別名帶出來
for (const loc of ["zh-Hant", "en", "ja"]) {
  const L = skillList(PACK[loc]);
  eq(`技能清單 ${loc} 數量`, L.skills.length, Object.keys(PACK[loc].skills).length);
  eq(`技能清單 ${loc} 每項都有名稱與基礎值`, L.skills.every((s) => s.label && Number.isInteger(s.base)), true);
  eq(`技能清單 ${loc} 有技能區塊別名`, L.sections.skills.length > 0, true);
}
eq("技能清單 en 有 Library Use 基礎 20", skillList(PACK.en).skills.find((s) => s.label === "Library Use")?.base, 20);
eq("技能清單 ja 外語帶別名「外国語」", skillList(PACK.ja).skills.find((s) => s.id === "外語")?.aliases, ["外国語"]);

// 15. 遮蔽：Worker 與瀏覽器共用同一份；使用者列的字詞
{
  const { redact: rd, parseTerms, sanitizeHits, TERM_TAG, TAGS } = await import("../public/redact.js");
  const { terms, tooShort } = parseTerms("王小明, Acme  公司、acme 公司；王, 台大\n王小明");
  eq("字詞：分隔、去重（不分大小寫、空白正規化）、去一個字的", [terms, tooShort], [["王小明", "Acme 公司", "台大"], ["王"]]);
  const [c1, h1] = rd("王小明 任職於 acme   公司，畢業於台大。電話 0912-345-678。王小明再次出現。", terms);
  eq("字詞：全遮、不分大小寫、空白彈性", /王小明|acme|台大|0912/i.test(c1), false);
  eq("字詞：計數（王小明×2、Acme 公司×1、台大×1、手機×1）", [h1[TERM_TAG], h1["[手機]"]], [4, 1]);
  const [c2] = rd("Acme 公司與 Acme", ["Acme", "Acme 公司"]);
  eq("字詞：長的先遮，不會被短的咬半", c2, `${TERM_TAG}與 ${TERM_TAG}`);
  eq("字詞：含正規表示式特殊字元的字詞照字面比對", rd("C++ (senior) 開發", ["C++ (senior)"])[0], `${TERM_TAG} 開發`);
  eq("沒有字詞時與原本 redact 行為相同", rd("a@b.co 0912345678")[0], "[信箱] [手機]");
  eq("地址標記不帶換行", Object.keys(rd("姓名\n地址：某處")[1]), ["[地址]"]);
  // 台灣以外的格式（英文版推廣前補的）：要遮的、與絕不能誤遮的（日期、年份區間、金額、版本號、ISBN）
  for (const c of ["Phone: (415) 555-0123", "Call +1 415-555-0123", "Tel +44 20 7946 0958", "Mobile 07700 900123", "London 020 7946 0958", "+81 90-1234-5678", "090-1234-5678", "Tokyo 03-1234-5678", "SSN 123-45-6789", "Address: 12 Baker Street, London", "DOB: 1990-01-02", "Date of Birth: 2 Jan 1990", "住所：東京都千代田区", "生年月日：1990年1月2日"])
    eq(`遮蔽（非台灣格式）：${c}`, rd(c)[0] !== c, true);
  for (const c of ["Worked 2019-2025 at Acme", "2018 2019 2020", "Date 2019-01-02", "01-02-2020", "Q1 2020 - Q3 2021", "Revenue $1,234,567 in 2021", "Version 1.2.3", "ISBN 978-3-16-148410-0", "ISO 9001:2015", "Team of 120 across 14 offices", "Built 3 products 2 apps 2024", "Grew from 2,000 to 15,000 users"])
    eq(`不誤遮：${c}`, rd(c)[0], c);
  eq("回報的計數只收已知標記、1–99 整數", sanitizeHits({ "[信箱]": 2, "<script>": 5, "[手機]": -1, "[已遮]": 500, "[身分證]": "x" }), { "[信箱]": 2, "[已遮]": 99 });
  eq("回報的計數：非物件一律空", [sanitizeHits(null), sanitizeHits("x"), sanitizeHits([1])], [{}, {}, {}]);
  eq("TAGS 涵蓋規則的每個標記", ["[信箱]", "[手機]", "[市話]", "[身分證]", "[社群連結]", "[地址]", "[生日]", "[已遮]"].every((t) => TAGS.includes(t)), true);
}

// 16. 重骰：只換擲骰的格子，EDU 與其他照舊；範圍對；衍生值跟著算
{
  const { rerollChars } = await import("./src/index.js");
  const cur = { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, LUCK: 50, EDU: 77 };
  let seq = 0.0; const rng = () => (seq = (seq + 0.37) % 1);
  const r = rerollChars(SYS, cur, rng);
  eq("重骰：EDU 沿用", r.chars.EDU, 77);
  eq("重骰：九格都在", Object.keys(r.chars).sort(), Object.keys(SYS.characteristics).sort());
  eq("重骰：衍生值＝照新特性值算", r.derived, derivedOf(SYS, r.chars));
  for (const [k, spec] of Object.entries(SYS.characteristics)) {
    if (!spec.dice) continue;
    const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(spec.dice), lo = ((+m[3] || 0) + +m[1]) * (spec.mul || 1), hi = ((+m[3] || 0) + +m[1] * +m[2]) * (spec.mul || 1);
    let ok = true;
    for (let i = 0; i < 300; i++) { const v = rerollChars(SYS, cur, Math.random).chars[k]; if (v < lo || v > hi || v % (spec.mul || 1)) ok = false; }
    eq(`重骰：${k}（${spec.dice}×${spec.mul || 1}）300 次都在 ${lo}–${hi} 且是倍數`, ok, true);
  }
  let changed = 0; for (let i = 0; i < 50; i++) if (JSON.stringify(rerollChars(SYS, cur, Math.random).chars) !== JSON.stringify(rerollChars(SYS, cur, Math.random).chars)) changed++;
  eq("重骰：真的會變（50 對裡至少 45 對不同）", changed >= 45, true);
  eq("重骰：壞輸入不炸（chars 缺／非物件）", [rerollChars(SYS, null).chars.EDU, rerollChars(SYS, "x").chars.EDU], [undefined, undefined]);
  eq("重骰：EDU 超出範圍被夾住", [rerollChars(SYS, { EDU: 500 }).chars.EDU, rerollChars(SYS, { EDU: -3 }).chars.EDU], [99, 1]);
}

// 17. 分享連結編碼：編→解＝原樣；夠短；舊表／壞資料被認出來；亂改任何一個字元都不會炸
{
  const { wireOf } = await import("./src/index.js");
  const { cardOf, encodeCard, decodeCard, peekLocale, LOCALES } = await import("../public/card-codec.js");
  const wires = Object.fromEntries(LOCALES.map((l) => [l, wireOf(PACK[l], l)]));
  eq("編碼表：三種語言的技能編號完全相同", LOCALES.every((l) => JSON.stringify(wires[l].skills.map((s) => s.id)) === JSON.stringify(wires["zh-Hant"].skills.map((s) => s.id))), true);
  eq("編碼表：三種語言的清單長度一致（職業／背景選項）", LOCALES.every((l) => JSON.stringify(wires[l].eras.map((e) => wires[l].occ[e].length)) === JSON.stringify(wires["zh-Hant"].eras.map((e) => wires["zh-Hant"].occ[e].length)) && JSON.stringify(wires[l].bs.map((b) => b.options.length)) === JSON.stringify(wires["zh-Hant"].bs.map((b) => b.options.length))), true);
  eq("編碼表：每個清單都放得進 1 byte（≤254）", LOCALES.every((l) => wires[l].skills.length <= 254 && wires[l].eras.every((e) => wires[l].occ[e].length <= 254) && wires[l].bs.every((b) => b.options.length <= 254)), true);
  eq("編碼表：指紋穩定（同一份編兩次相同）", wireOf(PACK.en, "en").fp, wires.en.fp);
  const bumped = structuredClone(PACK["zh-Hant"]); bumped.skills["新增的技能"] = { ...Object.values(bumped.skills)[0] };
  eq("編碼表：多一項技能＝指紋不同", wireOf(bumped, "zh-Hant").fp !== wires["zh-Hant"].fp, true);
  const lens = [];
  for (const loc of LOCALES) {
    const d = JSON.parse(readFileSync(join(HERE, "..", "public", "samples", `resume.${loc}.json`), "utf8"));
    for (const name of ["", "阿明"]) {
      const card = cardOf(d, name), s = encodeCard(card, wires[loc]);
      lens.push(s.length);
      const back = decodeCard(s, wires[loc]);
      const norm = (c) => JSON.stringify([c.n, Object.entries(c.o).sort(), Object.entries(c.c).sort(), Object.entries(c.x).sort(), Object.entries(c.d).sort(), [...c.s].sort(), Object.entries(c.b).sort()]);
      eq(`連結 ${loc}${name ? "（有名字）" : ""}：編→解＝原樣`, back && norm(back), norm(card));
      eq(`連結 ${loc}${name ? "（有名字）" : ""}：語言可從連結看出來`, peekLocale(s), loc);
    }
  }
  console.log(`   分享連結長度（字元）：${lens.join("、")}（舊格式約 1232）`);
  eq("連結：全部 < 250 字元", lens.every((n) => n < 250), true);
  // 名字最長（24 個中日文字＝72 byte）也要放得下、解得回來
  const d0 = JSON.parse(readFileSync(join(HERE, "..", "public", "samples", "resume.zh-Hant.json"), "utf8"));
  const longName = "測".repeat(24), sLong = encodeCard(cardOf(d0, longName), wires["zh-Hant"]);
  eq("連結：24 字的名字來回一致", decodeCard(sLong, wires["zh-Hant"]).n, longName);
  eq("連結：超過 24 字的名字被截斷、不壞", decodeCard(encodeCard(cardOf(d0, "測".repeat(40)), wires["zh-Hant"]), wires["zh-Hant"]).n, longName);
  const good = encodeCard(cardOf(d0, "阿明"), wires["zh-Hant"]);
  eq("連結：表變了→認得出是舊版", decodeCard(good, wireOf(bumped, "zh-Hant")), { stale: true });
  eq("連結：拿別種語言的表解→null", decodeCard(good, wires.en), null);
  eq("連結：截斷→null", [decodeCard(good.slice(0, good.length - 3), wires["zh-Hant"]), decodeCard("", wires["zh-Hant"]), decodeCard("AAAA", wires["zh-Hant"])], [null, null, null]);
  eq("連結：後面多接東西→null", decodeCard(good + "AAAA", wires["zh-Hant"]), null);
  eq("連結：不是 base64→null", [decodeCard("!!!!", wires["zh-Hant"]), peekLocale("!!!!")], [null, null]);
  // 亂改：每個位置換一個字元，解碼不能丟例外（結果是 null、stale 或一張合法的卡都行）
  const chars64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let threw = 0, wrongButAccepted = 0;
  for (let i = 0; i < good.length; i++) for (const ch of ["A", "_", "9"]) {
    const bad = good.slice(0, i) + ch + good.slice(i + 1);
    try { const r = decodeCard(bad, wires["zh-Hant"]); if (r && !r.stale && bad !== good) wrongButAccepted++; } catch { threw++; }
  }
  eq("連結：改任何一個字元，解碼不丟例外", threw, 0);
  eq(`連結：改一個字元＝一律被擋下（${good.length * 3} 種改法，校驗碼 8 位元）`, wrongButAccepted <= 1, true);
  console.log(`   （改一個字元後仍讀得成卡：${wrongButAccepted} / ${good.length * 3}）`);
  eq("連結：字元集只有 URL 安全字元", /^[A-Za-z0-9_-]+$/.test(good), true);
  void chars64;
}

// 17a. 已發出去的連結不能失效（2026-09-30 擴充職業表時踩過）：歷代的表凍結、解碼依連結上的指紋取用
{
  const { wireOf, fpOf } = await import("./src/index.js");
  const { decodeCard, peekLink } = await import("../public/card-codec.js");
  const { problems, loadFrozen } = await import("./wire-freeze.mjs");
  const frozen = await loadFrozen();
  eq("凍結表：目前的表已凍結、凍結版裡的項目都還在", problems(frozen, PACK), []);
  const cut = structuredClone(PACK); delete cut.en.skills.Anthropology; delete cut["zh-Hant"].occupations["1920"]["護士"];
  eq("凍結表：刪掉技能或職業會被擋（舊連結會指到不存在的東西）", problems(frozen, cut).length >= 2, true);
  const LEG = JSON.parse(readFileSync(join(HERE, "legacy-links.fixture.json"), "utf8"));   // 用擴充職業表「之前」的程式做的真連結
  eq("舊連結固定樣本：有 6 條、涵蓋三種語言", [LEG.links.length, new Set(LEG.links.map((l) => l.loc)).size], [6, 3]);
  for (const l of LEG.links) {
    const pk = peekLink(l.link);
    eq(`舊連結 ${l.loc}${l.name ? "（有名字）" : ""}：指紋讀得出來、是舊的那一代`, [pk.locale, pk.fp], [l.loc, LEG.fps[l.loc]]);
    const wire = wireOf(PACK[l.loc], l.loc, pk.fp);
    const norm = (c) => JSON.stringify([c.n, Object.entries(c.o).sort(), Object.entries(c.c).sort(), Object.entries(c.x).sort(), Object.entries(c.d).sort(), [...c.s].sort(), Object.entries(c.b).sort()]);
    const back = decodeCard(l.link, wire);
    eq(`舊連結 ${l.loc}${l.name ? "（有名字）" : ""}：依指紋取舊表→原樣讀出`, back && !back.stale && norm(back), norm(l.card));
    eq(`舊連結 ${l.loc}${l.name ? "（有名字）" : ""}：讀出的職業、技能名都還在目前的系統包裡（畫得出來）`,
      Object.entries(back.o).every(([e, n]) => n in PACK[l.loc].occupations[e]) && back.s.every(([id]) => id in PACK[l.loc].skills), true);
    eq(`舊連結 ${l.loc}${l.name ? "（有名字）" : ""}：只給目前這一代的表＝讀不了（這就是當初的事故；現在靠指紋取舊表避開）`, decodeCard(l.link, wireOf(PACK[l.loc], l.loc)), { stale: true });
  }
  eq("指紋不認得（連結來自未知的表）→ 給目前這版、解碼判成舊版，不會讀成別的", decodeCard(LEG.links[0].link, wireOf(PACK["zh-Hant"], "zh-Hant", 12345)), { stale: true });
  const W = (await import("./src/index.js")).default;
  const cc = async (q) => (await W.fetch(new Request("https://x.test/api/wire?" + q), {})).headers.get("Cache-Control");
  eq("wire 快取：目前這代 no-cache、指定指紋的那代可快取", [await cc("locale=en"), await cc("locale=en&fp=" + LEG.fps.en)], ["no-cache", "public, max-age=3600"]);
  eq("每一代的表都能依指紋取到（取到的指紋等於要的）", ["zh-Hant", "en", "ja"].every((loc) => frozen[loc].every((g) => wireOf(PACK[loc], loc, fpOf(g)).fp === fpOf(g))), true);
}

// 17b. build() 端到端（替身 fetch 當 Jev）：送到 Jev 的文字已遮、頁腳計數＝瀏覽器回報的＋伺服器自己抓到的
{
  const { build } = await import("./src/index.js");
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (_url, init) => {
    const { state, questions } = JSON.parse(init.body);
    sent = state;
    const answers = {};
    for (const [k, q] of Object.entries(questions)) {
      if (q.type === "score") answers[k] = { score: 0, confidence: 0.5, probabilities: Object.fromEntries(q.criteria.map((_, i) => [i, i === 0 ? 1 : 0])) };
      else { const c = Array.isArray(q.criteria) ? q.criteria[0] : Object.keys(q.criteria)[0]; answers[k] = { choice: c, confidence: 0.5, probabilities: { [c]: 1 } }; }
    }
    return new Response(JSON.stringify({ model: "stub", answers }), { status: 200 });
  };
  try {
    const text = "已遮 [已遮] 任職。聯絡 late@example.com。做過圖書館館員三年，帶過兩位新人。";
    const r = await build({ TYPESAFE_API_KEY: "k" }, SYS, text, { pre: { "[已遮]": 3, "[信箱]": 1 } });
    eq("build：送給 Jev 的文字裡，伺服器又抓到的信箱也遮了", sent.includes("late@example.com"), false);
    eq("build：頁腳計數＝瀏覽器回報 + 伺服器自己抓到（信箱 1+1、已遮 3）", r.redacted, { "[已遮]": 3, "[信箱]": 2 });
    const r2 = await build({ TYPESAFE_API_KEY: "k" }, SYS, "做過圖書館館員三年，帶過兩位新人，負責採購與分類。", {});
    eq("build：沒有回報也沒抓到＝空", r2.redacted, {});
  } finally { globalThis.fetch = real; }
}

// 17c. 用量額度（取代人機驗證擋人）：沒通過的人照樣可以用、只是額度小；機器人繞過驗證也只拿得到小額度
{
  const { take, fresh, dayKey, limitsFrom, Quota, DEFAULTS } = await import("./src/quota.js");
  const W = (await import("./src/index.js")).default;
  // 純函式
  const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);                       // 10-01 18:00 台北
  let s = fresh(T0);
  const L = { ok: { ip: 3, day: 5 }, weak: { ip: 2, day: 3 } };
  const run = (tier, ip, now) => { const r = take(s, ip, tier, now, L); s = r.state; return r; };
  eq("額度：每 IP 每小時上限（weak 2 次，第 3 次擋）", [run("weak", "a", T0).allow, run("weak", "a", T0).allow, run("weak", "a", T0).allow], [true, true, false]);
  eq("額度：被擋的原因與多久後再試（到下一個整點）", (() => { const r = run("weak", "a", T0 + 10 * 60000); return [r.scope, r.retryAfter]; })(), ["hour", 3000]);
  eq("額度：換一個 IP 不受影響、同時 ok 與 weak 各自計", [run("weak", "b", T0).allow, run("ok", "a", T0).allow], [true, true]);
  eq("額度：全站每日上限（weak 共 3 次：a×2、b×1 已用完）", (() => { const r = run("weak", "c", T0); return [r.allow, r.scope]; })(), [false, "day"]);
  eq("額度：ok 的每日上限不被 weak 吃掉", run("ok", "z", T0).allow, true);
  const nextHour = run("weak", "a", T0 + 3600000);
  eq("額度：下一個小時 IP 計數重來（但全站每日仍是滿的）", [nextHour.allow, nextHour.scope], [false, "day"]);
  const justBefore = Date.UTC(2026, 9, 1, 15, 59, 59), justAfter = Date.UTC(2026, 9, 1, 16, 0, 0);   // 台北 23:59:59 / 00:00:00
  eq("額度：台北午夜換日", [dayKey(justBefore), dayKey(justAfter)], ["2026-10-01", "2026-10-02"]);
  eq("額度：換日後全站計數歸零", take(s, "a", "weak", justAfter, L).allow, true);
  eq("額度：每日用完時的重試秒數＝到台北午夜", (() => { const r = take({ ...fresh(T0), used: { ok: 0, weak: 3 } }, "q", "weak", T0, L); return r.retryAfter; })(), 6 * 3600);
  eq("額度：不改傳進來的 state", (() => { const st = Object.freeze({ ...fresh(T0), ips: Object.freeze({}), used: Object.freeze({ ok: 0, weak: 0 }) }); try { take(st, "a", "ok", T0, L); return true; } catch { return false; } })(), true);
  eq("額度：環境變數覆寫、壞值退回預設", [limitsFrom({ QUOTA_WEAK_IP_HOUR: "9" }).weak.ip, limitsFrom({ QUOTA_WEAK_IP_HOUR: "abc" }).weak.ip, limitsFrom({}).ok.day], [9, DEFAULTS.weak.ip, DEFAULTS.ok.day]);
  // 經過 Worker：假的 Durable Object（真的 Quota class＋記憶體儲存）、假的 Turnstile、假的 Jev
  const mkEnv = (extra = {}) => {
    const store = new Map();
    const q = new Quota({ storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); } } });
    return { TURNSTILE_SECRET: "s", TYPESAFE_API_KEY: "k", QUOTA_SALT: "salt", QUOTA_STATUS_TOKEN: "tok",
      QUOTA_WEAK_IP_HOUR: "2", QUOTA_WEAK_DAY: "3", QUOTA_OK_IP_HOUR: "5", QUOTA_OK_DAY: "6",
      QUOTA: { idFromName: () => "g", get: () => ({ fetch: (u, init) => q.fetch(new Request(u, init)) }) }, ...extra };
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: String(init.body.get("response")) === "good" }));
    const { questions } = JSON.parse(init.body), answers = {};
    for (const [k, qq] of Object.entries(questions)) {
      if (qq.type === "score") answers[k] = { score: 0, confidence: 0.5, probabilities: Object.fromEntries(qq.criteria.map((_, i) => [i, i === 0 ? 1 : 0])) };
      else { const c = Array.isArray(qq.criteria) ? qq.criteria[0] : Object.keys(qq.criteria)[0]; answers[k] = { choice: c, confidence: 0.5, probabilities: { [c]: 1 } }; }
    }
    return new Response(JSON.stringify({ model: "stub", answers }));
  };
  const post = async (env, { token, ip = "1.1.1.1", path = "/api/build" } = {}) => {
    const r = await W.fetch(new Request("https://x.test" + path, { method: "POST", headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "做過三年圖書館館員，負責採購與讀者服務。", system: "coc", locale: "zh-Hant", turnstile: token }) }), env);
    return { status: r.status, body: await r.json().catch(() => ({})), retry: r.headers.get("Retry-After") };
  };
  try {
    let env = mkEnv();
    eq("Worker：沒帶憑證也能用（不再 403）", (await post(env)).status, 200);
    eq("Worker：驗證沒過的憑證也能用（走小額度）", (await post(env, { token: "bad" })).status, 200);
    const third = await post(env);
    eq("Worker：同一個 IP 超過 weak 的小時額度 → 429 quota／hour／tier weak、帶 Retry-After", [third.status, third.body.code, third.body.scope, third.body.tier, Number(third.retry) > 0], [429, "quota", "hour", "weak", true]);
    eq("Worker：429 不洩漏內部資訊（只有 error/code/scope/tier）", Object.keys(third.body).sort(), ["code", "error", "scope", "tier"]);
    eq("Worker：換 IP 繼續用 weak，直到全站每日 weak 額度（3）用完", [(await post(env, { ip: "2.2.2.2" })).status, (await post(env, { ip: "3.3.3.3" })).body.scope], [429, "day"].map((x, i) => i === 0 ? 200 : x));
    eq("Worker：weak 被吃光，驗證通過的 ok 不受影響", (await post(env, { token: "good", ip: "4.4.4.4" })).status, 200);
    env = mkEnv();
    const oks = []; for (let i = 0; i < 6; i++) oks.push((await post(env, { token: "good" })).status);
    eq("Worker：ok 每小時 5 次，第 6 次 429", oks, [200, 200, 200, 200, 200, 429]);
    env = mkEnv();
    await post(env); await post(env);
    eq("Worker：不花錢的 /api/reroll 不吃額度", (await W.fetch(new Request("https://x.test/api/reroll", { method: "POST", body: JSON.stringify({ chars: { EDU: 60 } }), headers: { "CF-Connecting-IP": "1.1.1.1" } }), env)).status, 200);
    eq("Worker：額度狀態端點沒帶 token＝404；帶了＝看得到用量與上限", [(await W.fetch(new Request("https://x.test/api/quota-status"), env)).status,
      await (await W.fetch(new Request("https://x.test/api/quota-status", { headers: { "x-watch-token": "tok" } }), env)).json()].map((x, i) => i ? [x.used.weak, x.limits.weak.day] : x), [404, [2, 3]]);
    eq("Worker：沒設 token 就整個關掉狀態端點", (await W.fetch(new Request("https://x.test/api/quota-status", { headers: { "x-watch-token": "tok" } }), mkEnv({ QUOTA_STATUS_TOKEN: undefined }))).status, 404);
    // 額度服務壞掉：驗證過的放行、沒驗證的擋下
    const broken = mkEnv({ QUOTA: { idFromName: () => "g", get: () => { throw new Error("DO down"); } } });
    eq("Worker：額度服務故障 → ok 放行、weak 擋下（busy）", [(await post(broken, { token: "good" })).status, (await post(broken)).body.scope], [200, "busy"]);
    // 驗證服務連不上：當作沒通過，不是整站掛掉
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async (u, i) => { if (String(u).includes("siteverify")) throw new Error("net"); return realFetch2(u, i); };
    eq("Worker：Turnstile 服務連不上 → 走 weak，不是 500", (await post(mkEnv(), { token: "good" })).status, 200);
    globalThis.fetch = realFetch2;
    eq("Worker：本機沒綁 Durable Object 就不限（開發用）", (await post(mkEnv({ QUOTA: undefined }))).status, 200);
    eq("Worker：沒設 Turnstile 密鑰（本機）→ 視為 ok", (await post(mkEnv({ TURNSTILE_SECRET: undefined }), {})).status, 200);
  } finally { globalThis.fetch = real; }
}

// 18. 拖進來的檔案：docx / txt / 分類與錯誤碼（PDF 要 worker，在 e2e 測）
{
  const { extractText, kindOf, tidy, docxXmlToText, decodeText, MAX_BYTES } = await import("../public/extract.js");
  const FIX = join(HERE, "e2e", "fixtures");
  const open = (name, type = "") => new File([readFileSync(join(FIX, name))], name, { type });
  const code = async (f) => { try { await extractText(f); return "ok"; } catch (e) { return e.code || `?${e.message}`; } };

  eq("分類：副檔名與 MIME", [kindOf("a.PDF"), kindOf("a.docx"), kindOf("a.md"), kindOf("a.txt"), kindOf("a.doc"), kindOf("a.png"), kindOf("x", "application/pdf"), kindOf("noext")], ["pdf", "docx", "text", "text", null, null, "pdf", null]);
  const txt = (await extractText(open("resume.txt"))).text;
  eq("txt：讀得到內容、姓名與電話都在（遮蔽是後面一步的事）", ["林大明", "0912-345-678", "星海科技", "圖書館系統整合"].every((s) => txt.includes(s)), true);
  const big5 = (await extractText(open("resume-big5.txt"))).text;
  eq("txt：Big5 編碼也讀得出來", ["林大明", "星海科技", "資訊工程學系"].every((s) => big5.includes(s)), true);
  eq("md 也行", (await extractText(open("resume.md"))).kind, "text");
  for (const name of ["resume.docx", "resume-stored.docx"]) {
    const d = (await extractText(open(name))).text;
    eq(`${name}：段落文字`, ["林大明", "lin.daming@example.com", "地址：台北市示範區虛構路 100 號"].every((s) => d.includes(s)), true);
    eq(`${name}：tab 與換行`, d.includes("星海科技\t資深工程師\n2019–2025"), true);
    eq(`${name}：表格儲存格用 tab、列換行`, d.includes("學歷\t國立示範大學 資訊工程學系 學士\n專長\tPython"), true);
    eq(`${name}：文字方塊的內容只出現一次（Fallback 不重複）`, d.split("文字方塊裡的一句話").length - 1, 1);
    eq(`${name}：刪除的修訂文字不出現、保留的在`, [d.includes("已刪除的字"), d.includes("保留的字")], [false, true]);
    eq(`${name}：XML 跳脫還原（& < > "）`, docxXmlToText('<w:p><w:r><w:t>R&amp;D &lt;v2&gt; &quot;x&quot; &#x4e2d;&#25991;</w:t></w:r></w:p>').trim(), 'R&D <v2> "x" 中文');
  }
  eq("錯誤碼：壞掉的 docx", await code(open("not-really.docx")), "corrupt");
  eq("錯誤碼：舊版 .doc 不支援", await code(open("old.doc")), "unsupported");
  eq("錯誤碼：圖片不支援", await code(new File([new Uint8Array(10)], "a.png", { type: "image/png" })), "unsupported");
  eq("錯誤碼：字太少", await code(open("too-short.txt")), "empty");
  eq("錯誤碼：太大", await code(new File([new Uint8Array(MAX_BYTES + 1)], "big.txt", { type: "text/plain" })), "toobig");
  eq("tidy：換行統一、連續空行壓縮、零寬字元去掉", tidy("a\r\n\r\n\r\n\r\nb​  \n"), "a\n\nb");
  eq("tidy：部首字元（PDF 常見）換回一般漢字，一般字與標點不動", tidy("林⼤明 ⼿機 ⼯程師 ⽰範 專⻑ 學⼠，(a)：１２"), "林大明 手機 工程師 示範 專長 學士，(a)：１２");
  eq("decodeText：亂碼位元組不丟例外", typeof decodeText(new Uint8Array([0xff, 0xfe, 0xfd]).buffer), "string");
}

if (fails.length) {
  console.error(`✗ ${fails.length} 項不一致：`);
  for (const f of fails) console.error("   " + f);
  process.exit(1);
}
console.log(`✓ ${pass} 項全過——JS 與 Python 的計分一致`);
