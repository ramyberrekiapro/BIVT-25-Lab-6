// Menu categories, managed on /admin/ (owner only). The public menu reads them from GET /api/menu.
//   PUT /api/sections  { sections: [{ id, title_fr, title_en }, ...] }
//     The complete list of categories, in menu order. A built-in category left out is removed,
//     an id "cat-xxxx" not seen before is added. Any category can be removed, built-in ones too;
//     a removed built-in category is stored with removed = 1 so it stays removed across reloads and
//     redeploys. Its items disappear from the customer menu but are not deleted: the admin lists them
//     under "No category", where they can be moved to another category.
//     -> { ok, sections: [...] } read back from D1

import { json, requireAdmin } from "../../lib/admin.js";
import { ensureMenuSchema } from "./menu.js";
import {
  NEW_SECTION_RE, MAX_SECTIONS, MAX_TITLE,
  loadDefaults, storedSections, effectiveSections,
} from "../../lib/sections.js";

function title(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") return null;
  return v.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

export async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const list = b && b.sections;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SECTIONS) return json({ error: "bad_request" }, 400);

  const defaults = await loadDefaults(request, env);
  await ensureMenuSchema(env.DB);
  const rows = await storedSections(env.DB);
  const defById = new Map(defaults.sections.map((s) => [s.id, s]));
  const current = effectiveSections(defaults, rows);
  const known = new Set(current.map((s) => s.id));

  const clean = [];
  const ids = new Set();
  for (const s of list) {
    const id = s && typeof s.id === "string" ? s.id : "";
    if (ids.has(id)) return json({ error: "bad_request" }, 400);
    if (!defById.has(id) && !known.has(id) && !NEW_SECTION_RE.test(id)) return json({ error: "bad_id" }, 400);
    const fr = title(s.title_fr), en = title(s.title_en);
    if (fr === null || en === null) return json({ error: "bad_request" }, 400);
    if (!fr) return json({ error: "category_name_required", id }, 400);
    ids.add(id);
    clean.push({ id, fr, en });
  }

  // built-in categories left out of the list are stored as removed
  const removed = defaults.sections.map((s) => s.id).filter((id) => !ids.has(id));

  const now = Date.now();
  const ins = env.DB.prepare(
    "INSERT INTO menu_sections (id, position, is_new, title_fr, title_en, removed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const stmts = [env.DB.prepare("DELETE FROM menu_sections")];
  clean.forEach((s, i) => {
    const d = defById.get(s.id);
    // built-in names are stored as null while unchanged, so they follow the site's own text
    const fr = d && s.fr === d.title_fr ? null : s.fr;
    const en = d && s.en === (d.title_en || "") ? null : s.en;
    stmts.push(ins.bind(s.id, i, d ? 0 : 1, fr, en, 0, now));
  });
  removed.forEach((id, i) => stmts.push(ins.bind(id, 1000 + i, 0, null, null, 1, now)));
  await env.DB.batch(stmts); // one transaction

  return json({ ok: true, sections: await storedSections(env.DB) });
}
