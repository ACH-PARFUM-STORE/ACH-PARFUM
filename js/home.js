(async function () {
  'use strict';
  const { $, esc, card, noteCircle } = A;
  A.layout('home');

  $('#hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#hero-q').value.trim();
    location.href = 'shop.html' + (q ? '?q=' + encodeURIComponent(q) : '');
  });

  if (A.needConfig($('#featured'))) return;

  try {
    const [catalog, families, notes, favs] = await Promise.all([
      A.loadCatalog(), A.loadFamilies(), A.loadNotes(), A.getFavs()
    ]);

    const grid = (el, list) => {
      el.innerHTML = list.length
        ? list.map((p) => card(p, { favs })).join('')
        : '<div class="empty" style="grid-column:1/-1">لا توجد عطور بعد.</div>';
    };

    const featured = catalog.filter((p) => p.is_featured).slice(0, 8);
    if (featured.length) grid($('#featured'), featured);
    else $('#featured-sec').classList.add('hidden');
    grid($('#newest'), catalog.slice(0, 8));

    // النوتات الأكثر استعمالاً
    const usage = new Map();
    catalog.forEach((p) => p.allNotes.forEach((n) => usage.set(n.id, (usage.get(n.id) || 0) + 1)));
    const topNotes = notes.filter((n) => usage.get(n.id))
      .sort((a, b) => usage.get(b.id) - usage.get(a.id)).slice(0, 18);
    $('#notes-row').innerHTML = topNotes.length
      ? topNotes.map((n) => noteCircle(n, { href: 'shop.html?notes=' + n.id })).join('')
      : '<div class="empty">ستظهر النوتات هنا بعد إضافة العطور.</div>';

    // العائلات مع عدد العطور
    const famCount = new Map();
    catalog.forEach((p) => { if (p.family) famCount.set(p.family.id, (famCount.get(p.family.id) || 0) + 1); });
    const fams = families.filter((f) => famCount.get(f.id));
    $('#fam-grid').innerHTML = fams.length
      ? fams.map((f) => `<a class="fam" href="shop.html?family=${f.id}"><b>${esc(f.name)}</b><span>${famCount.get(f.id)} عطر</span></a>`).join('')
      : '<div class="empty" style="grid-column:1/-1">لا توجد عائلات بعد.</div>';

    A.bindFavs($('#home-content'));
  } catch (e) {
    ['#featured', '#newest', '#notes-row', '#fam-grid'].forEach((s) => A.showError($(s), e));
  }
})();
