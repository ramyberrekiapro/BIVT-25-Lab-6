// Chemex DZ — admin panel. Talks to /api/admin/* (see functions/api/admin).

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mediaUrl = (key) => `/media/${encodeURIComponent(key)}`;

  const ICON = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/></svg>',
    starOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/></svg>',
  };

  const state = { settings: {}, categories: [], products: [], search: '', filter: 'all' };

  // ---------------- API ----------------

  async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: { accept: 'application/json' }, credentials: 'same-origin' };
    if (form) opts.body = form;
    else if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api/admin/${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'login') {
      showLogin();
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------------- UI helpers ----------------

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' toast--error' : ''}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 5000 : 2600);
  }

  async function busy(button, fn) {
    const prev = button?.disabled;
    if (button) button.disabled = true;
    try {
      return await fn();
    } catch (err) {
      toast(err.message, 'error');
      return undefined;
    } finally {
      if (button) button.disabled = prev;
    }
  }

  function confirmDialog(title, text, okLabel = 'Delete') {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    dlg.querySelector('[value="ok"]').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  function formatPrice(price) {
    if (price === null || price === undefined) return 'On request';
    return `${new Intl.NumberFormat('fr-DZ').format(price)} ${state.settings.currency || 'DA'}`;
  }

  const categoryName = (id) => state.categories.find((c) => c.id === id)?.name || 'Uncategorised';

  // Resize + re-encode in the browser so uploads stay small and fast.
  async function compressImage(file, maxSide = 1600) {
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new Error('Please choose a JPEG, PNG or WebP image');
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
    let blob = await toBlob('image/webp', 0.84);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.86);
    return blob && blob.size < file.size ? blob : file;
  }

  async function uploadImage(file) {
    const blob = await compressImage(file);
    const form = new FormData();
    form.append('file', blob, 'upload');
    return (await api('upload', { method: 'POST', form })).key;
  }

  // Reusable image picker: preview + upload/replace + remove.
  function imageField(container, { getKey, onChange, label = 'image' }) {
    const render = () => {
      const key = getKey();
      container.innerHTML = `
        ${key ? `<img class="image-field__preview" src="${mediaUrl(key)}" alt="">` : '<div class="image-field__preview">No image</div>'}
        <div class="image-field__btns">
          <label class="btn btn--ghost btn--sm">${key ? 'Replace' : 'Upload'} ${label}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif">
          </label>
          ${key ? '<button class="btn btn--ghost btn--sm" type="button" data-remove>Remove</button>' : ''}
        </div>`;
      $('input[type="file"]', container).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        container.classList.add('loading');
        try {
          await onChange(await uploadImage(file));
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          container.classList.remove('loading');
          render();
        }
      });
      $('[data-remove]', container)?.addEventListener('click', async () => {
        container.classList.add('loading');
        try { await onChange(null); } catch (err) { toast(err.message, 'error'); }
        container.classList.remove('loading');
        render();
      });
    };
    render();
    return { render };
  }

  // ---------------- auth ----------------

  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    $('#login-form input[name="password"]').focus();
  }

  async function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    await reload();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const error = $('#login-error');
    error.textContent = '';
    await busy(form.querySelector('[type="submit"]'), async () => {
      try {
        await api('login', { method: 'POST', body: { password: form.password.value } });
        form.reset();
        await showApp();
      } catch (err) {
        error.textContent = err.message;
      }
    });
  });

  $('#logout').addEventListener('click', async () => {
    await api('logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  // ---------------- data ----------------

  async function reload() {
    const data = await api('data');
    Object.assign(state, { settings: data.settings, categories: data.categories, products: data.products });
    renderAll();
    fillSettingsForms();
  }

  // Re-renders the lists. Settings forms are only refilled on load/save so
  // unsaved edits in another tab are never overwritten.
  function renderAll() {
    sortProducts();
    $$('[data-brand]').forEach((el) => { el.textContent = state.settings.brand_name || 'Chemex DZ'; });
    renderProducts();
    renderCategories();
  }

  // ---------------- tabs ----------------

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    try { sessionStorage.setItem('cdz-tab', tab.dataset.tab); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }));
  try {
    const saved = sessionStorage.getItem('cdz-tab');
    if (saved) $(`.tab[data-tab="${saved}"]`)?.click();
  } catch { /* ignore */ }

  // ---------------- products ----------------

  // Keep products grouped by category (in category order, uncategorised last).
  // Array.sort is stable, so the order inside each category is preserved.
  function sortProducts() {
    const pos = new Map(state.categories.map((c, i) => [c.id, i]));
    const rank = (p) => pos.get(p.category_id) ?? Infinity;
    state.products.sort((a, b) => rank(a) - rank(b));
  }

  function filteredProducts() {
    const q = state.search.trim().toLowerCase();
    return state.products.filter((p) => {
      if (state.filter === 'none' && p.category_id) return false;
      if (state.filter !== 'all' && state.filter !== 'none' && p.category_id !== Number(state.filter)) return false;
      return !q || `${p.name} ${p.description} ${p.unit}`.toLowerCase().includes(q);
    });
  }

  function renderProductFilter() {
    const sel = $('#product-filter');
    sel.innerHTML = [
      '<option value="all">All categories</option>',
      ...state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`),
      '<option value="none">Uncategorised</option>',
    ].join('');
    if (![...sel.options].some((o) => o.value === state.filter)) state.filter = 'all';
    sel.value = state.filter;
  }

  function renderProducts() {
    renderProductFilter();
    const total = state.products.length;
    const hidden = state.products.filter((p) => !p.visible).length;
    $('#product-summary').textContent = `${total} product${total === 1 ? '' : 's'}${hidden ? ` · ${hidden} hidden` : ''}`;

    const items = filteredProducts();
    const list = $('#product-list');
    if (!items.length) {
      list.innerHTML = `<li class="empty-state">${total ? 'No products match this filter.' : 'No products yet. Click “Add product” to create the first one.'}</li>`;
      return;
    }
    list.innerHTML = items.map((p, i) => `
      <li class="item${p.visible ? '' : ' is-hidden'}" data-id="${p.id}">
        ${p.image_key ? `<img class="item__thumb" src="${mediaUrl(p.image_key)}" alt="" loading="lazy">` : `<div class="item__thumb">${esc(p.name.charAt(0).toUpperCase())}</div>`}
        <div class="item__main">
          <div class="item__title">${esc(p.name)}
            ${p.featured ? '<span class="badge badge--feat">Signature</span>' : ''}
            ${p.visible ? '' : '<span class="badge badge--hidden">Hidden</span>'}
          </div>
          <div class="item__meta">${esc(categoryName(p.category_id))}${p.unit ? ` · ${esc(p.unit)}` : ''}</div>
        </div>
        <div class="item__price">${esc(formatPrice(p.price))}</div>
        <div class="item__actions">
          <label class="switch" title="Show on website"><input type="checkbox" data-act="visible" ${p.visible ? 'checked' : ''}> Visible</label>
          <span class="spacer"></span>
          <button class="icon-btn" type="button" data-act="featured" title="${p.featured ? 'Remove from Signature' : 'Add to Signature'}" aria-label="Toggle signature" aria-pressed="${!!p.featured}">${p.featured ? ICON.star : ICON.starOff}</button>
          <button class="icon-btn" type="button" data-act="up" aria-label="Move up" ${sameCategory(p, items[i - 1]) ? '' : 'disabled'}>${ICON.up}</button>
          <button class="icon-btn" type="button" data-act="down" aria-label="Move down" ${sameCategory(p, items[i + 1]) ? '' : 'disabled'}>${ICON.down}</button>
          <button class="icon-btn" type="button" data-act="edit" aria-label="Edit">${ICON.edit}</button>
          <button class="icon-btn icon-btn--danger" type="button" data-act="delete" aria-label="Delete">${ICON.trash}</button>
        </div>
      </li>`).join('');
  }

  // Products can only be reordered within their own category.
  const sameCategory = (a, b) => !!b && (a.category_id ?? null) === (b.category_id ?? null);

  $('#product-search').addEventListener('input', (e) => { state.search = e.target.value; renderProducts(); });
  $('#product-filter').addEventListener('change', (e) => { state.filter = e.target.value; renderProducts(); });
  $('#add-product').addEventListener('click', () => openProductEditor(null));

  // Swap an item with its visible neighbour, then persist the full order.
  async function move(collection, endpoint, visibleItems, id, dir) {
    const idx = visibleItems.findIndex((x) => x.id === id);
    const neighbour = visibleItems[idx + dir];
    if (!neighbour) return;
    const all = state[collection];
    const a = all.findIndex((x) => x.id === id);
    const b = all.findIndex((x) => x.id === neighbour.id);
    [all[a], all[b]] = [all[b], all[a]];
    renderAll();
    try {
      await api(`${endpoint}/reorder`, { method: 'POST', body: { ids: all.map((x) => x.id) } });
    } catch (err) {
      toast(err.message, 'error');
      await reload();
    }
  }

  $('#product-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('[data-id]').dataset.id);
    const p = state.products.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === 'edit') return openProductEditor(p);
    if (act === 'up' || act === 'down') return move('products', 'products', filteredProducts(), id, act === 'up' ? -1 : 1);
    if (act === 'featured') {
      return busy(btn, async () => {
        const { product } = await api(`products/${id}`, { method: 'PUT', body: { featured: !p.featured } });
        Object.assign(p, product);
        renderProducts();
        toast(product.featured ? 'Added to Signature' : 'Removed from Signature');
      });
    }
    if (act === 'delete') {
      if (!(await confirmDialog(`Delete “${p.name}”?`, 'This permanently removes the product and its photo.'))) return;
      return busy(btn, async () => {
        await api(`products/${id}`, { method: 'DELETE' });
        state.products = state.products.filter((x) => x.id !== id);
        renderProducts();
        toast('Product deleted');
      });
    }
  });

  $('#product-list').addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-act="visible"]');
    if (!input) return;
    const id = Number(input.closest('[data-id]').dataset.id);
    const p = state.products.find((x) => x.id === id);
    input.disabled = true;
    try {
      const { product } = await api(`products/${id}`, { method: 'PUT', body: { visible: input.checked } });
      Object.assign(p, product);
      toast(product.visible ? 'Product is now visible' : 'Product hidden from website');
    } catch (err) {
      toast(err.message, 'error');
    }
    renderProducts();
  });

  // ---- product editor ----

  const productDialog = $('#product-dialog');
  const productForm = $('#product-form');
  let editing = null;      // product being edited (null = new)
  let draftImage = null;   // image key currently shown in the editor
  let uploadedKeys = [];   // keys uploaded during this edit session

  function openProductEditor(p) {
    editing = p;
    draftImage = p?.image_key || null;
    uploadedKeys = [];
    $('#product-dialog-title').textContent = p ? 'Edit product' : 'New product';
    $('#product-error').textContent = '';
    const f = productForm;
    f.category_id.innerHTML = '<option value="">— No category —</option>' +
      state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const defaultCat = !p && state.filter !== 'all' && state.filter !== 'none' ? state.filter : '';
    f.name.value = p?.name || '';
    f.category_id.value = p ? (p.category_id ?? '') : defaultCat;
    f.unit.value = p?.unit || '';
    f.price.value = p?.price ?? '';
    f.description.value = p?.description || '';
    f.visible.checked = p ? !!p.visible : true;
    f.featured.checked = !!p?.featured;
    imageField($('#product-image'), {
      label: 'photo',
      getKey: () => draftImage,
      onChange: async (key) => {
        if (key) uploadedKeys.push(key);
        draftImage = key;
      },
    });
    productDialog.showModal();
    f.name.focus();
  }

  // Clean up uploads that will not be used.
  function discardUploads(keep) {
    for (const key of uploadedKeys) {
      if (key !== keep) api(`upload/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
    }
    uploadedKeys = [];
  }

  productDialog.addEventListener('close', () => {
    if (uploadedKeys.length) discardUploads(null);
  });
  $$('[data-close]', productDialog).forEach((b) => b.addEventListener('click', () => productDialog.close()));

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = productForm;
    const error = $('#product-error');
    error.textContent = '';
    if (!f.name.value.trim()) { error.textContent = 'Name is required.'; f.name.focus(); return; }
    const body = {
      name: f.name.value,
      category_id: f.category_id.value ? Number(f.category_id.value) : null,
      unit: f.unit.value,
      price: f.price.value === '' ? null : Number(f.price.value),
      description: f.description.value,
      visible: f.visible.checked,
      featured: f.featured.checked,
      image_key: draftImage,
    };
    await busy(f.querySelector('[type="submit"]'), async () => {
      try {
        const { product } = editing
          ? await api(`products/${editing.id}`, { method: 'PUT', body })
          : await api('products', { method: 'POST', body });
        discardUploads(product.image_key);
        if (editing) Object.assign(editing, product);
        else state.products.push(product);
        productDialog.close();
        renderAll();
        toast(editing ? 'Product saved' : 'Product added');
      } catch (err) {
        error.textContent = err.message;
      }
    });
  });

  // ---------------- categories ----------------

  function renderCategories() {
    const list = $('#category-list');
    if (!state.categories.length) {
      list.innerHTML = '<li class="empty-state">No categories yet. Create categories like “Hot coffee”, “Beans” or “Equipment”.</li>';
      return;
    }
    list.innerHTML = state.categories.map((c, i) => {
      const count = state.products.filter((p) => p.category_id === c.id).length;
      return `
      <li class="item${c.visible ? '' : ' is-hidden'}" data-id="${c.id}">
        <div class="item__thumb">${esc(c.name.charAt(0).toUpperCase())}</div>
        <div class="item__main">
          <div class="item__title">${esc(c.name)} ${c.visible ? '' : '<span class="badge badge--hidden">Hidden</span>'}</div>
          <div class="item__meta">${count} product${count === 1 ? '' : 's'}${c.description ? ` · ${esc(c.description)}` : ''}</div>
        </div>
        <div></div>
        <div class="item__actions">
          <label class="switch" title="Show on website"><input type="checkbox" data-act="visible" ${c.visible ? 'checked' : ''}> Visible</label>
          <span class="spacer"></span>
          <button class="icon-btn" type="button" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button class="icon-btn" type="button" data-act="down" aria-label="Move down" ${i === state.categories.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button class="icon-btn" type="button" data-act="edit" aria-label="Edit">${ICON.edit}</button>
          <button class="icon-btn icon-btn--danger" type="button" data-act="delete" aria-label="Delete">${ICON.trash}</button>
        </div>
      </li>`;
    }).join('');
  }

  const categoryDialog = $('#category-dialog');
  const categoryForm = $('#category-form');
  let editingCategory = null;

  function openCategoryEditor(c) {
    editingCategory = c;
    $('#category-dialog-title').textContent = c ? 'Edit category' : 'New category';
    $('#category-error').textContent = '';
    categoryForm.name.value = c?.name || '';
    categoryForm.description.value = c?.description || '';
    categoryForm.visible.checked = c ? !!c.visible : true;
    categoryDialog.showModal();
    categoryForm.name.focus();
  }

  $('#add-category').addEventListener('click', () => openCategoryEditor(null));
  $$('[data-close]', categoryDialog).forEach((b) => b.addEventListener('click', () => categoryDialog.close()));

  categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = categoryForm;
    const error = $('#category-error');
    error.textContent = '';
    if (!f.name.value.trim()) { error.textContent = 'Name is required.'; f.name.focus(); return; }
    const body = { name: f.name.value, description: f.description.value, visible: f.visible.checked };
    await busy(f.querySelector('[type="submit"]'), async () => {
      try {
        const { category } = editingCategory
          ? await api(`categories/${editingCategory.id}`, { method: 'PUT', body })
          : await api('categories', { method: 'POST', body });
        if (editingCategory) Object.assign(editingCategory, category);
        else state.categories.push(category);
        categoryDialog.close();
        renderAll();
        toast(editingCategory ? 'Category saved' : 'Category added');
      } catch (err) {
        error.textContent = err.message;
      }
    });
  });

  $('#category-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('[data-id]').dataset.id);
    const c = state.categories.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === 'edit') return openCategoryEditor(c);
    if (act === 'up' || act === 'down') return move('categories', 'categories', state.categories, id, act === 'up' ? -1 : 1);
    if (act === 'delete') {
      const count = state.products.filter((p) => p.category_id === id).length;
      const text = count
        ? `${count} product${count === 1 ? '' : 's'} in this category will become uncategorised (shown under “Other”). Products are not deleted.`
        : 'This category is empty.';
      if (!(await confirmDialog(`Delete “${c.name}”?`, text))) return;
      return busy(btn, async () => {
        await api(`categories/${id}`, { method: 'DELETE' });
        state.categories = state.categories.filter((x) => x.id !== id);
        state.products.forEach((p) => { if (p.category_id === id) p.category_id = null; });
        renderAll();
        toast('Category deleted');
      });
    }
  });

  $('#category-list').addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-act="visible"]');
    if (!input) return;
    const id = Number(input.closest('[data-id]').dataset.id);
    const c = state.categories.find((x) => x.id === id);
    input.disabled = true;
    try {
      const { category } = await api(`categories/${id}`, { method: 'PUT', body: { visible: input.checked } });
      Object.assign(c, category);
      toast(category.visible ? 'Category is now visible' : 'Category and its products hidden from website');
    } catch (err) {
      toast(err.message, 'error');
    }
    renderCategories();
  });

  // ---------------- settings ----------------

  const HIGHLIGHT_ROWS = 4;
  const settingsForms = [$('#content-form'), $('#business-form')];

  function fillSettingsForms() {
    for (const form of settingsForms) {
      for (const el of form.elements) {
        if (el.name && el.name in state.settings && typeof state.settings[el.name] === 'string') el.value = state.settings[el.name];
      }
    }
    const hl = state.settings.highlights || [];
    $('#highlights-editor').innerHTML = Array.from({ length: Math.max(HIGHLIGHT_ROWS, hl.length) }, (_, i) => `
      <div class="highlight">
        <span class="highlight__num">${String(i + 1).padStart(2, '0')}</span>
        <label class="field"><span>Title</span><input data-hl="title" maxlength="80" value="${esc(hl[i]?.title || '')}"></label>
        <label class="field"><span>Text</span><textarea data-hl="text" rows="2" maxlength="300">${esc(hl[i]?.text || '')}</textarea></label>
      </div>`).join('');
    $$('[data-image-setting]').forEach((el) => {
      const key = el.dataset.imageSetting;
      imageField(el, {
        getKey: () => state.settings[key],
        onChange: async (value) => {
          const { settings } = await api('settings', { method: 'PUT', body: { [key]: value || '' } });
          state.settings = settings;
          toast(value ? 'Image updated' : 'Image removed');
        },
      });
    });
  }

  for (const form of settingsForms) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const el of form.elements) if (el.name) body[el.name] = el.value;
      if (form.id === 'content-form') {
        body.highlights = $$('.highlight', form).map((row) => ({
          title: $('[data-hl="title"]', row).value,
          text: $('[data-hl="text"]', row).value,
        }));
      }
      await busy(form.querySelector('[type="submit"]'), async () => {
        const { settings } = await api('settings', { method: 'PUT', body });
        state.settings = settings;
        renderAll();
        fillSettingsForms();
        toast('Saved — changes are live on the website');
      });
    });
  }

  // ---------------- boot ----------------

  (async () => {
    try {
      const { authenticated } = await api('session');
      if (authenticated) await showApp();
      else showLogin();
    } catch (err) {
      showLogin();
      toast(err.message, 'error');
    }
  })();
})();
