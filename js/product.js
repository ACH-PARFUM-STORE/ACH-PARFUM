(async function () {
  'use strict';
  const { $, esc, safeUrl, fmt, noteCircle, card, BOTTLE, ICONS } = A;
  A.layout('shop');
  const root = $('#product');
  if (A.needConfig(root)) return;

  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) { root.innerHTML = '<div class="empty">العطر غير موجود.</div>'; return; }

  try {
    const p = await A.loadPerfume(id);
    if (!p || p.is_active === false) {
      root.innerHTML = '<div class="empty">هذا العطر غير موجود أو لم يعد معروضاً.<br><br><a class="btn" href="shop.html">العودة للعطور</a></div>';
      return;
    }
    document.title = `${p.name} — ${p.brand} | ACH PARFUM`;
    const favs = await A.getFavs();

    // التركيزات بترتيب ظهورها، والأحجام لكل تركيز
    const concs = [];
    p.options.forEach((o) => { if (!concs.includes(o.concentration)) concs.push(o.concentration); });
    const optsOf = (c) => p.options.filter((o) => o.concentration === c);
    let sel = p.options.find((o) => o.is_available) || p.options[0] || null;
    let qty = 1;

    const img = safeUrl(p.image_url);
    const tier = (key, title, en) => {
      const list = p.notes[key];
      if (!list.length) return '';
      return `<div class="tier"><h4>${title}<small>${en}</small></h4>
        <div class="notes-row">${list.map((n) => noteCircle(n, { href: 'shop.html?notes=' + n.id })).join('')}</div></div>`;
    };
    const pyramid = p.allNotes.length
      ? `<h3 style="margin-top:34px">الهرم العطري</h3><div class="pyramid" style="margin-top:10px">
          ${tier('top', 'النوتات العليا', 'Top Notes')}${tier('heart', 'نوتات القلب', 'Heart Notes')}${tier('base', 'النوتات الأساسية', 'Base Notes')}</div>`
      : '';

    root.innerHTML = `<div class="product">
      <div class="product-img">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}">` : BOTTLE}</div>
      <div>
        <div class="brand">${esc(p.brand)}</div>
        <h1>${esc(p.name)}</h1>
        <div class="chips" style="margin:6px 0 12px">
          ${p.family ? `<a class="chip gold" href="shop.html?family=${p.family.id}">${esc(p.family.name)}</a>` : ''}
          <span class="chip">${p.available ? 'متوفر' : 'غير متوفر حالياً'}</span>
        </div>
        ${p.description ? `<p class="muted" style="white-space:pre-line">${esc(p.description)}</p>` : ''}
        <div id="buy"></div>
        ${pyramid}
      </div></div>`;

    const buy = $('#buy');
    function renderBuy() {
      if (!p.options.length) {
        buy.innerHTML = '<div class="msg info">لا توجد خيارات شراء لهذا العطر حالياً.</div>';
        return;
      }
      const concBtns = concs.map((c, i) => {
        const any = optsOf(c).some((o) => o.is_available);
        return `<button type="button" class="opt${sel && sel.concentration === c ? ' on' : ''}" data-ci="${i}" ${any ? '' : 'disabled'}>${esc(c)}</button>`;
      }).join('');
      const sizeBtns = optsOf(sel.concentration).map((o) =>
        `<button type="button" class="opt${o.id === sel.id ? ' on' : ''}" data-oid="${o.id}" ${o.is_available ? '' : 'disabled'}>${esc(o.size)}${o.is_available ? '' : ' (نفد)'}</button>`
      ).join('');
      const canBuy = sel.is_available;
      buy.innerHTML = `
        <div class="opt-group"><h4>التركيز</h4><div class="opt-btns">${concBtns}</div></div>
        <div class="opt-group"><h4>الحجم</h4><div class="opt-btns">${sizeBtns}</div></div>
        <div class="price-big">${canBuy ? esc(fmt(sel.price * qty)) : 'غير متوفر'}
          ${canBuy && qty > 1 ? `<small class="muted" style="font-size:14px;font-weight:400"> (${esc(fmt(sel.price))} للواحد)</small>` : ''}</div>
        <div class="buy-row">
          <div class="qty"><button type="button" data-q="-1" aria-label="أنقص">−</button><span>${qty}</span><button type="button" data-q="1" aria-label="زِد">+</button></div>
          <button type="button" class="btn" id="add" ${canBuy ? '' : 'disabled'}>أضف إلى السلة</button>
          <button type="button" class="btn btn-ghost" id="fav-btn" aria-label="المفضلة">${favs.has(p.id) ? '♥ في المفضلة' : '♡ أضف للمفضلة'}</button>
        </div>`;
    }

    buy.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-ci]');
      if (c) {
        const conc = concs[Number(c.dataset.ci)];
        const list = optsOf(conc);
        sel = list.find((o) => o.size === sel.size && o.is_available) || list.find((o) => o.is_available) || list[0];
        return renderBuy();
      }
      const o = e.target.closest('[data-oid]');
      if (o) { sel = p.options.find((x) => x.id === Number(o.dataset.oid)); return renderBuy(); }
      const q = e.target.closest('[data-q]');
      if (q) { qty = Math.max(1, Math.min(20, qty + Number(q.dataset.q))); return renderBuy(); }
      if (e.target.closest('#add')) {
        A.addToCart({
          optionId: sel.id, perfumeId: p.id, name: p.name, brand: p.brand, image: img,
          concentration: sel.concentration, size: sel.size, price: Number(sel.price), qty
        });
        A.toast('تمت الإضافة إلى السلة. <a href="cart.html">عرض السلة</a>', null, true);
        return;
      }
      if (e.target.closest('#fav-btn')) {
        const r = await A.toggleFav(p.id);
        if (r !== null) renderBuy();
      }
    });
    renderBuy();

    // عطور مشابهة: تشارك النوتات أو العائلة
    A.loadCatalog().then((all) => {
      const scored = all.filter((x) => x.id !== p.id).map((x) => {
        let s = 0;
        x.allNotes.forEach((n) => { if (p.noteIds.has(n.id)) s += 1; });
        if (p.family && x.family && p.family.id === x.family.id) s += 1;
        return { x, s };
      }).filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || (b.x.available ? 1 : 0) - (a.x.available ? 1 : 0)).slice(0, 4);
      if (!scored.length) return;
      $('#related').innerHTML = scored.map((r) => card(r.x, { favs })).join('');
      $('#related-sec').classList.remove('hidden');
      A.bindFavs($('#related'));
    }).catch(() => { /* المشابهة اختيارية */ });
  } catch (e) {
    A.showError(root, e);
  }
})();
