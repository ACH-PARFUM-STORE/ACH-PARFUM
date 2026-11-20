(async function () {
  'use strict';
  const { $, esc, card, noteCircle, norm } = A;
  A.layout(location.hash === '#notes' ? 'notes' : 'shop');
  const results = $('#results');
  if (A.needConfig(results)) return;

  const PAGE = 24;
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') || '',
    family: params.get('family') || '',
    brand: params.get('brand') || '',
    notes: new Set((params.get('notes') || '').split(',').map(Number).filter(Boolean)),
    avail: params.get('avail') === '1',
    sort: params.get('sort') || 'relevance',
    shown: PAGE
  };
  let noteFilter = '';

  try {
    const [catalog, families, notes, favs] = await Promise.all([
      A.loadCatalog(), A.loadFamilies(), A.loadNotes(), A.getFavs()
    ]);
    const noteById = new Map(notes.map((n) => [n.id, n]));
    // نتجاهل نوتات غير موجودة في الرابط
    state.notes.forEach((id) => { if (!noteById.has(id)) state.notes.delete(id); });

    catalog.forEach((p) => {
      p._hay = norm([p.name, p.brand, p.description, p.family && p.family.name,
        p.allNotes.map((n) => n.name).join(' ')].join(' '));
    });

    // تعبئة القوائم
    const fam = $('#f-family'), brand = $('#f-brand');
    families.forEach((f) => fam.insertAdjacentHTML('beforeend', `<option value="${f.id}">${esc(f.name)}</option>`));
    [...new Set(catalog.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      .forEach((b) => brand.insertAdjacentHTML('beforeend', `<option value="${esc(b)}">${esc(b)}</option>`));
    $('#f-q').value = state.q; fam.value = state.family; brand.value = state.brand;
    $('#f-avail').checked = state.avail; $('#f-sort').value = state.sort;

    // ---------- النوتات ----------
    function renderNotes() {
      const q = norm(noteFilter);
      const list = notes.filter((n) => !q || norm(n.name).includes(q));
      $('#notes-pick').innerHTML = list.length
        ? list.map((n) => noteCircle(n, { on: state.notes.has(n.id), small: true })).join('')
        : '<span class="muted">لا توجد نوتة بهذا الاسم.</span>';
      const sel = [...state.notes].map((id) => noteById.get(id)).filter(Boolean);
      $('#selected-bar').innerHTML = sel.length
        ? sel.map((n) => `<span class="chip gold chip-x" data-rm="${n.id}">${esc(n.name)} ✕</span>`).join('') +
          '<button class="btn btn-ghost btn-sm" id="clear-notes" type="button">مسح الكل</button>'
        : '';
      $('#sel-count').textContent = sel.length ? `${sel.length} نوتة مختارة` : '';
    }

    // ---------- النتائج ----------
    function compute() {
      let list = catalog;
      if (state.family) list = list.filter((p) => p.family && String(p.family.id) === state.family);
      if (state.brand) list = list.filter((p) => p.brand === state.brand);
      if (state.avail) list = list.filter((p) => p.available);
      const q = norm(state.q);
      if (q) list = list.filter((p) => p._hay.includes(q));

      const ranked = A.rank(list, [...state.notes]);
      const byRelevance = state.sort === 'relevance' && state.notes.size > 0;
      if (!byRelevance) {
        const price = (r) => (r.p.minPrice == null ? Infinity : r.p.minPrice);
        const cmp = {
          relevance: (a, b) => b.p.id - a.p.id,
          newest: (a, b) => b.p.id - a.p.id,
          'price-asc': (a, b) => price(a) - price(b),
          'price-desc': (a, b) => (b.p.minPrice == null ? -1 : b.p.minPrice) - (a.p.minPrice == null ? -1 : a.p.minPrice),
          name: (a, b) => a.p.name.localeCompare(b.p.name)
        }[state.sort] || ((a, b) => b.p.id - a.p.id);
        ranked.sort(cmp);
      }
      return { ranked, byRelevance };
    }

    function renderResults() {
      const { ranked, byRelevance } = compute();
      const total = state.notes.size;
      const availN = ranked.filter((r) => r.p.available).length;
      $('#count').textContent = ranked.length
        ? `${ranked.length} عطر${total ? ' مطابق' : ''} — ${availN} متوفر`
        : '';
      if (!ranked.length) {
        results.innerHTML = '<div class="empty">لا توجد عطور مطابقة. جرّب إزالة بعض الفلاتر أو النوتات.</div>';
        $('#more').classList.add('hidden');
        return;
      }
      const slice = ranked.slice(0, state.shown);
      let html = '', lastScore = null, open = false;
      slice.forEach((r) => {
        if (byRelevance && total > 1 && r.score !== lastScore) {
          if (open) html += '</div>';
          const title = r.score === total ? `تطابق كامل` : `تطابق ${r.score} من ${total} نوتات`;
          html += `<div class="group-title"><span class="score">${r.score}/${total}</span>${title}</div><div class="grid">`;
          open = true; lastScore = r.score;
        } else if (!open) { html += '<div class="grid">'; open = true; }
        html += card(r.p, { favs, matched: r.matched, total: total || 0 });
      });
      if (open) html += '</div>';
      results.innerHTML = html;
      $('#more').classList.toggle('hidden', ranked.length <= state.shown);
    }

    function syncUrl() {
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.family) p.set('family', state.family);
      if (state.brand) p.set('brand', state.brand);
      if (state.notes.size) p.set('notes', [...state.notes].join(','));
      if (state.avail) p.set('avail', '1');
      if (state.sort !== 'relevance') p.set('sort', state.sort);
      const s = p.toString();
      try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* تجاهل */ }
    }
    const refresh = () => { state.shown = PAGE; syncUrl(); renderNotes(); renderResults(); };

    // ---------- الأحداث ----------
    let t;
    $('#f-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; refresh(); }, 200); });
    fam.addEventListener('change', () => { state.family = fam.value; refresh(); });
    brand.addEventListener('change', () => { state.brand = brand.value; refresh(); });
    $('#f-sort').addEventListener('change', (e) => { state.sort = e.target.value; refresh(); });
    $('#f-avail').addEventListener('change', (e) => { state.avail = e.target.checked; refresh(); });
    $('#note-q').addEventListener('input', (e) => { noteFilter = e.target.value; renderNotes(); });
    $('#more').addEventListener('click', () => { state.shown += PAGE; renderResults(); });

    $('#notes-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-note]');
      if (!b) return;
      const id = Number(b.dataset.note);
      if (state.notes.has(id)) state.notes.delete(id); else state.notes.add(id);
      refresh();
    });
    $('#selected-bar').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { state.notes.delete(Number(rm.dataset.rm)); refresh(); return; }
      if (e.target.closest('#clear-notes')) { state.notes.clear(); refresh(); }
    });
    A.bindFavs(results);

    renderNotes();
    renderResults();
    if (location.hash === '#notes') $('#notes-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    A.showError(results, e);
  }
})();
