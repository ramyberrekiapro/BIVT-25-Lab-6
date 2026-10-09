// Menu categories. The categories built into the site come from public/menu-data.json; the
// owner's changes (order, names, added and removed categories) are stored in the D1 table
// menu_sections. When the table is empty the built-in categories are used as they are.
//
// menu_sections row: id, position (order on the menu), is_new (added by the owner),
// title_fr / title_en (null = keep the built-in name), removed (built-in category removed).

export const NEW_SECTION_RE = /^cat-[a-z0-9]{4,20}$/;
export const MAX_SECTIONS = 60;
export const MAX_TITLE = 60;

let schemaReady = null;
export function ensureSectionsSchema(db) {
  if (!schemaReady) {
    schemaReady = db.prepare(
      `CREATE TABLE IF NOT EXISTS menu_sections (
         id TEXT PRIMARY KEY, position INTEGER NOT NULL, is_new INTEGER NOT NULL DEFAULT 0,
         title_fr TEXT, title_en TEXT, removed INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`
    ).run().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// The built-in menu (public/menu-data.json), read from the site's own static files.
export async function loadDefaults(request, env) {
  const r = await env.ASSETS.fetch(new URL("/menu-data.json", request.url));
  if (!r.ok) throw new Error("menu-data.json not found (" + r.status + ")");
  return r.json();
}

export async function storedSections(db) {
  await ensureSectionsSchema(db);
  const { results } = await db.prepare(
    "SELECT id, position, is_new, title_fr, title_en, removed FROM menu_sections ORDER BY position"
  ).all();
  return results.map((r) => ({ ...r, is_new: !!r.is_new, removed: !!r.removed }));
}

// Categories currently on the menu, in order: [{ id, is_new, title_fr, title_en }]
export function effectiveSections(defaults, rows) {
  const def = new Map(defaults.sections.map((s) => [s.id, s]));
  const seen = new Set(rows.map((r) => r.id));
  const out = [];
  for (const r of rows) {
    if (r.removed) continue;
    const d = def.get(r.id);
    if (!d && !r.is_new) continue;
    out.push({
      id: r.id, is_new: !d,
      title_fr: r.title_fr ?? (d ? d.title_fr : ""),
      title_en: r.title_en ?? (d ? d.title_en : ""),
    });
  }
  // built-in categories the stored layout does not mention yet go at the end
  for (const d of defaults.sections) {
    if (!seen.has(d.id)) out.push({ id: d.id, is_new: false, title_fr: d.title_fr, title_en: d.title_en });
  }
  return out;
}
