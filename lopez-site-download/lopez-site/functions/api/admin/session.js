// GET /api/admin/session  -> { signedIn, mustChange }  (lets /admin/ know whether to show the login)

import { json, noDb, getSession } from "../../../lib/admin.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return noDb();
  const s = await getSession(request, env);
  return json({ signedIn: !!s, mustChange: s ? s.mustChange : false });
}
