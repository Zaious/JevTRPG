/**
 * 用量上限：取代「人機驗證沒過就整個擋掉」。
 *
 * 為什麼：判讀的入口是公開的，每次要付 API 費。人機驗證擋機器人，但也會擋到真人
 * （2026-10-01～02 實測：Windows 桌面版 Chrome 一再出錯，那些人完全用不了）。
 * 改成兩條額度，驗證沒過的人不被擋，只是額度小；機器人繞過驗證也只拿得到小額度：
 *
 *   ok   人機驗證通過（或本機開發沒設驗證）：每個 IP 每小時 30 次、全站每天 2000 次
 *   weak 沒帶憑證／驗證沒過：每個 IP 每小時 4 次、全站每天 150 次
 *
 * 最壞情況的花費 ≈ (2000 + 150) × 單次成本，有上限；數字都是 wrangler.toml 的變數，可調。
 * 全站每天的計數以台北時間午夜重置。IP 只存雜湊（見 index.js），每小時的計數過了就清掉。
 *
 * 這個檔案不 import 任何 cloudflare: 模組，所以 Node 測試可以直接跑；Durable Object 是普通 class。
 */
export const DEFAULTS = { ok: { ip: 30, day: 2000 }, weak: { ip: 4, day: 150 } };
const HOUR = 3600 * 1000, TAIPEI = 8 * HOUR;

export const dayKey = (now) => new Date(now + TAIPEI).toISOString().slice(0, 10);
const hourId = (now) => Math.floor(now / HOUR);
const secsToNextHour = (now) => Math.max(1, Math.ceil(((hourId(now) + 1) * HOUR - now) / 1000));
const secsToNextDay = (now) => Math.max(1, Math.ceil((Math.floor((now + TAIPEI) / (24 * HOUR)) * 24 * HOUR + 24 * HOUR - TAIPEI - now) / 1000));

export function limitsFrom(env = {}) {
  const n = (v, d) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) >= 0 ? parseInt(v, 10) : d);
  return {
    ok: { ip: n(env.QUOTA_OK_IP_HOUR, DEFAULTS.ok.ip), day: n(env.QUOTA_OK_DAY, DEFAULTS.ok.day) },
    weak: { ip: n(env.QUOTA_WEAK_IP_HOUR, DEFAULTS.weak.ip), day: n(env.QUOTA_WEAK_DAY, DEFAULTS.weak.day) },
  };
}

export const fresh = (now) => ({ day: dayKey(now), used: { ok: 0, weak: 0 }, hour: hourId(now), ips: {} });

/** 純函式：算「這一次放不放行」與新的狀態。不改傳進來的 state。
 *  @returns {{ allow: boolean, scope?: "hour"|"day", retryAfter?: number, state: object }} */
export function take(prev, ipKey, tier, now, limits = DEFAULTS) {
  const lim = limits[tier] || limits.weak;
  const s = { day: prev.day, used: { ...prev.used }, hour: prev.hour, ips: { ...prev.ips } };
  if (s.day !== dayKey(now)) { s.day = dayKey(now); s.used = { ok: 0, weak: 0 }; }          // 台北午夜：全站計數歸零
  if (s.hour !== hourId(now)) { s.hour = hourId(now); s.ips = {}; }                         // 每小時：IP 計數整個清掉（也就不會一直累積）
  const k = `${tier}:${ipKey}`;
  if ((s.ips[k] || 0) >= lim.ip) return { allow: false, scope: "hour", retryAfter: secsToNextHour(now), state: s };
  if (s.used[tier] >= lim.day) return { allow: false, scope: "day", retryAfter: secsToNextDay(now), state: s };
  s.ips[k] = (s.ips[k] || 0) + 1;
  s.used[tier] += 1;
  return { allow: true, state: s };
}

/** Durable Object：全站只有一個實例（名字固定），所以計數是精確的、不會因為多個節點各數各的而漏掉。 */
export class Quota {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const now = Date.now();
    const url = new URL(request.url);
    const cur = (await this.state.storage.get("s")) || fresh(now);
    if (url.pathname === "/take") {
      const { ip, tier, limits } = await request.json();
      const r = take(cur, String(ip), tier === "ok" ? "ok" : "weak", now, limits);
      await this.state.storage.put("s", r.state);
      return Response.json({ allow: r.allow, scope: r.scope, retryAfter: r.retryAfter });
    }
    if (url.pathname === "/status") {
      const s = cur.day === dayKey(now) ? cur : fresh(now);
      return Response.json({ day: s.day, used: s.used });
    }
    return new Response("not found", { status: 404 });
  }
}
