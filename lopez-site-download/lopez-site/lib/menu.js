// The menu as customers currently see it: built-in items (public/menu-data.json) merged with the
// owner's edits (D1 menu_items) and categories (D1 menu_sections). Used by the orders API, so the
// price of an order line always comes from the server, never from the browser.

import { loadDefaults, storedSections, effectiveSections } from "./sections.js";

// "1,200 DA", "1 200", "1.200 DA", "850" -> 1200 / 1200 / 1200 / 850 (Algerian dinars);
// anything else (e.g. "Prix sur place") -> null
export function parsePrice(text) {
  const m = String(text || "").trim().match(/^(\d{1,3}(?:[ ,.  ]\d{3})+|\d{1,7})\s*(?:DA|DZD|دج)?$/i);
  return m ? parseInt(m[1].replace(/\D/g, ""), 10) : null;
}

// Map id -> { id, section, name_fr, name_en, price_text, price }  (visible items only)
export async function orderableItems(request, env) {
  const defaults = await loadDefaults(request, env);
  const active = new Set(effectiveSections(defaults, await storedSections(env.DB)).map((s) => s.id));
  const { results } = await env.DB.prepare(
    "SELECT id, section, is_new, name_fr, name_en, price, hidden FROM menu_items"
  ).all();
  const edits = new Map(results.map((r) => [r.id, r]));
  const out = new Map();
  const add = (base, ed) => {
    const it = {
      id: base.id,
      section: (ed && ed.section) || base.section,
      name_fr: (ed && ed.name_fr != null ? ed.name_fr : base.name_fr) || "",
      name_en: (ed && ed.name_en != null ? ed.name_en : base.name_en) || "",
      price_text: (ed && ed.price != null ? ed.price : base.price) || "",
    };
    if ((ed && ed.hidden) || !active.has(it.section)) return;
    it.price = parsePrice(it.price_text);
    out.set(it.id, it);
  };
  for (const d of defaults.items) add(d, edits.get(d.id));
  for (const r of results) if (r.is_new) add({ id: r.id, section: r.section }, r);
  return out;
}
