/**
 * 社群預覽與搜尋用的 <head> 文字（英文、日文）。
 *
 * 為什麼要有：HTML 裡寫死的是繁中（SEO 與預設預覽）。但 Twitter／Discord／LINE 的爬蟲不跑 JS，
 * 也沒有 Accept-Language，所以分享 `/?lang=en` 時預覽卡仍會是中文。Worker 看到 ?lang=en／ja 就用這份
 * 重寫 <head>（HTMLRewriter），預覽卡就是該語言。繁中維持 HTML 原文。
 *
 * title 必須等於 i18n.js 的 docTitle*（test.mjs 會比對，不讓兩邊漂開）。
 * ESM：Worker 直接 import；測試也讀這份。
 */
export const META = {
  en: {
    resume: {
      title: "Turn your résumé into a TRPG investigator sheet with Jev | JevTRPG",
      desc: "Paste your résumé and Jev, TypeSafe's judgment model, reads your occupation and skill values in d100 tabletop rules and prints them as a 1920s-style investigator sheet. Nothing is stored or logged.",
      ogTitle: "Turn your résumé into a TRPG investigator sheet",
      ogDesc: "What is your work history worth in a d100 tabletop game?",
    },
    character: {
      title: "Check a character's skills with Jev: the Keeper's review | JevTRPG",
      desc: "Paste a character's backstory and Jev, TypeSafe's judgment model, flags which skills the backstory supports and which the Keeper should ask about, and checks whether the points are overspent. For Call of Cthulhu-style d100 games.",
      ogTitle: "Does your backstory support your skill sheet? Ask Jev",
      ogDesc: "A Keeper's check for investigator sheets: which skills the backstory can't support, and whether the points are overspent.",
    },
    privacy: {
      title: "About and privacy | JevTRPG",
      desc: "How JevTRPG handles the text you paste, what it records, how ads and analytics work, and ChronicleCore Studio's statement.",
      ogTitle: "About and privacy | JevTRPG",
      ogDesc: "How JevTRPG handles the text you paste, what it records, how ads and analytics work, and ChronicleCore Studio's statement.",
    },
  },
  ja: {
    resume: {
      title: "Jev で履歴書を TRPG の探索者シートに｜JevTRPG",
      desc: "履歴書を貼ると、TypeSafe の判定モデル Jev が d100 系 TRPG のルールでの職業と技能値を読み取り、1920 年代風の探索者シートに印刷します。履歴書は保存も記録もしません。",
      ogTitle: "Jev で履歴書を TRPG の探索者シートに",
      ogDesc: "あなたの職歴は、TRPG のルールで何ポイント？",
    },
    character: {
      title: "Jev でキャラの技能をチェック：KP 審査票｜JevTRPG",
      desc: "キャラクターの背景を貼ると、TypeSafe の判定モデル Jev が、背景に裏付けのある技能と KP が確認すべき技能を判定し、ポイントの使いすぎも計算します。COC／d100 系 TRPG 向け。",
      ogTitle: "背景は技能表を支えられる？ Jev に聞く",
      ogDesc: "KP 向けのキャラクター審査ツール：背景の裏付けがない技能と、ポイントの超過を確認します。",
    },
    privacy: {
      title: "運営者情報とプライバシー｜JevTRPG",
      desc: "JevTRPG が貼り付けたテキストをどう扱うか、記録する情報、広告・分析ツール、編年史記工作室の表明について。",
      ogTitle: "運営者情報とプライバシー｜JevTRPG",
      ogDesc: "JevTRPG が貼り付けたテキストをどう扱うか、記録する情報、広告・分析ツール、編年史記工作室の表明について。",
    },
  },
};
export const OG_LOCALE = { en: "en_US", ja: "ja_JP" };
export const PAGE_OF = { "/": "resume", "/index.html": "resume", "/character": "character", "/character.html": "character", "/privacy": "privacy", "/privacy.html": "privacy" };
