// Café contact details shown on the menu (contact section and top of the page).
//   GET /api/site   public -> { instagram, maps, phone }   ("" = not shown)
//   PUT /api/site   owner  -> same fields; returns the saved values read back from D1
// Stored in D1 table site_settings (key "contact"). Until the owner saves them, the built-in
// Instagram and Google Maps links are used and no phone number is shown.

import { json, requireAdmin, noDb } from "../../lib/admin.js";

const DEFAULTS = {
  instagram: "https://www.instagram.com/lopezcoffeebrunch",
  maps: "https://maps.app.goo.gl/iDiVehnUwiYFkFbt8?g_st=ic",
  phone: "",
};

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.prepare("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
      .run().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

async function readContact(db) {
  await ensureSchema(db);
  const v = await db.prepare("SELECT value FROM site_settings WHERE key = 'contact'").first("value");
  let saved = {};
  try { saved = v ? JSON.parse(v) : {}; } catch { saved = {}; }
  return { ...DEFAULTS, ...saved };
}

// "@lopez", "lopez" or "https://www.instagram.com/lopez/" -> "https://www.instagram.com/lopez"
function instagram(v) {
  v = v.trim();
  if (!v) return "";
  let handle = null;
  const m = v.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i);
  if (m) handle = m[1];
  else if (/^@?[A-Za-z0-9._]{1,30}$/.test(v)) handle = v.replace(/^@/, "");
  return handle ? "https://www.instagram.com/" + handle : null;
}

// a Google Maps link (maps.app.goo.gl, goo.gl/maps, google.<tld>/maps, maps.google.<tld>)
function maps(v) {
  v = v.trim();
  if (!v) return "";
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || v.length > 500) return null;
  const h = u.hostname.toLowerCase();
  const ok = h === "maps.app.goo.gl" || (h === "goo.gl" && u.pathname.startsWith("/maps"))
    || /^maps\.google\.[a-z.]{2,6}$/.test(h)
    || (/^(www\.)?google\.[a-z.]{2,6}$/.test(h) && u.pathname.startsWith("/maps"));
  return ok ? u.toString() : null;
}

function phone(v) {
  v = v.replace(/\s+/g, " ").trim();
  if (!v) return "";
  const digits = v.replace(/\D/g, "").length;
  return /^\+?[0-9 ().-]{6,24}$/.test(v) && digits >= 6 && digits <= 15 ? v : null;
}

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  return json(await readContact(env.DB));
}

export async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!b || ["instagram", "maps", "phone"].some((k) => typeof b[k] !== "string")) return json({ error: "bad_request" }, 400);
  const value = { instagram: instagram(b.instagram), maps: maps(b.maps), phone: phone(b.phone) };
  for (const k of Object.keys(value)) if (value[k] === null) return json({ error: "bad_" + k }, 400);
  await ensureSchema(env.DB);
  await env.DB.prepare(
    "INSERT INTO site_settings (key, value) VALUES ('contact', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(JSON.stringify(value)).run();
  return json({ ok: true, ...(await readContact(env.DB)) });
}
