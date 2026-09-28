// Owner's edits to the menu, stored in D1 (binding DB).
//   GET    /api/menu            public - all edits: { items: [...] } (the menu page applies them)
//   PUT    /api/menu            owner  - save one item's edits (JSON body, see below)
//   DELETE /api/menu?id=...     owner  - undo all edits of a menu item, or delete an added item
//
// A row only stores what differs from the menu built into index.html: a null field means
// "keep the original". Items the owner adds have is_new = 1 and carry all their fields.
// PUT body: { id, section, name_fr, name_en, desc_fr, desc_en, price, hidden, is_new,
//             photo }  where photo is a "data:image/jpeg;base64,..." string to replace the
//             photo, "" to go back to the original photo, or absent to keep it as it is.

import { json, requireAdmin } from "../../lib/admin.js";

const ID_RE = /^[a-z0-9-]{1,60}$/;
const MAX = { name: 80, desc: 400, price: 30 };
const MAX_PHOTO = 900_000; // characters of data URL (~650 KB of JPEG)

let schemaReady = null;
export function ensureMenuSchema(db) {
  if (!schemaReady) {
    schemaReady = db.prepare(
      `CREATE TABLE IF NOT EXISTS menu_items (
         id TEXT PRIMARY KEY, section TEXT, is_new INTEGER NOT NULL DEFAULT 0,
         name_fr TEXT, name_en TEXT, desc_fr TEXT, desc_en TEXT, price TEXT,
         hidden INTEGER NOT NULL DEFAULT 0, photo TEXT, photo_v INTEGER, updated_at INTEGER NOT NULL)`
    ).run().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

function field(v, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined; // invalid
  return v.replace(/\u0000/g, "").trim().slice(0, max);
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  await ensureMenuSchema(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT id, section, is_new, name_fr, name_en, desc_fr, desc_en, price, hidden, photo_v, updated_at FROM menu_items ORDER BY updated_at"
  ).all();
  const items = results.map((r) => ({
    ...r,
    is_new: !!r.is_new,
    hidden: !!r.hidden,
    photo: r.photo_v ? `/api/photo?id=${encodeURIComponent(r.id)}&v=${r.photo_v}` : null,
  }));
  return json({ items }, 200, { "cache-control": "public, max-age=5" });
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }

  const id = typeof b.id === "string" ? b.id : "";
  if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
  const row = {
    section: field(b.section, 40),
    name_fr: field(b.name_fr, MAX.name), name_en: field(b.name_en, MAX.name),
    desc_fr: field(b.desc_fr, MAX.desc), desc_en: field(b.desc_en, MAX.desc),
    price: field(b.price, MAX.price),
  };
  if (Object.values(row).includes(undefined)) return json({ error: "bad_request" }, 400);
  if (row.section !== null && !ID_RE.test(row.section)) return json({ error: "bad_section" }, 400);
  const isNew = b.is_new === true;
  if (isNew && (!row.section || !row.name_fr)) return json({ error: "name_and_section_required" }, 400);
  const hidden = b.hidden === true ? 1 : 0;

  await ensureMenuSchema(env.DB);
  const now = Date.now();
  let photoSql = "photo = photo, photo_v = photo_v";
  const binds = [];
  if (b.photo === "") {
    photoSql = "photo = NULL, photo_v = NULL";
  } else if (typeof b.photo === "string") {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) || b.photo.length > MAX_PHOTO) {
      return json({ error: "bad_photo" }, 400);
    }
    photoSql = "photo = ?, photo_v = ?";
    binds.push(b.photo, now);
  }

  await env.DB.prepare(
    `INSERT INTO menu_items (id, section, is_new, name_fr, name_en, desc_fr, desc_en, price, hidden, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET section = excluded.section, is_new = excluded.is_new,
       name_fr = excluded.name_fr, name_en = excluded.name_en, desc_fr = excluded.desc_fr,
       desc_en = excluded.desc_en, price = excluded.price, hidden = excluded.hidden,
       updated_at = excluded.updated_at`
  ).bind(id, row.section, isNew ? 1 : 0, row.name_fr, row.name_en, row.desc_fr, row.desc_en, row.price, hidden, now).run();
  await env.DB.prepare(`UPDATE menu_items SET ${photoSql} WHERE id = ?`).bind(...binds, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
  await ensureMenuSchema(env.DB);
  await env.DB.prepare("DELETE FROM menu_items WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
