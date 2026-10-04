// 角色頁「加一項技能」的瀏覽器測試。由 wiring.mjs 載入：export async function run({ session, FULL, BASE, ok, wait, W, PACKS })
export async function run({ session, FULL, BASE, ok, W, PACKS }) {
  const { page } = await session({ config: FULL });
  const add = async (name, val) => {
    await page.$eval("#as-name", (e) => { e.value = ""; });
    await page.$eval("#as-val", (e) => { e.value = ""; });
    await page.type("#as-name", name);
    await page.type("#as-val", String(val));
    await page.click("#as-add");
  };
  const text = () => page.$eval("#text", (e) => e.value);
  const claimed = async (lang) => W.parseCharacter(await text(), PACKS[lang].sections, W.charAliases(PACKS[lang])).claimed;
  const msg = () => page.$eval("#as-msg", (e) => e.textContent);

  await page.goto(BASE + "/character?lang=en", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelectorAll("#as-list option").length > 50);
  ok("D 選單載入（英文技能清單）", (await page.$$eval("#as-list option", (e) => e.map((o) => o.value))).includes("Library Use"));
  ok("D 有兩頁互相指路的一行", await page.$eval(".hero-alt a", (e) => e.getAttribute("href") === "./"));

  // 1 空文字框：補出 [Skills] 區塊
  await add("Library Use", 70);
  ok("D 空文字框 → 自動補 [Skills] 區塊", (await text()).trim() === "[Skills]\nLibrary Use 70", JSON.stringify(await text()));
  // 2 同名換值、不重複
  await add("Library Use", 55);
  ok("D 同名技能換值而不是重複", (await text()).match(/Library Use/g).length === 1 && (await text()).includes("Library Use 55"));
  // 3 區塊在中間：插在區塊尾、下一個區塊之前
  await page.$eval("#text", (e) => { e.value = "[Backstory]\nShe reads a lot.\n\n[Skills]\nPersuade 65\n\n[Stats]\nEDU 65  INT 70\n"; });
  await add("Fast Talk", 60);
  const t3 = await text();
  ok("D 插在技能區塊尾端、不跑進下一個區塊",
     t3.indexOf("Fast Talk 60") > t3.indexOf("Persuade 65") && t3.indexOf("Fast Talk 60") < t3.indexOf("[Stats]"),
     JSON.stringify(t3.slice(t3.indexOf("[Skills]"))));
  const c3 = await claimed("en");
  ok("D 真的解析器讀得到新技能，原有的也在", c3["Fast Talk"] === 60 && c3["Persuade"] === 65 && Object.keys(c3).length === 2, JSON.stringify(c3));
  ok("D 特性值沒被弄壞", JSON.stringify(W.parseCharacter(t3, PACKS.en.sections, W.charAliases(PACKS.en)).chars) === '{"EDU":65,"INT":70}');
  // 4 未知技能：照樣加，但提醒
  await add("Basket Weaving", 30);
  ok("D 未知技能：加入並提醒「不在系統包」", (await text()).includes("Basket Weaving 30") && (await msg()).includes("not in this system pack"));
  // 5 驗證
  await page.$eval("#as-name", (e) => { e.value = ""; });
  await page.$eval("#as-val", (e) => { e.value = ""; });
  await page.click("#as-add");
  ok("D 沒填名稱 → 提示", (await msg()).includes("skill name"));
  await add("Climb", 150);
  ok("D 值超出範圍 → 提示、不加入", !(await text()).includes("Climb") && (await msg()).includes("0 to 99"));
  // 6 Enter 鍵
  await page.$eval("#as-name", (e) => { e.value = "Climb"; });
  await page.$eval("#as-val", (e) => { e.value = ""; });
  await page.type("#as-val", "40");
  await page.keyboard.press("Enter");
  ok("D 在數值欄按 Enter 也能加入", (await text()).includes("Climb 40"));
  // 7 日文：補【スキル】，別名「外国語」認得
  await page.click('button.lang[data-lang="ja"]');
  await page.waitForFunction(() => [...document.querySelectorAll("#as-list option")].some((o) => o.value === "図書館"));
  await page.$eval("#text", (e) => { e.value = ""; });
  await add("外国語", 50);
  await add("図書館", 60);
  const cj = await claimed("ja");
  ok("D 日文：補【スキル】區塊、別名「外国語」可用", (await text()).startsWith("【スキル】") && cj["外国語"] === 50 && cj["図書館"] === 60, JSON.stringify(cj));
  ok("D 日文：「外国語」比對到外語、不是未知", W.matchSkillId(PACKS.ja, "外国語") === "外語");
  await page.close();
}
