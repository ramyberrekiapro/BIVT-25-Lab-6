// Site content queries shared by the public API and the admin API.

import { HttpError, str } from './http.js';
import { isMediaKey } from './media.js';

// Every editable setting, with its max length. Anything else is rejected.
export const SETTING_FIELDS = {
  brand_name: 80,
  tagline: 160,
  hero_eyebrow: 120,
  hero_title: 160,
  hero_subtitle: 400,
  hero_cta: 60,
  hero_image: 64,
  about_title: 160,
  about_text: 2000,
  about_image: 64,
  products_title: 120,
  products_intro: 400,
  featured_title: 120,
  why_title: 120,
  highlights: 4000,
  contact_title: 160,
  phone: 40,
  email: 120,
  address: 300,
  city: 120,
  hours: 600,
  instagram: 300,
  maps_url: 600,
  currency: 10,
  footer_note: 300,
};

export const IMAGE_SETTINGS = ['hero_image', 'about_image'];

export async function loadSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const key of Object.keys(SETTING_FIELDS)) settings[key] = '';
  for (const row of results) if (row.key in SETTING_FIELDS) settings[row.key] = row.value;
  try {
    settings.highlights = JSON.parse(settings.highlights || '[]');
  } catch {
    settings.highlights = [];
  }
  return settings;
}

function safeUrl(value, field) {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `${field} must be a full URL starting with https://`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, `${field} must start with https://`);
  }
  return url.toString();
}

// Validates a partial settings update and returns [key, value] pairs to store.
export function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid settings');
  const out = [];
  for (const [key, raw] of Object.entries(input)) {
    if (!(key in SETTING_FIELDS)) throw new HttpError(400, `Unknown setting: ${key}`);
    let value;
    if (key === 'highlights') {
      if (!Array.isArray(raw) || raw.length > 8) throw new HttpError(400, 'Highlights must be a list (max 8)');
      const items = raw
        .map((h) => ({ title: str(h?.title, 'Highlight title', { max: 80 }), text: str(h?.text, 'Highlight text', { max: 300 }) }))
        .filter((h) => h.title || h.text);
      value = JSON.stringify(items);
    } else {
      value = str(raw, key, { max: SETTING_FIELDS[key] });
      if (key === 'instagram' || key === 'maps_url') value = safeUrl(value, key);
      if (key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new HttpError(400, 'Email address is not valid');
      }
      if (IMAGE_SETTINGS.includes(key) && value && !isMediaKey(value)) throw new HttpError(400, `Invalid ${key}`);
    }
    out.push([key, value]);
  }
  return out;
}

export async function loadCatalogue(db, { includeHidden }) {
  const catSql = includeHidden
    ? 'SELECT * FROM categories ORDER BY sort_order, id'
    : 'SELECT id, name, description FROM categories WHERE visible = 1 ORDER BY sort_order, id';
  const prodSql = includeHidden
    ? 'SELECT * FROM products ORDER BY sort_order, id'
    : `SELECT p.id, p.category_id, p.name, p.description, p.price, p.unit, p.image_key, p.featured
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.visible = 1 AND (p.category_id IS NULL OR c.visible = 1)
        ORDER BY p.sort_order, p.id`;
  const [cats, prods] = await db.batch([db.prepare(catSql), db.prepare(prodSql)]);
  return { categories: cats.results, products: prods.results };
}
