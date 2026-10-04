// Runs around every /api/* route: an unexpected error (e.g. a D1 query failing) becomes a JSON
// error instead of Cloudflare's HTML error page, so the admin can show what went wrong.

import { json } from "../../lib/admin.js";

export async function onRequest({ next }) {
  try {
    return await next();
  } catch (e) {
    console.error("api error:", e && e.stack || e);
    const msg = String(e && e.message || e);
    return json({ error: /D1|SQLITE/i.test(msg) ? "database_error" : "server_error" }, 500);
  }
}
