// Shared helpers for the owner-only API endpoints.
// The owner signs in on /admin/ with ADMIN_PASSWORD (a secret in the Pages project);
// the page sends it as "Authorization: Bearer <password>". Wrong passwords are counted
// per IP in the MESSAGES KV namespace and locked out for 15 minutes after 10 attempts.

const LOGIN_FAILS_MAX = 10;
const LOGIN_WINDOW_S = 900;

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Returns null when the request carries the right password, otherwise the error Response.
export async function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not set" }, 503);
  if (!env.MESSAGES) return json({ error: "storage_not_configured" }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const failKey = `fail:${ip}`;
  const fails = parseInt((await env.MESSAGES.get(failKey)) || "0", 10);
  if (fails >= LOGIN_FAILS_MAX) return json({ error: "too_many_attempts" }, 429);
  const auth = request.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !safeEqual(given, env.ADMIN_PASSWORD)) {
    await env.MESSAGES.put(failKey, String(fails + 1), { expirationTtl: LOGIN_WINDOW_S });
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}
