// Image storage. Uses the R2 bucket bound as MEDIA when available,
// otherwise falls back to the `media` table in D1 (fine for a small catalogue;
// the admin panel compresses images in the browser before upload).

import { HttpError } from './http.js';

const R2_MAX = 5 * 1024 * 1024;
const D1_MAX = 1.8 * 1024 * 1024; // D1 rows are limited to 2 MB

// Detect the real format from magic bytes instead of trusting the client.
function sniff(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const ftyp = String.fromCharCode(...b.slice(4, 12));
  if (ftyp.startsWith('ftypavif')) return 'image/avif';
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function putMedia(env, file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new HttpError(400, 'No file uploaded');
  const bytes = await file.arrayBuffer();
  const type = sniff(bytes);
  if (!type) throw new HttpError(415, 'Only JPEG, PNG, WebP or AVIF images are allowed');
  const limit = env.MEDIA ? R2_MAX : D1_MAX;
  if (bytes.byteLength > limit) {
    throw new HttpError(413, `Image is too large (max ${(limit / 1024 / 1024).toFixed(1)} MB)`);
  }

  const key = `${crypto.randomUUID()}.${EXT[type]}`;
  if (env.MEDIA) {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  } else {
    await env.DB.prepare('INSERT INTO media (key, content_type, size, data) VALUES (?, ?, ?, ?)')
      .bind(key, type, bytes.byteLength, bytes).run();
  }
  return key;
}

export async function getMedia(env, key) {
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) return { body: obj.body, type: obj.httpMetadata?.contentType || 'application/octet-stream' };
  }
  const row = await env.DB.prepare('SELECT content_type, data FROM media WHERE key = ?').bind(key).first();
  if (!row) return null;
  return { body: new Uint8Array(row.data), type: row.content_type };
}

export async function deleteMedia(env, key) {
  if (!key) return;
  if (env.MEDIA) await env.MEDIA.delete(key);
  await env.DB.prepare('DELETE FROM media WHERE key = ?').bind(key).run();
}

export function isMediaKey(key) {
  return typeof key === 'string' && /^[0-9a-f-]{36}\.(jpg|png|webp|avif)$/.test(key);
}
