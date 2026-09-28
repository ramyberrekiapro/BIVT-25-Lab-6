// Owner authentication, shared by all server routes. Everything is stored in D1 (binding DB).
//
// Password
//   - Initial password: the Cloudflare secret ADMIN_PASSWORD (e.g. "0000"). It is only accepted
//     while no owner password has been set, and such a session must change the password first.
//   - Owner password: set on /admin/, stored in D1 as a salted PBKDF2-SHA256 hash
//     (table admin_settings, key "password"). From then on ADMIN_PASSWORD is ignored.
//   - Forgotten password: in the D1 console run  DELETE FROM admin_settings WHERE key = 'password';
//     then sign in with ADMIN_PASSWORD again (and set a new password).
//
// Session
//   - Signing in creates a random session token. The browser keeps it in an HttpOnly, Secure,
//     SameSite=Strict cookie (not readable by page scripts); D1 keeps only its SHA-256 hash.
//   - Changing the password ends every other session.
//
// Wrong passwords are counted per IP; 10 within 15 minutes lock sign-in for that IP.

const LOGIN_FAILS_MAX = 10;
const LOGIN_WINDOW_S = 900;
const SESSION_TTL_S = 12 * 3600;
const PBKDF2_ITERATIONS = 100000;     // maximum allowed by Cloudflare Workers
export const COOKIE = "lopez_owner";
export const MIN_PASSWORD_LENGTH = 8;

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
      db.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        must_change INTEGER NOT NULL DEFAULT 0)`),
    ]).catch((e) => { authSchema = null; throw e; });
  }
  return authSchema;
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const now = () => Math.floor(Date.now() / 1000);

export async function ipKey(request, salt) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(salt + ":" + ip))).slice(0, 24);
}

function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

async function verifyHash(password, stored) {
  const [alg, iter, salt, hash] = String(stored).split("$");
  if (alg !== "pbkdf2" || !hash) return false;
  return safeEqual(await pbkdf2(password, unhex(salt), parseInt(iter, 10)), hash);
}

async function storedPasswordHash(db) {
  return db.prepare("SELECT value FROM admin_settings WHERE key = 'password'").first("value");
}

// Checks a password. Returns { ok, mustChange } or an error Response.
export async function checkPassword(request, env, password) {
  if (!env.DB) return noDb();
  await ensureAuthSchema(env.DB);
  const t = now();
  const ip = await ipKey(request, "admin");
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_fails WHERE ip = ? AND at > ?")
    .bind(ip, t - LOGIN_WINDOW_S).first("n");
  if (fails >= LOGIN_FAILS_MAX) return json({ error: "too_many_attempts" }, 429);

  const stored = await storedPasswordHash(env.DB);
  let ok = false, mustChange = false;
  if (typeof password === "string" && password.length > 0 && password.length <= 200) {
    if (stored) ok = await verifyHash(password, stored);
    else if (env.ADMIN_PASSWORD) { ok = safeEqual(password, env.ADMIN_PASSWORD); mustChange = true; }
    else return json({ error: "ADMIN_PASSWORD is not set" }, 503);
  }
  if (!ok) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_fails (ip, at) VALUES (?, ?)").bind(ip, t),
      env.DB.prepare("DELETE FROM admin_fails WHERE at < ?").bind(t - LOGIN_WINDOW_S),
    ]);
    return json({ error: "unauthorized" }, 401);
  }
  return { ok: true, mustChange };
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function createSession(env, mustChange) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at, must_change) VALUES (?, ?, ?, ?)")
      .bind(hex(await crypto.subtle.digest("SHA-256", enc.encode(token))), t, t + SESSION_TTL_S, mustChange ? 1 : 0),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(t),
  ]);
  return cookieHeader(token, SESSION_TTL_S);
}

export function clearSessionCookie() {
  return cookieHeader("", 0);
}

function sessionToken(request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([0-9a-f]{64})"));
  return m ? m[1] : null;
}

// The current session, or null. { tokenHash, mustChange }
export async function getSession(request, env) {
  if (!env.DB) return null;
  const token = sessionToken(request);
  if (!token) return null;
  await ensureAuthSchema(env.DB);
  const tokenHash = hex(await crypto.subtle.digest("SHA-256", enc.encode(token)));
  const row = await env.DB.prepare("SELECT must_change FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, now()).first();
  return row ? { tokenHash, mustChange: !!row.must_change } : null;
}

export async function endSession(request, env) {
  const s = await getSession(request, env);
  if (s) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(s.tokenHash).run();
}

// Sets the owner's password (hash in D1) and ends every other session.
export async function setPassword(env, session, password) {
  await ensureAuthSchema(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO admin_settings (key, value) VALUES ('password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(await hashPassword(password)),
    env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash != ?").bind(session.tokenHash),
    env.DB.prepare("UPDATE admin_sessions SET must_change = 0 WHERE token_hash = ?").bind(session.tokenHash),
  ]);
}

// Guard for owner-only routes. Returns null when allowed, otherwise the error Response.
// Changes (anything but GET) must also carry the header "X-Lopez-Owner: 1" (a cross-site form
// cannot send it), in addition to the SameSite=Strict session cookie.
export async function requireAdmin(request, env) {
  if (!env.DB) return noDb();
  const s = await getSession(request, env);
  if (!s) return json({ error: "unauthorized" }, 401);
  if (s.mustChange) return json({ error: "password_change_required" }, 403);
  if (request.method !== "GET" && request.headers.get("x-lopez-owner") !== "1") return json({ error: "forbidden" }, 403);
  return null;
}
