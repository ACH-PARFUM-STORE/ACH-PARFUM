(async function () {
  'use strict';
  const { $, $$, esc, fmt, fmtDate, STATUS, card } = A;
  A.layout('account');
  const acct = $('#acct');
  if (A.needConfig(acct)) return;
  const sb = A.sb;

  const msgBox = (el, text, type) => { el.innerHTML = text ? `<div class="msg ${type || 'err'}">${esc(text)}</div>` : ''; };

  // ---------- دخول / تسجيل ----------
  function viewAuth(initialMsg) {
    acct.innerHTML = `<div class="auth-box">
      <div class="tabs"><button class="tab on" data-t="login">تسجيل الدخول</button><button class="tab" data-t="register">حساب جديد</button></div>
      <div id="auth-msg">${initialMsg ? `<div class="msg info">${esc(initialMsg)}</div>` : ''}</div>
      <form id="login-form">
        <div class="field"><label class="lbl" for="l-email">البريد الإلكتروني</label><input id="l-email" class="input" type="email" autocomplete="email" dir="ltr" required></div>
        <div class="field"><label class="lbl" for="l-pass">كلمة المرور</label><input id="l-pass" class="input" type="password" autocomplete="current-password" dir="ltr" required></div>
        <button class="btn btn-block" type="submit">دخول</button>
        <p class="center" style="margin:12px 0 0"><a href="#" id="forgot" class="gold" style="font-size:14px">نسيت كلمة المرور؟</a></p>
      </form>
      <form id="reg-form" class="hidden">
        <div class="grid2">
          <div class="field"><label class="lbl" for="r-first">الاسم</label><input id="r-first" class="input" required maxlength="80"></div>
          <div class="field"><label class="lbl" for="r-last">اللقب</label><input id="r-last" class="input" required maxlength="80"></div>
        </div>
        <div class="field"><label class="lbl" for="r-phone">رقم الهاتف</label><input id="r-phone" class="input" type="tel" dir="ltr" maxlength="30"></div>
        <div class="field"><label class="lbl" for="r-address">العنوان</label><input id="r-address" class="input" maxlength="400"></div>
        <div class="field"><label class="lbl" for="r-email">البريد الإلكتروني</label><input id="r-email" class="input" type="email" dir="ltr" required></div>
        <div class="field"><label class="lbl" for="r-pass">كلمة المرور (6 أحرف على الأقل)</label><input id="r-pass" class="input" type="password" minlength="6" dir="ltr" required></div>
        <button class="btn btn-block" type="submit">إنشاء الحساب</button>
      </form>
      <p class="muted center" style="font-size:13px;margin:16px 0 0">التسجيل اختياري — يمكنك الشراء بدون حساب.</p></div>`;

    const m = $('#auth-msg');
    $$('.tab', acct).forEach((t) => t.addEventListener('click', () => {
      $$('.tab', acct).forEach((x) => x.classList.toggle('on', x === t));
      $('#login-form').classList.toggle('hidden', t.dataset.t !== 'login');
      $('#reg-form').classList.toggle('hidden', t.dataset.t !== 'register');
      m.innerHTML = '';
    }));

    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
      if (error) return msgBox(m, error.message.includes('Invalid login') ? 'البريد أو كلمة المرور غير صحيحة.' : error.message);
      render();
    });
    $('#forgot').addEventListener('click', async (e) => {
      e.preventDefault();
      const email = $('#l-email').value.trim();
      if (!email) return msgBox(m, 'اكتب بريدك الإلكتروني أولاً ثم اضغط «نسيت كلمة المرور».');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      msgBox(m, error ? error.message : 'أرسلنا رابط استعادة كلمة المرور إلى بريدك.', error ? 'err' : 'ok');
    });
    $('#reg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { data, error } = await sb.auth.signUp({
        email: $('#r-email').value.trim(), password: $('#r-pass').value,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          data: {
            first_name: $('#r-first').value.trim(), last_name: $('#r-last').value.trim(),
            phone: $('#r-phone').value.trim(), address: $('#r-address').value.trim()
          }
        }
      });
      if (error) return msgBox(m, error.message);
      if (data.session) return render();
      msgBox(m, 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتفعيله ثم سجّل الدخول.', 'ok');
    });
  }

  function viewRecovery() {
    acct.innerHTML = `<div class="auth-box"><h3>كلمة مرور جديدة</h3><div id="rec-msg"></div>
      <form id="rec-form"><div class="field"><input id="rec-pass" class="input" type="password" minlength="6" dir="ltr" placeholder="كلمة المرور الجديدة" required></div>
      <button class="btn btn-block" type="submit">حفظ</button></form></div>`;
    $('#rec-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: $('#rec-pass').value });
      if (error) return msgBox($('#rec-msg'), error.message);
      render();
    });
  }

  // ---------- لوحة العميل ----------
  async function viewDashboard(user) {
    const [{ data: prof }, admin] = await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(), A.isAdmin()
    ]);
    const p = prof || { first_name: '', last_name: '', phone: '', address: '' };
    acct.innerHTML = `<div class="page-head" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div><h1>مرحباً ${esc(p.first_name || '')}</h1><div class="muted" dir="ltr" style="text-align:start">${esc(user.email)}</div></div>
        <div style="display:flex;gap:8px">${admin ? '<a class="btn btn-sm" href="admin.html">لوحة التحكم</a>' : ''}<button class="btn btn-ghost btn-sm" id="logout">خروج</button></div>
      </div>
      <div class="tabs"><button class="tab on" data-v="profile">بياناتي</button><button class="tab" data-v="favs">المفضلة</button><button class="tab" data-v="orders">طلباتي</button></div>
      <div id="tab-body" style="padding-bottom:40px"></div>`;
    $('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    const body = $('#tab-body');

    const views = {
      profile() {
        body.innerHTML = `<div class="panel-box" style="max-width:560px">
          <h3>بياناتي</h3><div id="p-msg"></div>
          <form id="p-form">
            <div class="grid2">
              <div class="field"><label class="lbl">الاسم</label><input id="p-first" class="input" value="${esc(p.first_name)}" maxlength="80"></div>
              <div class="field"><label class="lbl">اللقب</label><input id="p-last" class="input" value="${esc(p.last_name)}" maxlength="80"></div>
            </div>
            <div class="field"><label class="lbl">رقم الهاتف</label><input id="p-phone" class="input" type="tel" dir="ltr" value="${esc(p.phone)}" maxlength="30"></div>
            <div class="field"><label class="lbl">العنوان</label><textarea id="p-address" class="input" maxlength="400">${esc(p.address)}</textarea></div>
            <button class="btn" type="submit">حفظ البيانات</button>
          </form>
          <hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
          <h3>تغيير كلمة المرور</h3><div id="pw-msg"></div>
          <form id="pw-form"><div class="field"><input id="pw" class="input" type="password" minlength="6" dir="ltr" placeholder="كلمة المرور الجديدة"></div>
          <button class="btn btn-ghost" type="submit">تغيير</button></form></div>`;
        $('#p-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const row = {
            id: user.id, email: user.email || '',
            first_name: $('#p-first').value.trim(), last_name: $('#p-last').value.trim(),
            phone: $('#p-phone').value.trim(), address: $('#p-address').value.trim()
          };
          const { error } = await sb.from('profiles').upsert(row);
          Object.assign(p, row);
          msgBox($('#p-msg'), error ? A.errMsg(error) : 'تم حفظ بياناتك.', error ? 'err' : 'ok');
        });
        $('#pw-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const pw = $('#pw').value;
          if (pw.length < 6) return msgBox($('#pw-msg'), 'كلمة المرور 6 أحرف على الأقل.');
          const { error } = await sb.auth.updateUser({ password: pw });
          msgBox($('#pw-msg'), error ? error.message : 'تم تغيير كلمة المرور.', error ? 'err' : 'ok');
          if (!error) $('#pw').value = '';
        });
      },
      async favs() {
        body.innerHTML = '<div class="loader"></div>';
        try {
          const [catalog, favs] = await Promise.all([A.loadCatalog(), A.getFavs()]);
          const list = catalog.filter((x) => favs.has(x.id));
          body.innerHTML = list.length
            ? `<div class="grid">${list.map((x) => card(x, { favs })).join('')}</div>`
            : '<div class="empty">لم تضف أي عطر إلى المفضلة بعد.</div>';
          A.bindFavs(body);
        } catch (e) { A.showError(body, e); }
      },
      async orders() {
        body.innerHTML = '<div class="loader"></div>';
        const { data, error } = await sb.from('orders').select('*,order_items(*)').order('created_at', { ascending: false });
        if (error) return A.showError(body, error);
        body.innerHTML = data.length ? data.map((o) => `<div class="order">
          <div class="order-head"><b>طلب #${o.id}</b><span class="muted">${esc(fmtDate(o.created_at))}</span>
            <span class="status ${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span></div>
          ${(o.order_items || []).map((i) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:4px 0">
            <span><span dir="ltr">${esc(i.perfume_name)}</span> <span class="muted">— ${esc(i.concentration)} · ${esc(i.size)} × ${i.qty}</span></span>
            <span>${esc(fmt(i.unit_price * i.qty))}</span></div>`).join('')}
          <div class="total-line" style="font-size:16px"><span>المجموع</span><span>${esc(fmt(o.total))}</span></div></div>`).join('')
          : '<div class="empty">لا توجد طلبات بعد.</div>';
      }
    };
    $$('.tab', acct).forEach((t) => t.addEventListener('click', () => {
      $$('.tab', acct).forEach((x) => x.classList.toggle('on', x === t));
      views[t.dataset.v]();
    }));
    views.profile();
  }

  async function render() {
    const u = await A.getUser();
    if (u) await viewDashboard(u); else viewAuth();
  }

  sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') viewRecovery(); });
  if (/type=recovery/.test(location.hash)) { viewRecovery(); return; }
  render();
})();
