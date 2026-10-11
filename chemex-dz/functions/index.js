// GET / — serves index.html with the current content already filled in,
// so text is visible on first paint and indexable by search engines.
// The full data set is embedded as JSON so the browser needs no extra request.
// If anything fails, the static page is returned and site.js fetches /api/site.

import { loadSettings, loadCatalogue } from '../src/lib/content.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestGet({ env, next }) {
  const page = await next();
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;

  let data;
  try {
    const [settings, catalogue] = await Promise.all([
      loadSettings(env.DB),
      loadCatalogue(env.DB, { includeHidden: false }),
    ]);
    data = { settings, ...catalogue };
  } catch (err) {
    console.error(err);
    return page;
  }

  const s = data.settings;
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = s.brand_name ? `${s.brand_name} — ${s.tagline || 'Specialty coffee'}` : null;
  const description = s.hero_subtitle || s.footer_note;

  const res = new HTMLRewriter()
    .on('[data-bind]', {
      element(el) {
        const v = s[el.getAttribute('data-bind')];
        if (typeof v === 'string' && v) el.setInnerContent(v);
      },
    })
    .on('[data-bind-paragraphs]', {
      element(el) {
        const v = s[el.getAttribute('data-bind-paragraphs')] || '';
        el.setInnerContent(v.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join(''), { html: true });
      },
    })
    .on('title', { element(el) { if (title) el.setInnerContent(title); } })
    .on('meta[name="description"], meta[property="og:description"]', {
      element(el) { if (description) el.setAttribute('content', description); },
    })
    .on('meta[property="og:title"]', { element(el) { if (s.brand_name) el.setAttribute('content', s.brand_name); } })
    .on('body', {
      element(el) {
        el.append(`<script id="site-data" type="application/json">${payload}</script>`, { html: true });
      },
    })
    .transform(page);

  const headers = new Headers(res.headers);
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.delete('etag');
  return new Response(res.body, { status: res.status, headers });
}
