// GET /api/site — everything the public website needs, in one request.

import { json, errorResponse } from '../../src/lib/http.js';
import { loadSettings, loadCatalogue } from '../../src/lib/content.js';

export async function onRequestGet({ env }) {
  try {
    const [settings, catalogue] = await Promise.all([
      loadSettings(env.DB),
      loadCatalogue(env.DB, { includeHidden: false }),
    ]);
    // Short edge/browser cache: admin changes appear within a minute at most.
    return json({ settings, ...catalogue }, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=60' });
  } catch (err) {
    return errorResponse(err);
  }
}
