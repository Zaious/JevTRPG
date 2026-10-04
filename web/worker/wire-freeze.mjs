// 分享連結編碼表的「凍結」。歷代的表存在 wire-frozen.js（只增不改），解碼舊連結時用。
//
//   node wire-freeze.mjs                    把目前的系統包凍結成新的一代（改了技能／職業／背景選項之後、部署之前跑）
//   node wire-freeze.mjs --legacy <舊的 system.js>   把一份舊的系統包補進歷史（放在最前面；救已經發出去的連結用）
//   node wire-freeze.mjs --check            只檢查：目前的表已凍結、凍結版裡的項目都還在（test.mjs 也會跑）
//
// 為什麼：連結只記「第幾項」。表一變，舊連結的「第幾項」就對不上——所以每一代表都要留著，
// 連結上有指紋，Worker 依指紋給對應那一代。但只留著表不夠：若把技能或職業從系統包刪掉，舊連結還是
// 會指到不存在的東西，所以「刪除」會被擋下（改名也是刪除＋新增）；只能新增。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { listsOf, fpOf } from "./src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "wire-frozen.js");
const LOCALES = ["zh-Hant", "en", "ja"];

export async function loadFrozen() {
  return existsSync(FILE) ? structuredClone((await import(pathToFileURL(FILE).href + "?t=" + Date.now())).default) : {};
}

/** @returns {string[]} 問題清單；空＝沒問題 */
export function problems(frozen, PACK) {
  const bad = [];
  for (const loc of LOCALES) {
    const cur = listsOf(PACK[loc]), gens = frozen[loc] || [];
    if (!gens.length || fpOf(gens[gens.length - 1]) !== fpOf(cur))
      bad.push(`${loc}：目前的表（指紋 ${fpOf(cur)}）還沒凍結——跑 node wire-freeze.mjs，再一起提交`);
    gens.forEach((g, i) => {
      const miss = (what, list, have) => list.filter((x) => !have.includes(x)).forEach((x) => bad.push(`${loc} 第 ${i + 1} 代：${what}「${x}」在目前的系統包已不存在（舊連結會指到它）——只能新增，不能刪除或改名`));
      miss("特性值", g.chars, cur.chars); miss("衍生值", g.derived, cur.derived); miss("年代", g.eras, cur.eras); miss("技能", g.skills, cur.skills);
      for (const e of g.eras) miss(`職業(${e})`, g.occ[e], cur.occ[e] || []);
      for (const b of g.bs) {
        const cb = cur.bs.find((x) => x.title === b.title);
        if (!cb) bad.push(`${loc} 第 ${i + 1} 代：背景欄位「${b.title}」已不存在`); else miss(`背景選項(${b.title})`, b.options, cb.options);
      }
    });
  }
  return bad;
}

function write(frozen) {
  writeFileSync(FILE, "// 由 wire-freeze.mjs 產生：分享連結編碼表的歷代版本（最舊在前）。只增不改，說明見該檔。\nexport default " + JSON.stringify(frozen, null, 1) + ";\n", "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PACK = (await import("./system.js")).default.coc;
  const frozen = await loadFrozen();
  const args = process.argv.slice(2);
  if (args[0] === "--legacy") {
    const old = (await import(pathToFileURL(resolve(args[1])).href)).default.coc;
    for (const loc of LOCALES) {
      const l = listsOf(old[loc]);
      frozen[loc] ||= [];
      if (!frozen[loc].some((g) => fpOf(g) === fpOf(l))) { frozen[loc].unshift(l); console.log(`${loc}：補進舊版（指紋 ${fpOf(l)}）`); }
    }
    write(frozen);
  } else if (args[0] !== "--check") {
    for (const loc of LOCALES) {
      const l = listsOf(PACK[loc]);
      frozen[loc] ||= [];
      const last = frozen[loc][frozen[loc].length - 1];
      if (!last || fpOf(last) !== fpOf(l)) { frozen[loc].push(l); console.log(`${loc}：凍結新的一代（指紋 ${fpOf(l)}，共 ${frozen[loc].length} 代）`); }
    }
    write(frozen);
  }
  const bad = problems(await loadFrozen(), PACK);
  if (bad.length) { console.error("✗\n" + bad.join("\n")); process.exit(1); }
  console.log("✓ 凍結表與目前的系統包一致");
}
