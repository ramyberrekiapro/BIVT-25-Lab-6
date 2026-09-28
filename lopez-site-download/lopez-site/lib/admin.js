// Shared helpers for the server endpoints.
// Everything is stored in one D1 database (binding DB). The owner signs in on /admin/ with
// ADMIN_PASSWORD (a secret in the Pages project); the page sends it as
// "Authorization: Bearer <password>". Wrong passwords are counted per IP and locked out for
// 15 minutes after 10 attempts.

const LOGIN_FAILS_MAX = 10;
const LOGIN_WINDOW_S = 900;

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export function noDb() {
  return json({ error: "database_not_configured" }, 503);
}

let authSchema = null;
function ensureAuthSchema(db) {
  if (!authSchema) {
    authSchema = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS admin_fails (ip TEXT NOT NULL, at INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS admin_fails_ip ON admin_fails (ip, at)"),
    ]).catch((e) => { authSchema = null; throw e; });
  }
  return authSchema;
}

export async function ipKey(request, salt) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + ip));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Returns null when the request carries the right password, otherwise the error Response.
export async function requireAdmin(request, env) {
  if (!env.DB) return noDb();
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not set" }, 503);
  await ensureAuthSchema(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const ip = await ipKey(request, "admin");
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_fails WHERE ip = ? AND at > ?")
    .bind(ip, now - LOGIN_WINDOW_S).first("n");
  if (fails >= LOGIN_FAILS_MAX) return json({ error: "too_many_attempts" }, 429);
  const auth = request.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !safeEqual(given, env.ADMIN_PASSWORD)) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_fails (ip, at) VALUES (?, ?)").bind(ip, now),
      env.DB.prepare("DELETE FROM admin_fails WHERE at < ?").bind(now - LOGIN_WINDOW_S),
    ]);
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}
