// Chemex DZ — public website. All content comes from D1 via /api/site
// (or from the copy the server embeds into the page on first load).

(() => {
  'use strict';
  document.documentElement.classList.add('js');

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const PLACEHOLDER = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M17 10h30L35 30v3l13 22c1 2 0 3-2 3H18c-2 0-3-1-2-3l13-22v-3Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><rect x="25" y="28" width="14" height="7" rx="2" fill="currentColor"/></svg>`;

  const ICONS = {
    address: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    hours: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/></svg>',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mediaUrl = (key) => `/media/${encodeURIComponent(key)}`;

  let data = null;
  let activeFilter = 'all';

  // ---------- data ----------

  async function load() {
    const embedded = $('#site-data');
    if (embedded) {
      try { return JSON.parse(embedded.textContent); } catch { /* fall through to fetch */ }
    }
    const res = await fetch('/api/site', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Failed to load content (${res.status})`);
    return res.json();
  }

  function formatPrice(price) {
    if (price === null || price === undefined) return 'On request';
    const n = new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(price);
    return `${n} ${data.settings.currency || 'DA'}`.trim();
  }

  // ---------- render ----------

  function renderText() {
    const s = data.settings;
    $$('[data-bind]').forEach((el) => {
      const v = s[el.dataset.bind];
      if (typeof v === 'string' && v) el.textContent = v;
    });
    $$('[data-bind-paragraphs]').forEach((el) => {
      const v = s[el.dataset.bindParagraphs] || '';
      el.innerHTML = v.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
    });
    $$('[data-image]').forEach((el) => {
      const key = s[el.dataset.image];
      el.classList.toggle('has-image', !!key);
      el.querySelector('img')?.remove();
      if (key) {
        const img = new Image();
        img.src = mediaUrl(key);
        img.alt = '';
        img.decoding = 'async';
        if (el.dataset.image !== 'hero_image') img.loading = 'lazy';
        el.appendChild(img);
      }
    });
    const badge = $('.hero__badge');
    if (badge) badge.hidden = !s.tagline;
    if (s.brand_name) document.title = `${s.brand_name} — ${s.tagline || 'Specialty coffee'}`;
  }

  function categoryName(id) {
    return data.categories.find((c) => c.id === id)?.name || '';
  }

  function cardHtml(p, { showCategory = false, featured = false } = {}) {
    const media = p.image_key
      ? `<img src="${mediaUrl(p.image_key)}" alt="" loading="lazy" decoding="async" width="600" height="450">`
      : PLACEHOLDER;
    const cat = showCategory ? categoryName(p.category_id) : '';
    return `
      <button class="card reveal" type="button" data-product="${p.id}" ${featured ? 'role="listitem"' : ''} aria-label="${esc(p.name)} — view details">
        <div class="card__media">${media}${featured ? '' : p.featured ? '<span class="card__tag">Signature</span>' : ''}</div>
        <div class="card__body">
          ${cat ? `<span class="card__cat">${esc(cat)}</span>` : ''}
          <h3 class="card__name">${esc(p.name)}</h3>
          ${p.description ? `<p class="card__desc">${esc(p.description)}</p>` : ''}
          <div class="card__foot">
            <span class="card__unit">${esc(p.unit)}</span>
            <span class="card__price">${esc(formatPrice(p.price))}</span>
          </div>
        </div>
      </button>`;
  }

  function renderFeatured() {
    const items = data.products.filter((p) => p.featured);
    const section = $('#featured');
    section.hidden = items.length === 0;
    const list = $('#featured-list');
    list.style.setProperty('--cols', items.length === 4 ? 4 : Math.min(items.length, 3));
    list.innerHTML = items.map((p) => cardHtml(p, { showCategory: true, featured: true })).join('');
  }

  function groups() {
    const out = data.categories
      .map((c) => ({ id: String(c.id), name: c.name, description: c.description, items: data.products.filter((p) => p.category_id === c.id) }))
      .filter((g) => g.items.length);
    const other = data.products.filter((p) => !p.category_id || !data.categories.some((c) => c.id === p.category_id));
    if (other.length) out.push({ id: 'other', name: 'Other', description: '', items: other });
    return out;
  }

  function renderFilters(all) {
    const filters = $('#filters');
    if (all.length < 2) { filters.hidden = true; return; }
    filters.hidden = false;
    const chips = [{ id: 'all', name: 'All' }, ...all];
    filters.innerHTML = chips.map((g) =>
      `<button class="chip" type="button" role="tab" data-filter="${esc(g.id)}" aria-selected="${g.id === activeFilter}">${esc(g.name)}</button>`).join('');
  }

  function renderCatalogue() {
    const all = groups();
    if (!all.some((g) => g.id === activeFilter)) activeFilter = 'all';
    renderFilters(all);
    const shown = activeFilter === 'all' ? all : all.filter((g) => g.id === activeFilter);
    const root = $('#catalogue');
    if (!shown.length) {
      root.innerHTML = '<p class="empty">Our selection is being updated. Please check back soon.</p>';
      return;
    }
    root.innerHTML = shown.map((g) => `
      <section class="group" aria-labelledby="group-${esc(g.id)}">
        <header class="group__head">
          <h3 class="group__title" id="group-${esc(g.id)}">${esc(g.name)}</h3>
          <span class="group__count">${g.items.length} ${g.items.length === 1 ? 'item' : 'items'}</span>
          ${g.description ? `<p class="group__desc">${esc(g.description)}</p>` : ''}
        </header>
        <div class="grid">${g.items.map((p) => cardHtml(p)).join('')}</div>
      </section>`).join('');
    observeReveals(root);
  }

  function renderHighlights() {
    const items = data.settings.highlights || [];
    const list = $('#highlights');
    $('#why').hidden = items.length === 0;
    list.style.setProperty('--cols', Math.min(Math.max(items.length, 1), 4));
    list.innerHTML = items.map((h, i) => `
      <li class="why__item reveal">
        <span class="why__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <h3 class="why__title">${esc(h.title)}</h3>
        <p class="why__text">${esc(h.text)}</p>
      </li>`).join('');
  }

  function renderContact() {
    const s = data.settings;
    const tel = (s.phone || '').replace(/[^\d+]/g, '');
    const instagramHandle = (() => {
      try { return '@' + new URL(s.instagram).pathname.replace(/\//g, ''); } catch { return 'Instagram'; }
    })();
    const rows = [
      s.address && { key: 'address', label: 'Address', value: [s.address, s.city].filter(Boolean).join('\n'), wide: true },
      s.phone && { key: 'phone', label: 'Phone', html: `<a href="tel:${esc(tel)}">${esc(s.phone)}</a>` },
      s.email && { key: 'email', label: 'Email', html: `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` },
      s.hours && { key: 'hours', label: 'Opening hours', value: s.hours, wide: !s.instagram },
      s.instagram && { key: 'instagram', label: 'Instagram', html: `<a href="${esc(s.instagram)}" target="_blank" rel="noopener">${esc(instagramHandle)}</a>` },
    ].filter(Boolean);

    $('#contact-list').innerHTML = rows.map((r) => `
      <div class="contact__item${r.wide ? ' contact__item--wide' : ''}">
        <span class="contact__icon">${ICONS[r.key]}</span>
        <dt>${r.label}</dt>
        <dd>${r.html || esc(r.value)}</dd>
      </div>`).join('');

    const call = $('#contact-call');
    call.hidden = !tel;
    if (tel) call.href = `tel:${tel}`;
    const map = $('#contact-map');
    map.hidden = !s.maps_url;
    if (s.maps_url) map.href = s.maps_url;
    const ig = $('#footer-instagram');
    ig.hidden = !s.instagram;
    if (s.instagram) ig.href = s.instagram;
  }

  // ---------- product modal ----------

  function openProduct(id) {
    const p = data.products.find((x) => x.id === id);
    if (!p) return;
    const modal = $('#product-modal');
    $('#modal-media').innerHTML = p.image_key ? `<img src="${mediaUrl(p.image_key)}" alt="${esc(p.name)}">` : PLACEHOLDER;
    $('#modal-cat').textContent = categoryName(p.category_id);
    $('#modal-title').textContent = p.name;
    $('#modal-unit').textContent = p.unit || '';
    $('#modal-desc').textContent = p.description || '';
    $('#modal-price').textContent = formatPrice(p.price);
    modal.showModal();
  }

  // ---------- behaviour ----------

  let observer;
  function observeReveals(root = document) {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal', root).forEach((el) => el.classList.add('is-visible'));
      return;
    }
    observer ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); observer.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.reveal:not(.is-visible)', root).forEach((el) => observer.observe(el));
  }

  function bindUi() {
    const nav = $('.nav');
    const toggle = $('.nav__toggle');
    const links = $('#nav-links');
    const setMenu = (open) => {
      links.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => setMenu(!links.classList.contains('is-open')));
    links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    $('#filters').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip || chip.dataset.filter === activeFilter) return;
      activeFilter = chip.dataset.filter;
      renderCatalogue();
      const top = $('#selection').getBoundingClientRect().top;
      if (top < 0) $('#filters').scrollIntoView({ block: 'start' });
    });

    document.addEventListener('click', (e) => {
      const card = e.target.closest('[data-product]');
      if (card) openProduct(Number(card.dataset.product));
    });

    const modal = $('#product-modal');
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) modal.close();
    });

    $('#year').textContent = new Date().getFullYear();
  }

  async function init() {
    bindUi();
    try {
      data = await load();
    } catch (err) {
      console.error(err);
      $('#catalogue').innerHTML = '<p class="empty">We could not load the selection right now. Please refresh the page.</p>';
      observeReveals();
      return;
    }
    renderText();
    renderFeatured();
    renderCatalogue();
    renderHighlights();
    renderContact();
    observeReveals();
  }

  init();
})();
