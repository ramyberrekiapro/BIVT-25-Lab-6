// POST /api/admin/login  { password }  -> sets the owner session cookie.
// Response: { ok: true, mustChange }  (mustChange = signed in with the initial ADMIN_PASSWORD)

import { json, checkPassword, createSession } from "../../../lib/admin.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const r = await checkPassword(request, env, body.password);
  if (r instanceof Response) return r;
  const cookie = await createSession(env, r.mustChange);
  return json({ ok: true, mustChange: r.mustChange }, 200, { "set-cookie": cookie });
}
