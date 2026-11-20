(async function () {
  'use strict';
  const { $, esc, safeUrl, fmt, BOTTLE } = A;
  A.layout('cart');
  if (A.needConfig($('#items'))) { $('#checkout').classList.add('hidden'); return; }

  let cart = A.getCart();
  // status لكل سطر: ok | out (نفد) | gone (لم يعد موجوداً)
  const status = new Map();

  function setStatusFromServer(rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    cart.forEach((i) => {
      const r = byId.get(i.optionId);
      if (!r) { status.set(i.optionId, 'gone'); return; }
      status.set(i.optionId, r.is_available ? 'ok' : 'out');
      i.price = Number(r.price); // السعر المعروض يتبع السعر الحالي
    });
    A.saveCart(cart);
  }

  async function syncWithServer() {
    if (!cart.length) return;
    const { data, error } = await A.sb.from('perfume_options')
      .select('id,price,is_available').in('id', cart.map((i) => i.optionId));
    if (error) { A.toast('تعذّر تحديث الأسعار: ' + A.errMsg(error), 'err'); cart.forEach((i) => status.set(i.optionId, 'ok')); return; }
    setStatusFromServer(data);
  }

  const bad = () => cart.filter((i) => status.get(i.optionId) !== 'ok');

  function render() {
    const has = cart.length > 0;
    $('#empty').classList.toggle('hidden', has);
    $('#cart-wrap').classList.toggle('hidden', !has);
    if (!has) return;

    $('#items').innerHTML = cart.map((i) => {
      const st = status.get(i.optionId);
      const img = safeUrl(i.image);
      return `<div class="cart-item" data-id="${i.optionId}">
        <div class="thumb">${img ? `<img src="${esc(img)}" alt="">` : BOTTLE}</div>
        <div>
          <div class="brand">${esc(i.brand)}</div>
          <h4>${esc(i.name)}</h4>
          <div class="muted" style="font-size:14px">${esc(i.concentration)} · ${esc(i.size)}</div>
          <div class="price">${esc(fmt(i.price))}</div>
          ${st === 'out' ? '<div class="warn">هذا الخيار غير متوفر حالياً</div>' : ''}
          ${st === 'gone' ? '<div class="warn">هذا المنتج لم يعد متاحاً</div>' : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <div class="qty"><button type="button" data-d="-1" aria-label="أنقص">−</button><span>${i.qty}</span><button type="button" data-d="1" aria-label="زِد">+</button></div>
          <button type="button" class="btn btn-danger btn-sm" data-rm="1">حذف</button>
        </div></div>`;
    }).join('');

    const ok = cart.filter((i) => status.get(i.optionId) === 'ok');
    $('#total').textContent = fmt(ok.reduce((s, i) => s + i.price * i.qty, 0));
    const b = bad();
    $('#cart-warn').innerHTML = b.length
      ? `<div class="msg err">بعض المنتجات غير متاحة. احذفها لإتمام الطلب. <button class="btn btn-sm btn-ghost" id="rm-bad" type="button">حذف غير المتاح</button></div>` : '';
    $('#submit').disabled = b.length > 0 || !ok.length;
  }

  $('#items').addEventListener('click', (e) => {
    const row = e.target.closest('.cart-item');
    if (!row) return;
    const item = cart.find((i) => i.optionId === Number(row.dataset.id));
    if (!item) return;
    const d = e.target.closest('[data-d]');
    if (d) item.qty = Math.max(1, Math.min(20, item.qty + Number(d.dataset.d)));
    if (e.target.closest('[data-rm]')) cart = cart.filter((i) => i !== item);
    A.saveCart(cart);
    render();
  });
  $('#cart-warn').addEventListener('click', (e) => {
    if (e.target.closest('#rm-bad')) {
      cart = cart.filter((i) => status.get(i.optionId) === 'ok');
      A.saveCart(cart);
      render();
    }
  });

  // تعبئة تلقائية لبيانات العميل المسجّل
  (async () => {
    const u = await A.getUser();
    if (!u) return;
    const { data } = await A.sb.from('profiles').select('first_name,last_name,phone,address').eq('id', u.id).maybeSingle();
    if (!data) return;
    if (!$('#c-first').value) $('#c-first').value = data.first_name || '';
    if (!$('#c-last').value) $('#c-last').value = data.last_name || '';
    if (!$('#c-phone').value) $('#c-phone').value = data.phone || '';
    if (!$('#c-address').value) $('#c-address').value = data.address || '';
  })();

  $('#checkout').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#form-msg');
    msg.innerHTML = '';
    const v = {
      first: $('#c-first').value.trim(), last: $('#c-last').value.trim(),
      phone: $('#c-phone').value.trim(), address: $('#c-address').value.trim(),
      note: $('#c-note').value.trim()
    };
    if (!v.first || !v.last || !v.phone || !v.address) {
      msg.innerHTML = '<div class="msg err">يرجى ملء الاسم واللقب والهاتف والعنوان.</div>'; return;
    }
    if (v.phone.replace(/\D/g, '').length < 8) {
      msg.innerHTML = '<div class="msg err">رقم الهاتف غير صحيح.</div>'; return;
    }
    const btn = $('#submit');
    btn.disabled = true; btn.textContent = 'جارٍ إرسال الطلب...';
    const { data, error } = await A.sb.rpc('place_order', {
      p_first_name: v.first, p_last_name: v.last, p_address: v.address, p_phone: v.phone,
      p_note: v.note, p_items: cart.map((i) => ({ option_id: i.optionId, qty: i.qty }))
    });
    btn.textContent = 'تأكيد الطلب';
    if (error) {
      msg.innerHTML = `<div class="msg err">${esc(A.errMsg(error))}</div>`;
      await syncWithServer(); render();
      return;
    }
    A.saveCart([]); cart = [];
    $('#cart-wrap').classList.add('hidden');
    const u = await A.getUser();
    const done = $('#done');
    done.classList.remove('hidden');
    done.innerHTML = `<div class="tick">✓</div><h2>تم استلام طلبك</h2>
      <p class="muted">رقم الطلب: <b class="gold">#${esc(data)}</b><br>سيتواصل معك فريقنا على الرقم الذي أدخلته لتأكيد الطلب والتوصيل.</p>
      <p><a class="btn" href="shop.html">متابعة التسوق</a>
      ${u ? ' <a class="btn btn-ghost" href="account.html">طلباتي</a>' : ''}</p>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  await syncWithServer();
  render();
})();
