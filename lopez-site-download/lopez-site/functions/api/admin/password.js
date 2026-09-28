// POST /api/admin/password  { current, next }  -> sets the owner's own password.
// Needs a session (also one opened with the initial password), the current password again,
// and the header "X-Lopez-Owner: 1". Ends all other sessions.

import { json, noDb, getSession, checkPassword, setPassword, MIN_PASSWORD_LENGTH } from "../../../lib/admin.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  if (request.headers.get("x-lopez-owner") !== "1") return json({ error: "forbidden" }, 403);
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const next = typeof body.next === "string" ? body.next : "";

  const r = await checkPassword(request, env, body.current);
  if (r instanceof Response) return r.status === 401 ? json({ error: "wrong_current_password" }, 401) : r;

  if (next.length < MIN_PASSWORD_LENGTH || next.length > 200) return json({ error: "password_too_short", min: MIN_PASSWORD_LENGTH }, 400);
  if (next === body.current || (env.ADMIN_PASSWORD && next === env.ADMIN_PASSWORD)) return json({ error: "password_not_new" }, 400);

  await setPassword(env, session, next);
  return json({ ok: true });
}
