// GET /media/:key — serves uploaded images. Keys are random and never reused,
// so responses can be cached forever.

import { getMedia, isMediaKey } from '../../src/lib/media.js';

export async function onRequestGet({ env, params }) {
  const key = params.key;
  if (!isMediaKey(key)) return new Response('Not found', { status: 404 });
  const media = await getMedia(env, key);
  if (!media) return new Response('Not found', { status: 404 });
  return new Response(media.body, {
    headers: {
      'content-type': media.type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
