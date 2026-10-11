// /api/admin/* — every admin endpoint, behind the session cookie.
//
//   POST   /api/admin/login              { password }
//   POST   /api/admin/logout
//   GET    /api/admin/session
//   GET    /api/admin/data               settings + all categories + all products
//   PUT    /api/admin/settings           { key: value, ... }
//   POST   /api/admin/upload             multipart/form-data, field "file"
//   DELETE /api/admin/upload/:key        discard an unsaved upload
//   POST   /api/admin/categories         create
//   PUT    /api/admin/categories/:id     partial update
//   DELETE /api/admin/categories/:id     products in it become uncategorised
//   POST   /api/admin/categories/reorder { ids: [...] }
//   POST   /api/admin/products           create
//   PUT    /api/admin/products/:id       partial update
//   DELETE /api/admin/products/:id
//   POST   /api/admin/products/reorder   { ids: [...] }

import { json, errorResponse, readJson, HttpError, str, bool, price, id, idList } from '../../../src/lib/http.js';
import { isAuthenticated, login, logoutCookie } from '../../../src/lib/auth.js';
import { putMedia, deleteMedia, isMediaKey } from '../../../src/lib/media.js';
import { loadSettings, loadCatalogue, validateSettings, IMAGE_SETTINGS } from '../../../src/lib/content.js';

export async function onRequest(context) {
  try {
    return await route(context);
  } catch (err) {
    return errorResponse(err);
  }
}

async function route({ request, env, params }) {
  const method = request.method;
  const [resource = '', sub] = params.path || [];

  if (method !== 'GET') checkSameOrigin(request);

  if (resource === 'login' && method === 'POST') {
    const body = await readJson(request);
    const cookie = await login(request, env, String(body.password || ''));
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }
  if (resource === 'logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': logoutCookie(request) });
  }

  const authed = await isAuthenticated(request, env);
  if (resource === 'session' && method === 'GET') return json({ authenticated: authed });
  if (!authed) throw new HttpError(401, 'Not signed in');

  const db = env.DB;

  if (resource === 'data' && method === 'GET') {
    const [settings, catalogue] = await Promise.all([loadSettings(db), loadCatalogue(db, { includeHidden: true })]);
    return json({ settings, ...catalogue, storage: env.MEDIA ? 'r2' : 'd1' });
  }

  if (resource === 'settings' && method === 'PUT') {
    const pairs = validateSettings(await readJson(request));
    const old = await loadSettings(db);
    await db.batch(pairs.map(([k, v]) =>
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)));
    for (const [k, v] of pairs) {
      if (IMAGE_SETTINGS.includes(k) && old[k] && old[k] !== v) await deleteMedia(env, old[k]);
    }
    return json({ settings: await loadSettings(db) });
  }

  if (resource === 'upload' && method === 'POST') {
    let form;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'Expected multipart form data');
    }
    const key = await putMedia(env, form.get('file'));
    return json({ key, url: `/media/${key}` }, 201);
  }

  // Discards an uploaded image that was never saved (e.g. editor cancelled).
  // Images still referenced by a product or setting are left alone.
  if (resource === 'upload' && method === 'DELETE') {
    if (!isMediaKey(sub)) throw new HttpError(400, 'Invalid image');
    const used = await db.prepare(
      'SELECT 1 FROM products WHERE image_key = ?1 UNION ALL SELECT 1 FROM settings WHERE value = ?1 LIMIT 1',
    ).bind(sub).first();
    if (!used) await deleteMedia(env, sub);
    return json({ ok: true, deleted: !used });
  }

  if (resource === 'categories') return categories(request, db, method, sub);
  if (resource === 'products') return products(request, env, db, method, sub);

  throw new HttpError(404, 'Not found');
}

// Blocks cross-site form posts. Combined with the SameSite=Strict cookie
// and the JSON content type this is enough CSRF protection here.
function checkSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-origin request blocked');
}

// ---------------- categories ----------------

function categoryFields(body, partial) {
  const out = {};
  if (!partial || 'name' in body) out.name = str(body.name, 'Name', { max: 80, required: true });
  if (!partial || 'description' in body) out.description = str(body.description, 'Description', { max: 400 });
  if (!partial || 'visible' in body) out.visible = 'visible' in body ? bool(body.visible) : 1;
  return out;
}

async function categories(request, db, method, sub) {
  if (method === 'POST' && sub === 'reorder') {
    const ids = idList((await readJson(request)).ids);
    await db.batch(ids.map((cid, i) => db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').bind(i + 1, cid)));
    return json({ ok: true });
  }

  if (method === 'POST' && !sub) {
    const f = categoryFields(await readJson(request), false);
    const row = await db.prepare(
      `INSERT INTO categories (name, description, visible, sort_order)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories))
       RETURNING *`,
    ).bind(f.name, f.description, f.visible).first();
    return json({ category: row }, 201);
  }

  const cid = id(sub);

  if (method === 'PUT') {
    const f = categoryFields(await readJson(request), true);
    const keys = Object.keys(f);
    if (!keys.length) throw new HttpError(400, 'Nothing to update');
    const row = await db.prepare(
      `UPDATE categories SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`,
    ).bind(...keys.map((k) => f[k]), cid).first();
    if (!row) throw new HttpError(404, 'Category not found');
    return json({ category: row });
  }

  if (method === 'DELETE') {
    const [, res] = await db.batch([
      db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').bind(cid),
      db.prepare('DELETE FROM categories WHERE id = ?').bind(cid),
    ]);
    if (!res.meta.changes) throw new HttpError(404, 'Category not found');
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
}

// ---------------- products ----------------

async function productFields(db, body, partial) {
  const out = {};
  const has = (k) => !partial || k in body;
  if (has('name')) out.name = str(body.name, 'Name', { max: 120, required: true });
  if (has('description')) out.description = str(body.description, 'Description', { max: 1200 });
  if (has('price')) out.price = price(body.price);
  if (has('unit')) out.unit = str(body.unit, 'Unit', { max: 40 });
  if (has('featured')) out.featured = bool(body.featured);
  if (has('visible')) out.visible = 'visible' in body ? bool(body.visible) : 1;
  if (has('image_key')) {
    const key = body.image_key || null;
    if (key && !isMediaKey(key)) throw new HttpError(400, 'Invalid image');
    out.image_key = key;
  }
  if (has('category_id')) {
    out.category_id = body.category_id ? id(body.category_id, 'category') : null;
    if (out.category_id) {
      const exists = await db.prepare('SELECT 1 FROM categories WHERE id = ?').bind(out.category_id).first();
      if (!exists) throw new HttpError(400, 'Category does not exist');
    }
  }
  return out;
}

async function products(request, env, db, method, sub) {
  if (method === 'POST' && sub === 'reorder') {
    const ids = idList((await readJson(request)).ids);
    await db.batch(ids.map((pid, i) => db.prepare('UPDATE products SET sort_order = ? WHERE id = ?').bind(i + 1, pid)));
    return json({ ok: true });
  }

  if (method === 'POST' && !sub) {
    const f = await productFields(db, await readJson(request), false);
    const row = await db.prepare(
      `INSERT INTO products (category_id, name, description, price, unit, image_key, featured, visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products))
       RETURNING *`,
    ).bind(f.category_id, f.name, f.description, f.price, f.unit, f.image_key, f.featured, f.visible).first();
    return json({ product: row }, 201);
  }

  const pid = id(sub);
  const existing = await db.prepare('SELECT * FROM products WHERE id = ?').bind(pid).first();
  if (!existing) throw new HttpError(404, 'Product not found');

  if (method === 'PUT') {
    const f = await productFields(db, await readJson(request), true);
    const keys = Object.keys(f);
    if (!keys.length) throw new HttpError(400, 'Nothing to update');
    const row = await db.prepare(
      `UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? RETURNING *`,
    ).bind(...keys.map((k) => f[k]), pid).first();
    if ('image_key' in f && existing.image_key && existing.image_key !== f.image_key) {
      await deleteMedia(env, existing.image_key);
    }
    return json({ product: row });
  }

  if (method === 'DELETE') {
    await db.prepare('DELETE FROM products WHERE id = ?').bind(pid).run();
    await deleteMedia(env, existing.image_key);
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
}
