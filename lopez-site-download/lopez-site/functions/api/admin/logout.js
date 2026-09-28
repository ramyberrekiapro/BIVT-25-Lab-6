// POST /api/admin/logout  -> ends the owner session.

import { json, endSession, clearSessionCookie } from "../../../lib/admin.js";

export async function onRequestPost({ request, env }) {
  await endSession(request, env);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}
