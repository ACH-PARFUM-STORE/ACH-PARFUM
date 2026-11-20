// ACH PARFUM — لوحة تحكم المدير
// الحماية الحقيقية في الخادم (RLS + جدول admins). هذا الكود يعرض الواجهة فقط.
(function () {
  'use strict';
  const { $, $$, esc, safeUrl, fmt, fmtDate, norm, errMsg, STATUS, toast, fetchAll } = A;
  A.layout('admin');
  const root = $('#admin');
  if (A.needConfig(root)) return;
  const sb = A.sb;
  const LOADER = '<div class="loader"></div>';
  const KEY = (c, s) => c + '\u0001' + s;
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const dbErr = (e) => (e && e.code === '23505') ? 'يوجد عنصر بنفس الاسم مسبقاً.' : errMsg(e);

  function openModal(inner) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal">${inner}</div>`;
    document.body.appendChild(bg);
    document.body.style.overflow = 'hidden';
    const close = () => { bg.remove(); document.body.style.overflow = ''; };
    return { el: bg.firstElementChild, close };
  }

  async function uploadImage(file, folder) {
    if (file.size > 5 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 5MB');
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.type)) throw new Error('نوع الصورة غير مدعوم (استعمل PNG أو JPG أو WEBP)');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from('images').upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type });
    if (error) throw error;
    return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
  }

  // =====================================================================
  // الدخول
  // =====================================================================
  function viewLogin(msg) {
    root.innerHTML = `<div class="auth-box"><h3 class="center">لوحة التحكم</h3>
      <div id="lg-msg">${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}</div>
      <form id="lg-form">
        <div class="field"><label class="lbl" for="lg-email">البريد الإلكتروني</label><input id="lg-email" class="input" type="email" dir="ltr" autocomplete="email" required></div>
        <div class="field"><label class="lbl" for="lg-pass">كلمة المرور</label><input id="lg-pass" class="input" type="password" dir="ltr" autocomplete="current-password" required></div>
        <button class="btn btn-block" type="submit">دخول</button></form></div>`;
    $('#lg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: $('#lg-email').value.trim(), password: $('#lg-pass').value });
      if (error) { $('#lg-msg').innerHTML = '<div class="msg err">البريد أو كلمة المرور غير صحيحة.</div>'; return; }
      start();
    });
  }

  function viewDenied() {
    root.innerHTML = `<div class="auth-box center"><h3>غير مصرّح</h3>
      <p class="muted">هذا الحساب ليس حساب المدير.</p>
      <button class="btn btn-ghost" id="lo">تسجيل الخروج</button></div>`;
    $('#lo').addEventListener('click', async () => { await sb.auth.signOut(); start(); });
  }

  // =====================================================================
  // الهيكل
  // =====================================================================
  const TABS = [
    ['perfumes', 'العطور'], ['families', 'العائلات العطرية'], ['notes', 'النوتات العطرية'],
    ['orders', 'الطلبات'], ['customers', 'العملاء'], ['import', 'استيراد Excel / CSV']
  ];
  const tabs = {};
  let pane;

  function viewShell() {
    root.innerHTML = `<div class="admin-shell">
      <aside class="side">
        ${TABS.map(([k, t]) => `<button data-tab="${k}">${t}</button>`).join('')}
        <hr style="border:0;border-top:1px solid var(--line);width:100%;margin:6px 0">
        <button id="a-store">عرض المتجر</button>
        <button id="a-logout" style="color:var(--danger)">تسجيل الخروج</button>
      </aside>
      <section id="pane" style="min-width:0"></section></div>`;
    pane = $('#pane');
    const go = (k) => {
      $$('.side [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
      // لوحة جديدة في كل مرة حتى لا تتراكم مستمعات الأحداث من التبويبات السابقة
      const fresh = document.createElement('section');
      fresh.id = 'pane'; fresh.style.minWidth = '0';
      pane.replaceWith(fresh); pane = fresh;
      pane.innerHTML = LOADER;
      Promise.resolve(tabs[k]()).catch((e) => { pane.innerHTML = `<div class="msg err">${esc(errMsg(e))}</div>`; });
    };
    $$('.side [data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
    $('#a-store').addEventListener('click', () => { location.href = 'index.html'; });
    $('#a-logout').addEventListener('click', async () => { await sb.auth.signOut(); start(); });
    tabs._go = go;
    go('orders');
  }

  // =====================================================================
  // العطور
  // =====================================================================
  const PAGE = 40;
  tabs.perfumes = async function () {
    const [rows, fams, notes] = await Promise.all([
      fetchAll((a, b) => sb.from('perfumes').select(A.PERFUME_SELECT).order('id', { ascending: false }).range(a, b)),
      A.loadFamilies(), A.loadNotes()
    ]);
    const list = rows.map(A.normalizePerfume);
    const st = { q: '', f: 'all', page: 0 };

    pane.innerHTML = `<div class="toolbar">
        <input id="pl-q" class="input" type="search" placeholder="ابحث بالاسم أو الماركة...">
        <select id="pl-f" class="input" style="max-width:190px">
          <option value="all">كل العطور</option><option value="active">المعروضة</option><option value="hidden">المخفية</option>
          <option value="out">غير المتوفرة</option></select>
        <span class="spacer"></span><span class="muted" id="pl-count"></span>
        <button class="btn" id="pl-add">+ إضافة عطر</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th></th><th>العطر</th><th>العائلة</th><th>الحالة</th><th>الخيارات</th><th></th></tr></thead><tbody id="pl-body"></tbody></table></div>
      <div class="toolbar" style="margin-top:12px;justify-content:center"><button class="btn btn-ghost btn-sm" id="pl-prev">السابق</button><span id="pl-page" class="muted"></span><button class="btn btn-ghost btn-sm" id="pl-next">التالي</button></div>`;

    const filtered = () => {
      const q = norm(st.q);
      return list.filter((p) => {
        if (q && !norm(p.name + ' ' + p.brand).includes(q)) return false;
        if (st.f === 'active') return p.is_active;
        if (st.f === 'hidden') return !p.is_active;
        if (st.f === 'out') return !p.available;
        return true;
      });
    };
    const draw = () => {
      const f = filtered();
      const pages = Math.max(1, Math.ceil(f.length / PAGE));
      st.page = Math.min(st.page, pages - 1);
      $('#pl-count').textContent = `${f.length} عطر`;
      $('#pl-page').textContent = `${st.page + 1} / ${pages}`;
      $('#pl-body').innerHTML = f.slice(st.page * PAGE, (st.page + 1) * PAGE).map((p) => {
        const img = safeUrl(p.image_url);
        const av = p.options.filter((o) => o.is_available).length;
        return `<tr><td>${img ? `<img class="t-img" src="${esc(img)}" alt="">` : '<div class="t-img"></div>'}</td>
          <td><b dir="ltr">${esc(p.name)}</b><div class="muted" dir="ltr" style="text-align:start;font-size:13px">${esc(p.brand)}</div></td>
          <td>${p.family ? esc(p.family.name) : '<span class="muted">—</span>'}</td>
          <td><span class="dot ${p.is_active ? '' : 'off'}"></span>${p.is_active ? 'معروض' : 'مخفي'}${p.is_featured ? ' · ⭐ مميز' : ''}</td>
          <td>${p.options.length} <span class="muted">(${av} متوفر)</span></td>
          <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">تعديل</button><button class="btn btn-danger btn-sm" data-del="${p.id}">حذف</button></div></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="center muted" style="padding:30px">لا توجد عطور.</td></tr>';
    };
    let t;
    $('#pl-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 200); });
    $('#pl-f').addEventListener('change', (e) => { st.f = e.target.value; st.page = 0; draw(); });
    $('#pl-prev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); draw(); });
    $('#pl-next').addEventListener('click', () => { st.page += 1; draw(); });
    const reload = () => tabs._go('perfumes');
    $('#pl-add').addEventListener('click', () => editPerfume(null, fams, notes, reload));
    $('#pl-body').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return editPerfume(list.find((p) => p.id === Number(ed.dataset.edit)), fams, notes, reload);
      const del = e.target.closest('[data-del]');
      if (del) {
        const p = list.find((x) => x.id === Number(del.dataset.del));
        if (!confirm(`حذف العطر «${p.name}» نهائياً مع كل خياراته؟ (الطلبات القديمة تبقى محفوظة)`)) return;
        const { error } = await sb.from('perfumes').delete().eq('id', p.id);
        if (error) return toast(dbErr(error), 'err');
        toast('تم الحذف'); reload();
      }
    });
    draw();
  };

  function editPerfume(p, fams, notesList, done) {
    const allNotes = notesList.slice();
    const st = {
      layers: { top: [], heart: [], base: [] }, concs: [], sizes: [], cells: {},
      image: p ? (p.image_url || '') : ''
    };
    if (p) {
      ['top', 'heart', 'base'].forEach((k) => { st.layers[k] = p.notes[k].map((n) => n.id); });
      p.options.forEach((o) => {
        if (!st.concs.includes(o.concentration)) st.concs.push(o.concentration);
        if (!st.sizes.includes(o.size)) st.sizes.push(o.size);
        st.cells[KEY(o.concentration, o.size)] = { price: String(Number(o.price)), available: o.is_available };
      });
    } else {
      st.concs = ['ضربة 1', 'ضربة 3', 'ضربة 6'];
      st.sizes = ['10ml', '30ml', '50ml', '100ml'];
    }

    const m = openModal(`<h3>${p ? 'تعديل عطر' : 'إضافة عطر'}</h3><div id="e-msg"></div>
      <div class="grid2">
        <div class="field"><label class="lbl">اسم العطر *</label><input id="e-name" class="input" maxlength="150" value="${esc(p ? p.name : '')}"></div>
        <div class="field"><label class="lbl">الماركة</label><input id="e-brand" class="input" maxlength="150" value="${esc(p ? p.brand : '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="lbl">العائلة العطرية</label>
          <select id="e-family" class="input"><option value="">— بدون —</option>
            ${fams.map((f) => `<option value="${f.id}" ${p && p.family && p.family.id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">صورة العطر (رابط أو رفع)</label>
          <input id="e-img" class="input" dir="ltr" placeholder="https://..." value="${esc(st.image)}">
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="file" id="e-file" accept="image/png,image/jpeg,image/webp,image/gif" style="max-width:100%">
          <img id="e-prev" class="t-img" alt="" style="${safeUrl(st.image) ? '' : 'display:none'}" src="${esc(safeUrl(st.image))}"></div></div>
      </div>
      <div class="field"><label class="lbl">وصف الرائحة</label><textarea id="e-desc" class="input" maxlength="3000">${esc(p ? p.description : '')}</textarea></div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px">
        <label class="check"><input type="checkbox" id="e-feat" ${p && p.is_featured ? 'checked' : ''}> عطر مميز (يظهر في الرئيسية)</label>
        <label class="check"><input type="checkbox" id="e-active" ${!p || p.is_active ? 'checked' : ''}> معروض في المتجر</label></div>
      <h4 class="gold">الهرم العطري</h4><div id="pickers"></div>
      <h4 class="gold" style="margin-top:18px">التركيزات والأحجام والأسعار</h4><div id="matrix"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="e-cancel" type="button">إلغاء</button><button class="btn" id="e-save" type="button">حفظ</button></div>`);
    const q = (s) => $(s, m.el);

    // --- الصورة ---
    const showPrev = () => { const u = safeUrl(st.image); const im = q('#e-prev'); im.src = u; im.style.display = u ? '' : 'none'; };
    q('#e-img').addEventListener('input', (e) => { st.image = e.target.value.trim(); showPrev(); });
    q('#e-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        toast('جارٍ رفع الصورة...');
        st.image = await uploadImage(f, 'perfumes');
        q('#e-img').value = st.image; showPrev(); toast('تم رفع الصورة');
      } catch (err) { toast(errMsg(err), 'err'); }
    });

    // --- النوتات ---
    const LAYERS = [['top', 'النوتات العليا (Top)'], ['heart', 'نوتات القلب (Heart)'], ['base', 'النوتات الأساسية (Base)']];
    const noteName = (id) => (allNotes.find((n) => n.id === id) || {}).name || '?';
    function renderPickers() {
      const used = new Set([...st.layers.top, ...st.layers.heart, ...st.layers.base]);
      q('#pickers').innerHTML = LAYERS.map(([k, title]) => `<div class="picker"><h5>${title}</h5>
        <div class="chips" style="margin-bottom:8px">${st.layers[k].map((id) => `<span class="chip gold chip-x" data-layer="${k}" data-rm="${id}">${esc(noteName(id))} ✕</span>`).join('') || '<span class="muted" style="font-size:13px">لا توجد نوتات</span>'}</div>
        <select class="input" data-add="${k}"><option value="">＋ إضافة نوتة...</option>
          ${allNotes.filter((n) => !used.has(n.id)).map((n) => `<option value="${n.id}">${esc((n.emoji || '') + ' ' + n.name)}</option>`).join('')}
          <option value="__new">✚ إنشاء نوتة جديدة...</option></select></div>`).join('');
    }
    q('#pickers').addEventListener('click', (e) => {
      const c = e.target.closest('[data-rm]');
      if (!c) return;
      const k = c.dataset.layer;
      st.layers[k] = st.layers[k].filter((id) => id !== Number(c.dataset.rm));
      renderPickers();
    });
    q('#pickers').addEventListener('change', async (e) => {
      const s = e.target.closest('[data-add]');
      if (!s || !s.value) return;
      const k = s.dataset.add;
      if (s.value === '__new') {
        const name = (prompt('اسم النوتة الجديدة:') || '').trim();
        if (!name) return renderPickers();
        const ex = allNotes.find((n) => norm(n.name) === norm(name));
        if (ex) { if (![...st.layers.top, ...st.layers.heart, ...st.layers.base].includes(ex.id)) st.layers[k].push(ex.id); return renderPickers(); }
        const { data, error } = await sb.from('notes').insert({ name, sort_order: 100 }).select('id,name,emoji,image_url,sort_order').single();
        if (error) { toast(dbErr(error), 'err'); return renderPickers(); }
        allNotes.push(data); notesList.push(data);
        st.layers[k].push(data.id);
      } else st.layers[k].push(Number(s.value));
      renderPickers();
    });

    // --- مصفوفة التركيز × الحجم ---
    function renderMatrix() {
      const head = st.sizes.map((s, j) => `<th>${esc(s)} <button type="button" class="x" data-del-size="${j}" title="حذف الحجم">✕</button></th>`).join('');
      const rows = st.concs.map((c, i) => `<tr><td class="rowh">${esc(c)} <button type="button" class="x" data-del-conc="${i}" title="حذف التركيز">✕</button></td>
        ${st.sizes.map((s, j) => {
          const cell = st.cells[KEY(c, s)] || { price: '', available: true };
          return `<td><div class="cell"><input type="number" min="0" step="any" placeholder="السعر" data-k="${i}:${j}" data-f="price" value="${esc(cell.price)}">
            <label class="check" style="font-size:13px"><input type="checkbox" data-k="${i}:${j}" data-f="avail" ${cell.available ? 'checked' : ''}> متوفر</label></div></td>`;
        }).join('')}</tr>`).join('');
      q('#matrix').innerHTML = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
        <div class="toolbar" style="margin-top:10px">
          <input class="input" id="m-conc" placeholder="تركيز جديد (مثال: ضربة 9)" style="max-width:230px"><button type="button" class="btn btn-ghost btn-sm" id="m-add-conc">+ تركيز</button>
          <input class="input" id="m-size" placeholder="حجم جديد (مثال: 200ml)" style="max-width:230px" dir="ltr"><button type="button" class="btn btn-ghost btn-sm" id="m-add-size">+ حجم</button></div>
        <p class="muted" style="font-size:13px;margin:0">اترك السعر فارغاً إن لم تكن هذه التركيبة موجودة. ألغِ «متوفر» لخيار نفد وحده دون التأثير على بقية الخيارات.</p>`;
    }
    const cellOf = (k) => {
      const [i, j] = k.split(':').map(Number);
      const key = KEY(st.concs[i], st.sizes[j]);
      return st.cells[key] || (st.cells[key] = { price: '', available: true });
    };
    q('#matrix').addEventListener('input', (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      const c = cellOf(e.target.dataset.k);
      if (f === 'price') c.price = e.target.value; else c.available = e.target.checked;
    });
    q('#matrix').addEventListener('click', (e) => {
      const dc = e.target.closest('[data-del-conc]');
      if (dc) {
        const c = st.concs[Number(dc.dataset.delConc)];
        if (!confirm(`حذف التركيز «${c}» وكل أسعاره؟`)) return;
        st.concs = st.concs.filter((x) => x !== c);
        st.sizes.forEach((s) => delete st.cells[KEY(c, s)]);
        return renderMatrix();
      }
      const ds = e.target.closest('[data-del-size]');
      if (ds) {
        const s = st.sizes[Number(ds.dataset.delSize)];
        if (!confirm(`حذف الحجم «${s}» وكل أسعاره؟`)) return;
        st.sizes = st.sizes.filter((x) => x !== s);
        st.concs.forEach((c) => delete st.cells[KEY(c, s)]);
        return renderMatrix();
      }
      if (e.target.closest('#m-add-conc')) {
        const v = q('#m-conc').value.trim();
        if (v && !st.concs.includes(v)) st.concs.push(v);
        return renderMatrix();
      }
      if (e.target.closest('#m-add-size')) {
        const v = q('#m-size').value.trim();
        if (v && !st.sizes.includes(v)) st.sizes.push(v);
        return renderMatrix();
      }
    });

    renderPickers(); renderMatrix();
    q('#e-cancel').addEventListener('click', m.close);

    // --- الحفظ ---
    q('#e-save').addEventListener('click', async () => {
      const msg = q('#e-msg');
      const fail = (t) => { msg.innerHTML = `<div class="msg err">${esc(t)}</div>`; msg.scrollIntoView({ block: 'center' }); };
      const name = q('#e-name').value.trim();
      if (!name) return fail('اسم العطر مطلوب.');
      const img = st.image.trim();
      if (img && !safeUrl(img)) return fail('رابط الصورة يجب أن يبدأ بـ http:// أو https://');

      const optRows = [];
      for (let i = 0; i < st.concs.length; i++) {
        for (let j = 0; j < st.sizes.length; j++) {
          const c = st.cells[KEY(st.concs[i], st.sizes[j])];
          if (!c || String(c.price).trim() === '') continue;
          const price = Number(c.price);
          if (!isFinite(price) || price < 0) return fail(`سعر غير صالح في: ${st.concs[i]} / ${st.sizes[j]}`);
          optRows.push({ concentration: st.concs[i], size: st.sizes[j], price, is_available: !!c.available, sort_order: (i + 1) * 100 + (j + 1) });
        }
      }
      const btn = q('#e-save'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
      try {
        const payload = {
          name, brand: q('#e-brand').value.trim(), description: q('#e-desc').value.trim(),
          image_url: img || null, family_id: q('#e-family').value ? Number(q('#e-family').value) : null,
          is_featured: q('#e-feat').checked, is_active: q('#e-active').checked
        };
        let id;
        if (p) {
          const { error } = await sb.from('perfumes').update(payload).eq('id', p.id);
          if (error) throw error;
          id = p.id;
        } else {
          const { data, error } = await sb.from('perfumes').insert(payload).select('id').single();
          if (error) throw error;
          id = data.id;
        }
        // النوتات: نستبدلها بالكامل
        let r = await sb.from('perfume_notes').delete().eq('perfume_id', id);
        if (r.error) throw r.error;
        const nrows = [];
        const seen = new Set();
        ['top', 'heart', 'base'].forEach((k) => st.layers[k].forEach((nid) => {
          if (!seen.has(nid)) { seen.add(nid); nrows.push({ perfume_id: id, note_id: nid, layer: k }); }
        }));
        if (nrows.length) { r = await sb.from('perfume_notes').insert(nrows); if (r.error) throw r.error; }
        // الخيارات: تحديث/إضافة، وحذف ما أُزيل فقط
        if (optRows.length) {
          r = await sb.from('perfume_options').upsert(optRows.map((o) => Object.assign({ perfume_id: id }, o)), { onConflict: 'perfume_id,concentration,size' });
          if (r.error) throw r.error;
        }
        if (p) {
          const keep = new Set(optRows.map((o) => KEY(o.concentration, o.size)));
          const removed = p.options.filter((o) => !keep.has(KEY(o.concentration, o.size))).map((o) => o.id);
          if (removed.length) { r = await sb.from('perfume_options').delete().in('id', removed); if (r.error) throw r.error; }
        }
        m.close(); toast('تم الحفظ'); done();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'حفظ';
        fail(dbErr(e));
      }
    });
  }

  // =====================================================================
  // العائلات
  // =====================================================================
  tabs.families = async function () {
    const [fams, perfs] = await Promise.all([
      A.loadFamilies(),
      fetchAll((a, b) => sb.from('perfumes').select('id,family_id').order('id').range(a, b))
    ]);
    const cnt = new Map();
    perfs.forEach((p) => { if (p.family_id) cnt.set(p.family_id, (cnt.get(p.family_id) || 0) + 1); });
    pane.innerHTML = `<h2>العائلات العطرية</h2>
      <div class="toolbar"><input id="f-new" class="input" placeholder="اسم عائلة جديدة (مثال: خشبي)"><button class="btn" id="f-add">+ إضافة</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>الاسم</th><th style="width:110px">الترتيب</th><th>عدد العطور</th><th></th></tr></thead><tbody>
      ${fams.map((f) => `<tr data-id="${f.id}"><td><input class="input" data-f="name" value="${esc(f.name)}" maxlength="60"></td>
        <td><input class="input" type="number" data-f="sort_order" value="${f.sort_order}"></td><td>${cnt.get(f.id) || 0}</td>
        <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-save>حفظ</button><button class="btn btn-danger btn-sm" data-del>حذف</button></div></td></tr>`).join('')
        || '<tr><td colspan="4" class="center muted" style="padding:24px">لا توجد عائلات.</td></tr>'}</tbody></table></div>`;
    const reload = () => tabs._go('families');
    $('#f-add').addEventListener('click', async () => {
      const name = $('#f-new').value.trim();
      if (!name) return;
      const { error } = await sb.from('families').insert({ name, sort_order: fams.length + 1 });
      if (error) return toast(dbErr(error), 'err');
      reload();
    });
    pane.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      if (e.target.closest('[data-save]')) {
        const name = $('[data-f=name]', tr).value.trim();
        if (!name) return toast('الاسم مطلوب', 'err');
        const { error } = await sb.from('families').update({ name, sort_order: Number($('[data-f=sort_order]', tr).value) || 0 }).eq('id', id);
        return error ? toast(dbErr(error), 'err') : toast('تم الحفظ');
      }
      if (e.target.closest('[data-del]')) {
        if (!confirm('حذف هذه العائلة؟ العطور التابعة لها ستبقى بدون عائلة.')) return;
        const { error } = await sb.from('families').delete().eq('id', id);
        if (error) return toast(dbErr(error), 'err');
        reload();
      }
    });
  };

  // =====================================================================
  // النوتات
  // =====================================================================
  tabs.notes = async function () {
    const [notes, pn] = await Promise.all([
      A.loadNotes(),
      fetchAll((a, b) => sb.from('perfume_notes').select('perfume_id,note_id').order('perfume_id').order('note_id').range(a, b))
    ]);
    const cnt = new Map();
    pn.forEach((r) => cnt.set(r.note_id, (cnt.get(r.note_id) || 0) + 1));
    pane.innerHTML = `<div class="toolbar"><h2 style="margin:0">النوتات العطرية</h2><span class="spacer"></span><button class="btn" id="n-add">+ إضافة نوتة</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${notes.map((n) => {
        const img = safeUrl(n.image_url);
        return `<div class="note-card"><div class="note-ico" style="width:72px;height:72px">${img ? `<img src="${esc(img)}" alt="">` : esc(n.emoji || n.name.charAt(0))}</div>
          <b>${esc(n.name)}</b><span class="muted" style="font-size:13px">${cnt.get(n.id) || 0} عطر</span>
          <div class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${n.id}">تعديل</button><button class="btn btn-danger btn-sm" data-del="${n.id}">حذف</button></div></div>`;
      }).join('') || '<div class="empty" style="grid-column:1/-1">لا توجد نوتات.</div>'}</div>`;
    const reload = () => tabs._go('notes');
    $('#n-add').addEventListener('click', () => editNote(null, reload));
    pane.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return editNote(notes.find((n) => n.id === Number(ed.dataset.edit)), reload);
      const del = e.target.closest('[data-del]');
      if (del) {
        const n = notes.find((x) => x.id === Number(del.dataset.del));
        if (!confirm(`حذف النوتة «${n.name}»؟ ستُزال من كل العطور التي تحتويها.`)) return;
        const { error } = await sb.from('notes').delete().eq('id', n.id);
        if (error) return toast(dbErr(error), 'err');
        reload();
      }
    });
  };

  function editNote(n, done) {
    let image = n ? (n.image_url || '') : '';
    const m = openModal(`<h3>${n ? 'تعديل نوتة' : 'إضافة نوتة'}</h3><div id="n-msg"></div>
      <div class="grid2">
        <div class="field"><label class="lbl">الاسم *</label><input id="n-name" class="input" maxlength="60" value="${esc(n ? n.name : '')}"></div>
        <div class="field"><label class="lbl">أيقونة بديلة (إيموجي)</label><input id="n-emoji" class="input" maxlength="8" value="${esc(n ? n.emoji || '' : '')}"></div>
      </div>
      <div class="field"><label class="lbl">صورة النوتة (تظهر داخل الدائرة)</label>
        <input id="n-img" class="input" dir="ltr" placeholder="https://..." value="${esc(image)}">
        <input type="file" id="n-file" accept="image/png,image/jpeg,image/webp,image/gif" style="margin-top:6px"></div>
      <div class="field"><label class="lbl">الترتيب</label><input id="n-sort" class="input" type="number" value="${n ? n.sort_order : 100}" style="max-width:140px"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="n-cancel">إلغاء</button><button class="btn" id="n-save">حفظ</button></div>`);
    const q = (s) => $(s, m.el);
    q('#n-img').addEventListener('input', (e) => { image = e.target.value.trim(); });
    q('#n-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { toast('جارٍ رفع الصورة...'); image = await uploadImage(f, 'notes'); q('#n-img').value = image; toast('تم رفع الصورة'); }
      catch (err) { toast(errMsg(err), 'err'); }
    });
    q('#n-cancel').addEventListener('click', m.close);
    q('#n-save').addEventListener('click', async () => {
      const name = q('#n-name').value.trim();
      const fail = (t) => { q('#n-msg').innerHTML = `<div class="msg err">${esc(t)}</div>`; };
      if (!name) return fail('الاسم مطلوب.');
      if (image && !safeUrl(image)) return fail('رابط الصورة غير صالح.');
      const row = { name, emoji: q('#n-emoji').value.trim() || null, image_url: image || null, sort_order: Number(q('#n-sort').value) || 0 };
      const { error } = n ? await sb.from('notes').update(row).eq('id', n.id) : await sb.from('notes').insert(row);
      if (error) return fail(dbErr(error));
      m.close(); toast('تم الحفظ'); done();
    });
  }

  // =====================================================================
  // الطلبات
  // =====================================================================
  tabs.orders = async function () {
    const rows = await fetchAll((a, b) => sb.from('orders').select('*,order_items(*)').order('created_at', { ascending: false }).range(a, b));
    const st = { status: 'all', q: '', page: 0 };
    const revenue = rows.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total), 0);
    pane.innerHTML = `<div class="kpis">
        <div class="kpi"><b>${rows.length}</b><span>كل الطلبات</span></div>
        <div class="kpi"><b>${rows.filter((o) => o.status === 'new').length}</b><span>طلبات جديدة</span></div>
        <div class="kpi"><b>${esc(fmt(revenue))}</b><span>الإيرادات (دون الملغاة)</span></div></div>
      <div class="toolbar"><input id="o-q" class="input" type="search" placeholder="بحث: رقم الطلب، الاسم، الهاتف...">
        <select id="o-s" class="input" style="max-width:190px"><option value="all">كل الحالات</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <span class="spacer"></span><span class="muted" id="o-count"></span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>الهاتف</th><th>المجموع</th><th>الحالة</th><th></th></tr></thead><tbody id="o-body"></tbody></table></div>
      <div class="toolbar" style="margin-top:12px;justify-content:center"><button class="btn btn-ghost btn-sm" id="o-prev">السابق</button><span id="o-page" class="muted"></span><button class="btn btn-ghost btn-sm" id="o-next">التالي</button></div>`;
    const filtered = () => {
      const q = norm(st.q);
      return rows.filter((o) => (st.status === 'all' || o.status === st.status) &&
        (!q || norm(`${o.id} ${o.first_name} ${o.last_name} ${o.phone}`).includes(q)));
    };
    const draw = () => {
      const f = filtered(), pages = Math.max(1, Math.ceil(f.length / PAGE));
      st.page = Math.min(st.page, pages - 1);
      $('#o-count').textContent = `${f.length} طلب`;
      $('#o-page').textContent = `${st.page + 1} / ${pages}`;
      $('#o-body').innerHTML = f.slice(st.page * PAGE, (st.page + 1) * PAGE).map((o) => `<tr data-id="${o.id}">
        <td><b>#${o.id}</b></td><td>${esc(fmtDate(o.created_at))}</td>
        <td>${esc(o.first_name + ' ' + o.last_name)}${o.user_id ? '' : ' <span class="chip" style="font-size:11px">بدون حساب</span>'}</td>
        <td dir="ltr" style="text-align:start">${esc(o.phone)}</td><td>${esc(fmt(o.total))}</td>
        <td><select class="input" data-status style="min-width:130px;padding:6px 10px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><button class="btn btn-ghost btn-sm" data-view>تفاصيل</button></td></tr>`).join('')
        || '<tr><td colspan="7" class="center muted" style="padding:30px">لا توجد طلبات.</td></tr>';
    };
    let t;
    $('#o-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 200); });
    $('#o-s').addEventListener('change', (e) => { st.status = e.target.value; st.page = 0; draw(); });
    $('#o-prev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); draw(); });
    $('#o-next').addEventListener('click', () => { st.page += 1; draw(); });
    $('#o-body').addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-status]');
      if (!sel) return;
      const o = rows.find((x) => x.id === Number(sel.closest('tr').dataset.id));
      const { error } = await sb.from('orders').update({ status: sel.value }).eq('id', o.id);
      if (error) { sel.value = o.status; return toast(dbErr(error), 'err'); }
      o.status = sel.value; toast('تم تحديث الحالة');
    });
    $('#o-body').addEventListener('click', (e) => {
      if (!e.target.closest('[data-view]')) return;
      const o = rows.find((x) => x.id === Number(e.target.closest('tr').dataset.id));
      const m = openModal(`<h3>طلب #${o.id} <span class="status ${esc(o.status)}">${esc(STATUS[o.status])}</span></h3>
        <div class="grid2" style="margin-bottom:14px">
          <div><div class="muted">العميل</div><b>${esc(o.first_name + ' ' + o.last_name)}</b> ${o.user_id ? '' : '<span class="chip" style="font-size:11px">بدون حساب</span>'}</div>
          <div><div class="muted">الهاتف</div><a class="gold" dir="ltr" href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
          <div><div class="muted">العنوان</div><div style="white-space:pre-line">${esc(o.address)}</div></div>
          <div><div class="muted">التاريخ</div>${esc(fmtDate(o.created_at))}</div>
        </div>
        ${o.note ? `<div class="msg info">ملاحظة العميل: ${esc(o.note)}</div>` : ''}
        <div class="table-wrap"><table class="t" style="min-width:0"><thead><tr><th>العطر</th><th>التركيز / الحجم</th><th>الكمية</th><th>السعر</th></tr></thead><tbody>
        ${(o.order_items || []).map((i) => `<tr><td dir="ltr" style="text-align:start"><b>${esc(i.perfume_name)}</b> <span class="muted">${esc(i.brand)}</span></td><td>${esc(i.concentration)} · ${esc(i.size)}</td><td>${i.qty}</td><td>${esc(fmt(i.unit_price * i.qty))}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="total-line"><span>المجموع</span><span>${esc(fmt(o.total))}</span></div>
        <div class="modal-actions"><button class="btn btn-danger" id="o-del">حذف الطلب</button><button class="btn btn-ghost" id="o-print">طباعة</button><button class="btn" id="o-close">إغلاق</button></div>`);
      $('#o-close', m.el).addEventListener('click', m.close);
      $('#o-print', m.el).addEventListener('click', () => window.print());
      $('#o-del', m.el).addEventListener('click', async () => {
        if (!confirm('حذف هذا الطلب نهائياً؟')) return;
        const { error } = await sb.from('orders').delete().eq('id', o.id);
        if (error) return toast(dbErr(error), 'err');
        m.close(); toast('تم حذف الطلب'); tabs._go('orders');
      });
    });
    draw();
  };

  // =====================================================================
  // العملاء
  // =====================================================================
  tabs.customers = async function () {
    const [profiles, orders] = await Promise.all([
      fetchAll((a, b) => sb.from('profiles').select('*').order('created_at', { ascending: false }).range(a, b)),
      fetchAll((a, b) => sb.from('orders').select('id,user_id,first_name,last_name,phone,total,status,created_at').order('id').range(a, b))
    ]);
    const live = orders.filter((o) => o.status !== 'cancelled');
    const byUser = new Map();
    live.forEach((o) => {
      if (!o.user_id) return;
      const r = byUser.get(o.user_id) || { n: 0, sum: 0 };
      r.n++; r.sum += Number(o.total); byUser.set(o.user_id, r);
    });
    const guests = new Map();
    live.filter((o) => !o.user_id).forEach((o) => {
      const k = o.phone.replace(/\D/g, '') || o.phone;
      const r = guests.get(k) || { name: '', phone: o.phone, n: 0, sum: 0 };
      r.name = o.first_name + ' ' + o.last_name; r.n++; r.sum += Number(o.total); guests.set(k, r);
    });
    pane.innerHTML = `<h2>العملاء المسجّلون (${profiles.length})</h2>
      <div class="table-wrap"><table class="t"><thead><tr><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>العنوان</th><th>التسجيل</th><th>الطلبات</th><th>المشتريات</th></tr></thead><tbody>
      ${profiles.map((p) => { const s = byUser.get(p.id) || { n: 0, sum: 0 }; return `<tr><td>${esc((p.first_name + ' ' + p.last_name).trim() || '—')}</td><td dir="ltr" style="text-align:start">${esc(p.email)}</td><td dir="ltr" style="text-align:start">${esc(p.phone)}</td><td>${esc(p.address)}</td><td>${esc(fmtDate(p.created_at))}</td><td>${s.n}</td><td>${esc(fmt(s.sum))}</td></tr>`; }).join('')
        || '<tr><td colspan="7" class="center muted" style="padding:24px">لا يوجد عملاء مسجّلون.</td></tr>'}</tbody></table></div>
      <h2 style="margin-top:30px">زبائن اشتروا بدون حساب (${guests.size})</h2>
      <div class="table-wrap"><table class="t"><thead><tr><th>الاسم</th><th>الهاتف</th><th>الطلبات</th><th>المشتريات</th></tr></thead><tbody>
      ${[...guests.values()].sort((a, b) => b.sum - a.sum).map((g) => `<tr><td>${esc(g.name)}</td><td dir="ltr" style="text-align:start">${esc(g.phone)}</td><td>${g.n}</td><td>${esc(fmt(g.sum))}</td></tr>`).join('')
        || '<tr><td colspan="4" class="center muted" style="padding:24px">لا يوجد.</td></tr>'}</tbody></table></div>`;
  };

  // =====================================================================
  // الاستيراد من Excel / CSV
  // =====================================================================
  const ALIAS = {
    name: ['name', 'الاسم', 'اسم العطر'], brand: ['brand', 'الماركة', 'العلامة التجارية'],
    family: ['family', 'العائلة', 'العائلة العطرية'], description: ['description', 'الوصف'],
    image: ['image_url', 'image', 'الصورة', 'رابط الصورة'], featured: ['featured', 'مميز'],
    top: ['top_notes', 'top', 'النوتات العليا'], heart: ['heart_notes', 'heart', 'نوتات القلب'],
    base: ['base_notes', 'base', 'النوتات الأساسية'], options: ['options', 'الخيارات']
  };
  Object.keys(ALIAS).forEach((k) => { ALIAS[k] = ALIAS[k].map(norm); });
  const TEMPLATE_HEAD = ['الاسم', 'الماركة', 'العائلة', 'الوصف', 'الصورة', 'مميز', 'النوتات العليا', 'نوتات القلب', 'النوتات الأساسية', 'الخيارات'];
  const TEMPLATE_ROWS = [
    ['Sauvage', 'Dior', 'منعش', 'افتتاحية حمضية منعشة', 'https://example.com/sauvage.jpg', 1, 'البرغموت, الفلفل', 'اللافندر', 'العنبر, الخشب', 'ضربة 1|10ml|1500|1; ضربة 1|30ml|3500|1; ضربة 3|30ml|4800|1; ضربة 3|50ml|7000|0'],
    ['Oud Wood', 'Tom Ford', 'خشبي', '', '', 0, 'الهيل', 'العود, الخشب', 'الصندل, الفانيليا', 'ضربة 1|10ml|2600|1; ضربة 6|100ml|30000|1']
  ];
  const toLatin = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const FALSY = ['0', 'لا', 'no', 'false', 'نفد', 'غير متوفر', 'n'].map(norm);
  const truthy = (v) => !FALSY.includes(norm(v));

  function parseOptions(s) {
    const out = [], errs = [];
    String(s || '').split(/[;؛\n]/).map((x) => x.trim()).filter(Boolean).forEach((part) => {
      const f = part.split('|').map((x) => x.trim());
      if (f.length < 3 || !f[0] || !f[1]) { errs.push(`خيار غير صالح «${part}»`); return; }
      const price = Number(toLatin(f[2]).replace(/[\s,٬]/g, ''));
      if (!isFinite(price) || price < 0 || f[2] === '') { errs.push(`سعر غير صالح في «${part}»`); return; }
      out.push({ concentration: f[0], size: f[1], price, is_available: f[3] === undefined || f[3] === '' ? true : truthy(f[3]) });
    });
    return { out, errs };
  }
  const splitNotes = (s) => [...new Set(String(s || '').split(/[,،|]/).map((x) => x.trim()).filter(Boolean))];

  function parseRows(raw) {
    return raw.map((r, i) => {
      const get = (f) => { for (const k of Object.keys(r)) if (ALIAS[f].includes(norm(k))) return String(r[k] == null ? '' : r[k]).trim(); return ''; };
      const o = parseOptions(get('options'));
      const feat = get('featured');
      const row = {
        line: i + 2, name: get('name'), brand: get('brand'), family: get('family'), description: get('description'),
        image: get('image'), featured: feat === '' ? null : truthy(feat),
        top: splitNotes(get('top')), heart: splitNotes(get('heart')), base: splitNotes(get('base')),
        options: o.out, errors: o.errs.slice()
      };
      if (!row.name) row.errors.push('الاسم مفقود');
      if (row.image && !safeUrl(row.image)) row.errors.push('رابط الصورة غير صالح');
      return row;
    }).filter((r) => r.name || r.brand || r.options.length || r.errors.length > 1);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  tabs.import = function () {
    pane.innerHTML = `<h2>استيراد عطور دفعة واحدة</h2>
      <div class="panel-box" style="margin-bottom:16px">
        <p style="margin-top:0">صف واحد لكل عطر. الأعمدة (يمكن كتابة اسمها بالعربية أو بالإنجليزية):</p>
        <ul class="muted" style="line-height:2;margin:0 0 12px">
          <li><b>الاسم</b> (إجباري) · <b>الماركة</b> · <b>العائلة</b> · <b>الوصف</b> · <b>الصورة</b> (رابط) · <b>مميز</b> (1 أو 0)</li>
          <li><b>النوتات العليا / نوتات القلب / النوتات الأساسية</b>: أسماء مفصولة بفاصلة</li>
          <li><b>الخيارات</b>: <code dir="ltr">تركيز|حجم|سعر|متوفر</code> — خيارات مفصولة بـ <code dir="ltr">;</code> (الأخير 1 أو 0 واختياري)</li>
        </ul>
        <p class="muted" style="font-size:14px;margin:0 0 14px">العائلات والنوتات غير الموجودة تُنشأ تلقائياً. إن وُجد عطر بنفس الاسم والماركة يُحدَّث (ولا تُحذف خياراته القديمة). يمكنك تعديل أي عطر بعد الاستيراد من تبويب «العطور».</p>
        <div class="toolbar" style="margin:0"><button class="btn btn-ghost btn-sm" id="tpl-x">تحميل قالب Excel</button><button class="btn btn-ghost btn-sm" id="tpl-c">تحميل قالب CSV</button></div>
      </div>
      <div class="drop" id="drop">اضغط لاختيار ملف (.xlsx / .xls / .csv) أو اسحبه إلى هنا<input type="file" id="file" accept=".xlsx,.xls,.csv" hidden></div>
      <div id="imp" style="margin-top:18px"></div>`;

    $('#tpl-x').addEventListener('click', () => {
      if (!window.XLSX) return toast('تعذّر تحميل مكتبة Excel، تحقق من الإنترنت.', 'err');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([TEMPLATE_HEAD, ...TEMPLATE_ROWS]), 'عطور');
      XLSX.writeFile(wb, 'ach-parfum-template.xlsx');
    });
    $('#tpl-c').addEventListener('click', () => {
      const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
      const csv = '﻿' + [TEMPLATE_HEAD, ...TEMPLATE_ROWS].map((r) => r.map(q).join(',')).join('\r\n');
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'ach-parfum-template.csv');
    });

    const drop = $('#drop'), input = $('#file');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); });
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

    async function handleFile(file) {
      const box = $('#imp');
      if (!window.XLSX) { box.innerHTML = '<div class="msg err">تعذّر تحميل مكتبة Excel، تحقق من الإنترنت ثم أعد تحميل الصفحة.</div>'; return; }
      box.innerHTML = LOADER;
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', codepage: 65001 });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (raw.length > 5000) throw new Error('الملف كبير: الحد الأقصى 5000 صف في المرة الواحدة.');
        const rows = parseRows(raw);
        if (!rows.length) throw new Error('لم أجد صفوفاً في الملف. تأكد من أن الصف الأول يحتوي أسماء الأعمدة.');
        showPreview(rows);
      } catch (e) { box.innerHTML = `<div class="msg err">${esc(errMsg(e))}</div>`; }
    }

    function showPreview(rows) {
      const ok = rows.filter((r) => !r.errors.length);
      const bad = rows.length - ok.length;
      $('#imp').innerHTML = `<div class="msg ${bad ? 'info' : 'ok'}">${rows.length} صف في الملف — <b>${ok.length}</b> صالح${bad ? `، و<b>${bad}</b> فيه أخطاء (سيُتجاهل)` : ''}.</div>
        <div class="table-wrap"><table class="t"><thead><tr><th>سطر</th><th>الاسم</th><th>الماركة</th><th>العائلة</th><th>النوتات</th><th>الخيارات</th><th>الحالة</th></tr></thead><tbody>
        ${rows.slice(0, 30).map((r) => `<tr><td>${r.line}</td><td dir="ltr" style="text-align:start">${esc(r.name)}</td><td dir="ltr" style="text-align:start">${esc(r.brand)}</td><td>${esc(r.family)}</td>
          <td>${r.top.length + r.heart.length + r.base.length}</td><td>${r.options.length}</td>
          <td>${r.errors.length ? `<span style="color:var(--danger)">${esc(r.errors.join(' • '))}</span>` : '<span style="color:var(--ok)">✓</span>'}</td></tr>`).join('')}
        </tbody></table></div>${rows.length > 30 ? `<p class="muted">عرض أول 30 صفاً من ${rows.length}.</p>` : ''}
        <div class="toolbar" style="margin-top:14px"><button class="btn" id="go" ${ok.length ? '' : 'disabled'}>استيراد ${ok.length} عطر</button></div>
        <div id="run"></div>`;
      $('#go').addEventListener('click', () => runImport(ok));
    }

    async function runImport(items) {
      const run = $('#run'), go = $('#go');
      go.disabled = true;
      run.innerHTML = '<div class="progress"><i id="bar"></i></div><div class="muted" id="step"></div>';
      const step = (p, t) => { $('#bar').style.width = Math.round(p * 100) + '%'; $('#step').textContent = t; };
      try {
        // عطر مكرر داخل الملف: الأخير يفوز
        const uniq = new Map();
        items.forEach((r) => uniq.set(norm(r.name) + '|' + norm(r.brand), r));
        items = [...uniq.values()];

        step(0.03, 'قراءة البيانات الحالية...');
        const [families, notes, existingRows] = await Promise.all([
          A.loadFamilies(), A.loadNotes(),
          fetchAll((a, b) => sb.from('perfumes').select('id,name,brand,description,image_url,is_featured,is_active,family_id').order('id').range(a, b))
        ]);
        const famMap = new Map(families.map((f) => [norm(f.name), f.id]));
        const noteMap = new Map(notes.map((n) => [norm(n.name), n.id]));
        const existing = new Map(existingRows.map((p) => [norm(p.name) + '|' + norm(p.brand), p]));

        // عائلات ونوتات جديدة
        const firstName = (names) => { const m = new Map(); names.forEach((n) => { if (n && !m.has(norm(n))) m.set(norm(n), n); }); return m; };
        const newFams = [...firstName(items.map((r) => r.family)).entries()].filter(([k]) => !famMap.has(k));
        if (newFams.length) {
          step(0.08, 'إنشاء العائلات الجديدة...');
          const { data, error } = await sb.from('families').insert(newFams.map(([, name], i) => ({ name, sort_order: 100 + i }))).select('id,name');
          if (error) throw error;
          data.forEach((f) => famMap.set(norm(f.name), f.id));
        }
        const allNoteNames = items.flatMap((r) => [...r.top, ...r.heart, ...r.base]);
        const newNotes = [...firstName(allNoteNames).entries()].filter(([k]) => !noteMap.has(k));
        if (newNotes.length) {
          step(0.14, 'إنشاء النوتات الجديدة...');
          const { data, error } = await sb.from('notes').insert(newNotes.map(([, name], i) => ({ name, sort_order: 100 + i }))).select('id,name');
          if (error) throw error;
          data.forEach((n) => noteMap.set(norm(n.name), n.id));
        }

        // العطور
        const payload = items.map((r) => {
          const ex = existing.get(norm(r.name) + '|' + norm(r.brand));
          return {
            name: ex ? ex.name : r.name, brand: ex ? ex.brand : r.brand,
            description: r.description || (ex ? ex.description : ''),
            image_url: r.image || (ex ? ex.image_url : null),
            family_id: r.family ? famMap.get(norm(r.family)) : (ex ? ex.family_id : null),
            is_featured: r.featured === null ? (ex ? ex.is_featured : false) : r.featured,
            is_active: ex ? ex.is_active : true
          };
        });
        const idByKey = new Map();
        const pchunks = chunk(payload, 100);
        for (let i = 0; i < pchunks.length; i++) {
          step(0.2 + 0.3 * (i / pchunks.length), `حفظ العطور (${Math.min((i + 1) * 100, payload.length)}/${payload.length})...`);
          const { data, error } = await sb.from('perfumes').upsert(pchunks[i], { onConflict: 'name,brand' }).select('id,name,brand');
          if (error) throw error;
          data.forEach((p) => idByKey.set(norm(p.name) + '|' + norm(p.brand), p.id));
        }

        // النوتات (نستبدل نوتات العطور التي حملت نوتات في الملف فقط)
        const withNotes = [], noteRows = [];
        items.forEach((r) => {
          const id = idByKey.get(norm(r.name) + '|' + norm(r.brand));
          if (!id) return;
          const seen = new Set();
          [['top', r.top], ['heart', r.heart], ['base', r.base]].forEach(([layer, list]) => list.forEach((n) => {
            const nid = noteMap.get(norm(n));
            if (nid && !seen.has(nid)) { seen.add(nid); noteRows.push({ perfume_id: id, note_id: nid, layer }); }
          }));
          if (seen.size) withNotes.push(id);
        });
        const dchunks = chunk(withNotes, 100);
        for (let i = 0; i < dchunks.length; i++) {
          step(0.5 + 0.1 * (i / dchunks.length), 'تحديث النوتات...');
          const { error } = await sb.from('perfume_notes').delete().in('perfume_id', dchunks[i]);
          if (error) throw error;
        }
        const nchunks = chunk(noteRows, 500);
        for (let i = 0; i < nchunks.length; i++) {
          step(0.6 + 0.15 * (i / nchunks.length), 'حفظ النوتات...');
          const { error } = await sb.from('perfume_notes').insert(nchunks[i]);
          if (error) throw error;
        }

        // الخيارات
        const optMap = new Map();
        items.forEach((r) => {
          const id = idByKey.get(norm(r.name) + '|' + norm(r.brand));
          if (!id) return;
          const cs = [], ss = [];
          r.options.forEach((o) => { if (!cs.includes(o.concentration)) cs.push(o.concentration); if (!ss.includes(o.size)) ss.push(o.size); });
          r.options.forEach((o) => {
            optMap.set(id + '\u0001' + o.concentration + '\u0001' + o.size, {
              perfume_id: id, concentration: o.concentration, size: o.size, price: o.price,
              is_available: o.is_available, sort_order: (cs.indexOf(o.concentration) + 1) * 100 + ss.indexOf(o.size) + 1
            });
          });
        });
        const ochunks = chunk([...optMap.values()], 500);
        for (let i = 0; i < ochunks.length; i++) {
          step(0.75 + 0.22 * (i / ochunks.length), `حفظ الخيارات والأسعار (${Math.min((i + 1) * 500, optMap.size)}/${optMap.size})...`);
          const { error } = await sb.from('perfume_options').upsert(ochunks[i], { onConflict: 'perfume_id,concentration,size' });
          if (error) throw error;
        }

        const updated = items.filter((r) => existing.has(norm(r.name) + '|' + norm(r.brand))).length;
        step(1, 'اكتمل');
        run.innerHTML = `<div class="msg ok">تم الاستيراد: <b>${items.length - updated}</b> عطر جديد، <b>${updated}</b> عطر محدَّث،
          ${newFams.length} عائلة جديدة، ${newNotes.length} نوتة جديدة، ${optMap.size} خيار سعري.
          <br>ملاحظة: النوتات الجديدة أُنشئت بدون صور — أضف صورها من تبويب «النوتات العطرية».</div>
          <button class="btn" id="to-list">عرض العطور</button>`;
        $('#to-list').addEventListener('click', () => tabs._go('perfumes'));
      } catch (e) {
        run.innerHTML = `<div class="msg err">توقف الاستيراد: ${esc(dbErr(e))}<br>يمكنك إعادة المحاولة بنفس الملف — العطور تُحدَّث ولا تتكرر.</div>`;
        go.disabled = false;
      }
    }
  };

  // =====================================================================
  async function start() {
    root.innerHTML = LOADER;
    const u = await A.getUser();
    if (!u) return viewLogin();
    if (!(await A.isAdmin())) return viewDenied();
    viewShell();
  }
  start();
})();
