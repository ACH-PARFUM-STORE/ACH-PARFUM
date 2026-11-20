// ACH PARFUM — الوظائف المشتركة بين كل الصفحات
(function () {
  'use strict';
  const cfg = window.ACH || {};
  const configured = !!cfg.SUPABASE_URL && !/YOUR-PROJECT/.test(cfg.SUPABASE_URL) &&
                     !!cfg.SUPABASE_ANON_KEY && !/YOUR-ANON/.test(cfg.SUPABASE_ANON_KEY);
  let sb = null;
  if (configured && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  // ---------- أدوات صغيرة ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
  const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + (cfg.CURRENCY || '');
  const fmtDate = (d) => {
    try { return new Date(d).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }); }
    catch (e) { return ''; }
  };
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
  const errMsg = (e) => (e && (e.message || e.error_description)) || String(e || 'خطأ غير معروف');
  const STATUS = {
    new: 'جديد', confirmed: 'مؤكد', preparing: 'قيد التحضير',
    shipped: 'تم الشحن', completed: 'مكتمل', cancelled: 'ملغى'
  };

  function toast(msg, type, html) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'err' ? ' err' : '');
    if (html) t.innerHTML = msg; else t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), type === 'err' ? 5500 : 3600);
  }

  async function fetchAll(build) {
    const out = [], size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await build(from, from + size - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  // ---------- السلة (localStorage) — العرض فقط، السعر الحقيقي يحسبه الخادم ----------
  const CART_KEY = 'ach_cart_v1';
  function getCart() {
    try { const c = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(c) ? c : []; }
    catch (e) { return []; }
  }
  function saveCart(c) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch (e) { /* تجاهل */ }
    window.dispatchEvent(new Event('cart:change'));
  }
  function addToCart(item) {
    const c = getCart();
    const f = c.find((i) => i.optionId === item.optionId);
    if (f) f.qty = Math.min(20, f.qty + item.qty); else c.push(item);
    saveCart(c);
  }
  const cartCount = () => getCart().reduce((s, i) => s + i.qty, 0);

  // ---------- الحساب ----------
  async function getUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.user) || null;
  }
  async function isAdmin() {
    const u = await getUser();
    if (!u) return false;
    const { data } = await sb.from('admins').select('user_id').eq('user_id', u.id).maybeSingle();
    return !!data;
  }

  // ---------- الواجهة المشتركة ----------
  const ICONS = {
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5C6 16.5 3 13 3 9.2 3 6.5 5 4.5 7.5 4.5c1.8 0 3.4 1 4.5 2.700C13.100 5.500 14.700 4.500 16.500 4.500 19 4.500 21 6.500 21 9.200c0 3.800-3 7.300-9 11.300z"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };
  const BOTTLE = '<svg class="bottle" viewBox="0 0 100 140" fill="none" stroke="#c9a24b" stroke-width="1.4"><rect x="38" y="6" width="24" height="16" rx="3"/><rect x="45" y="22" width="10" height="10"/><rect x="18" y="32" width="64" height="100" rx="12"/><path d="M30 64h40" opacity=".5"/><circle cx="50" cy="94" r="13" opacity=".6"/></svg>';

  function layout(active) {
    if (!configured) {
      const b = document.createElement('div');
      b.className = 'config-banner';
      b.textContent = 'المتجر غير مربوط بقاعدة البيانات بعد: عدّل ملف js/config.js وضع رابط Supabase والمفتاح العام.';
      document.body.prepend(b);
    }
    const link = (key, href, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
    const h = $('#site-header');
    if (h) {
      h.className = 'site-header';
      h.innerHTML = `<div class="container nav">
        <a class="logo" href="index.html" aria-label="ACH PARFUM"><span class="logo-mark">ACH</span><span class="logo-sub">PARFUM</span></a>
        <nav id="nav">
          ${link('home', 'index.html', 'الرئيسية')}
          ${link('shop', 'shop.html', 'العطور')}
          ${link('notes', 'shop.html#notes', 'النوتات العطرية')}
          ${link('families', 'index.html#families', 'العائلات العطرية')}
        </nav>
        <div class="nav-actions">
          <a class="icon-btn" href="account.html" aria-label="حسابي">${ICONS.user}</a>
          <a class="icon-btn" href="cart.html" aria-label="السلة">${ICONS.bag}<span class="badge" id="cart-badge" data-n="0"></span></a>
          <button class="icon-btn burger" id="burger" aria-label="القائمة">${ICONS.menu}</button>
        </div></div>`;
      $('#burger').addEventListener('click', () => $('#nav').classList.toggle('open'));
      const upd = () => { const n = cartCount(); const b = $('#cart-badge'); if (b) { b.textContent = n || ''; b.dataset.n = n; } };
      upd();
      window.addEventListener('cart:change', upd);
      window.addEventListener('storage', upd);
    }
    const f = $('#site-footer');
    if (f) {
      f.className = 'site-footer';
      const wa = cfg.WHATSAPP ? `<a href="https://wa.me/${esc(cfg.WHATSAPP)}" target="_blank" rel="noopener">واتساب</a>` : '';
      f.innerHTML = `<div class="container">
        <div class="logo"><span class="logo-mark" style="font-size:24px">ACH</span><span class="logo-sub">PARFUM</span></div>
        <nav><a href="index.html">الرئيسية</a><a href="shop.html">العطور</a><a href="account.html">حسابي</a><a href="cart.html">السلة</a>${wa}</nav>
        <div>عطور مركّبة حسب الطلب — تركيز وحجم على ذوقك</div>
        <div style="margin-top:6px;font-size:12px">© ${new Date().getFullYear()} ACH PARFUM</div></div>`;
    }
  }

  function needConfig(container) {
    if (configured) return false;
    container.innerHTML = '<div class="empty">لم يتم ربط قاعدة البيانات بعد.<br>افتح ملف <b>js/config.js</b> وضع بيانات Supabase.</div>';
    return true;
  }

  // ---------- تحميل البيانات ----------
  const PERFUME_SELECT =
    'id,name,brand,description,image_url,is_featured,is_active,created_at,' +
    'family:families(id,name),' +
    'perfume_notes(layer,note:notes(id,name,emoji,image_url)),' +
    'perfume_options(id,concentration,size,price,is_available,sort_order)';

  function normalizePerfume(r) {
    const notes = { top: [], heart: [], base: [] };
    const allNotes = [], noteIds = new Set();
    (r.perfume_notes || []).forEach((pn) => {
      if (!pn.note) return;
      (notes[pn.layer] || notes.top).push(pn.note);
      allNotes.push(pn.note);
      noteIds.add(pn.note.id);
    });
    const options = (r.perfume_options || []).slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const avail = options.filter((o) => o.is_available);
    const prices = (avail.length ? avail : options).map((o) => Number(o.price));
    return Object.assign({}, r, {
      family: r.family || null, notes, allNotes, noteIds, options,
      available: avail.length > 0,
      minPrice: prices.length ? Math.min.apply(null, prices) : null
    });
  }

  let catalogPromise = null;
  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetchAll((a, b) =>
        sb.from('perfumes').select(PERFUME_SELECT).eq('is_active', true)
          .order('id', { ascending: false }).range(a, b)
      ).then((rows) => rows.map(normalizePerfume));
      catalogPromise.catch(() => { catalogPromise = null; });
    }
    return catalogPromise;
  }
  async function loadPerfume(id) {
    const { data, error } = await sb.from('perfumes').select(PERFUME_SELECT).eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? normalizePerfume(data) : null;
  }
  async function loadFamilies() {
    const { data, error } = await sb.from('families').select('id,name,sort_order').order('sort_order').order('id');
    if (error) throw error;
    return data;
  }
  async function loadNotes() {
    const { data, error } = await sb.from('notes').select('id,name,emoji,image_url,sort_order').order('sort_order').order('id');
    if (error) throw error;
    return data;
  }

  // ---------- البحث الذكي بالنوتات ----------
  // يرتّب حسب عدد النوتات المتطابقة (الأعلى أولاً)، وداخل كل درجة: المتوفر قبل غير المتوفر.
  // النتائج ذات التطابق الجزئي لا تُخفى أبداً.
  function rank(list, selectedIds) {
    const sel = new Set((selectedIds || []).map(Number));
    if (!sel.size) return list.map((p) => ({ p, matched: [], score: 0 }));
    return list
      .map((p) => {
        const matched = p.allNotes.filter((n) => sel.has(n.id));
        return { p, matched, score: matched.length };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || (b.p.available ? 1 : 0) - (a.p.available ? 1 : 0) || b.p.id - a.p.id);
  }

  // ---------- المفضلة ----------
  let favSet = null;
  async function getFavs() {
    const u = await getUser();
    if (!u) return new Set();
    if (favSet) return favSet;
    const { data } = await sb.from('favorites').select('perfume_id');
    favSet = new Set((data || []).map((r) => r.perfume_id));
    return favSet;
  }
  async function toggleFav(perfumeId) {
    const u = await getUser();
    if (!u) {
      toast('سجّل الدخول لإضافة العطر إلى المفضلة. <a href="account.html">دخول</a>', null, true);
      return null;
    }
    const favs = await getFavs();
    if (favs.has(perfumeId)) {
      const { error } = await sb.from('favorites').delete().eq('user_id', u.id).eq('perfume_id', perfumeId);
      if (error) { toast(errMsg(error), 'err'); return null; }
      favs.delete(perfumeId);
      return false;
    }
    const { error } = await sb.from('favorites').insert({ user_id: u.id, perfume_id: perfumeId });
    if (error) { toast(errMsg(error), 'err'); return null; }
    favs.add(perfumeId);
    return true;
  }
  function bindFavs(root) {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('.fav');
      if (!btn) return;
      e.preventDefault();
      const r = await toggleFav(Number(btn.dataset.fav));
      if (r !== null) btn.classList.toggle('on', r);
    });
  }

  // ---------- عناصر العرض ----------
  function noteCircle(n, o) {
    o = o || {};
    const img = safeUrl(n.image_url);
    const ico = img ? `<img loading="lazy" src="${esc(img)}" alt="">` : esc(n.emoji || (n.name || '?').charAt(0));
    const cls = 'note-c' + (o.on ? ' on' : '') + (o.small ? ' sm' : '');
    const inner = `<span class="note-ico">${ico}</span><span class="note-name">${esc(n.name)}</span>`;
    return o.href
      ? `<a class="${cls}" href="${esc(o.href)}" title="${esc(n.name)}">${inner}</a>`
      : `<button type="button" class="${cls}" data-note="${n.id}" title="${esc(n.name)}">${inner}</button>`;
  }

  function card(p, o) {
    o = o || {};
    const img = safeUrl(p.image_url);
    const fav = o.favs && o.favs.has(p.id);
    const href = 'product.html?id=' + p.id;
    const match = o.total ? `<span class="match">${o.matched.length}/${o.total}</span>` : '';
    const mchips = o.matched && o.matched.length
      ? `<div class="chips">${o.matched.map((n) => `<span class="chip gold">${esc(n.name)}</span>`).join('')}</div>` : '';
    return `<article class="card${p.available ? '' : ' is-out'}">
      <button class="fav${fav ? ' on' : ''}" data-fav="${p.id}" aria-label="المفضلة">${ICONS.heart}</button>
      <a class="card-img" href="${href}">
        ${img ? `<img loading="lazy" src="${esc(img)}" alt="${esc(p.name)}">` : BOTTLE}
        ${p.available ? '' : '<span class="ribbon">غير متوفر</span>'}${match}
      </a>
      <div class="card-body">
        <div class="brand">${esc(p.brand)}</div>
        <h3><a href="${href}">${esc(p.name)}</a></h3>
        ${mchips}
        <div class="card-meta">
          ${p.family ? `<span class="chip">${esc(p.family.name)}</span>` : '<span></span>'}
          ${p.minPrice != null ? `<span class="price">من ${esc(fmt(p.minPrice))}</span>` : ''}
        </div>
      </div></article>`;
  }

  function showError(container, e) {
    container.innerHTML = `<div class="msg err">${esc(errMsg(e))}</div>`;
  }

  window.A = {
    cfg, configured, get sb() { return sb; },
    $, $$, esc, safeUrl, fmt, fmtDate, norm, errMsg, STATUS, toast, fetchAll,
    getCart, saveCart, addToCart, cartCount,
    getUser, isAdmin, layout, needConfig,
    loadCatalog, loadPerfume, loadFamilies, loadNotes, normalizePerfume, rank, PERFUME_SELECT,
    getFavs, toggleFav, bindFavs, noteCircle, card, showError, BOTTLE, ICONS
  };
})();
