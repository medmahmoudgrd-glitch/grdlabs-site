// Grdlabs employee app: register once with the company's pairing code, then sign in with email and password from any phone.
// Clock in/out at the company's NFC sticker, and see your own salary, advances, deductions and attendance.
// Pairing link: #p=<company id>.<code>; sticker link: #t=<company id>.<tag token>. Firestore rules enforce who sees what.
(() => {
  'use strict';
  const KEY = 'grdlabs-employee-v1';
  const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const KIND = { bonus: ['مكافأة', 'green', '+'], deduction: ['خصم', 'red', '−'], advance: ['سلفة', 'amber', '−'] };
  const view = document.getElementById('view'), tabbar = document.getElementById('tabs');
  const nf = new Intl.NumberFormat('en-US');
  const iqd = (n) => nf.format(Math.round(n || 0)) + ' د.ع';
  const monthName = (p) => { const [y, m] = p.split('-').map(Number); return MONTHS[m - 1] + ' ' + y; };
  const hm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayKey = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const dayName = (k) => new Date(k + 'T12:00:00').toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const shortDate = (k) => k ? k.slice(8, 10) + '/' + k.slice(5, 7) : '';

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const store = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d; return s; };
  const show = (...nodes) => { tabbar.hidden = true; document.body.classList.remove('has-tabs'); view.replaceChildren(...nodes); window.scrollTo(0, 0); };
  const message = (tone, icon, title, text, ...extra) => show(h('div', { class: 'card msg' }, h('div', { class: 'ic ' + tone }, icon), h('h1', {}, title), text && h('p', {}, text), ...extra));
  const waiting = (title) => show(h('div', { class: 'card msg' }, h('div', { class: 'ic wait' }, h('div', { class: 'spin' })), h('h1', {}, title)));
  const header = (company, who) => { document.getElementById('company').textContent = company || 'Grdlabs'; document.getElementById('who').textContent = who || 'تطبيق الموظف'; };

  function metres(aLat, aLng, bLat, bLng) {
    const r = (d) => d * Math.PI / 180, R = 6371000;
    const x = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(x)));
  }

  // Face ID / fingerprint through the phone's own passkey prompt.
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  async function bioAvailable() {
    try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
  }
  async function enroll(name) {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(32), rp: { name: 'Grdlabs', id: location.hostname },
      user: { id: rand(16), name: 'grdlabs-' + name, displayName: name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, attestation: 'none' } });
    return b64(cred.rawId);
  }
  async function verify(id) {
    await navigator.credentials.get({ publicKey: { challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal', 'hybrid'] }] } });
  }
  function position() {
    return new Promise((ok, no) => {
      if (!navigator.geolocation) { no(new Error('nogeo')); return; }
      navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  let db, auth;
  async function start() {
    firebase.initializeApp(window.GRDLABS_CONFIG.firebase);
    auth = firebase.auth(); db = firebase.firestore();
    // Local test hook only: ?emu=1 on localhost talks to the Firebase emulators.
    if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emu')) {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); db.useEmulator('127.0.0.1', 8085);
    }
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await new Promise((ok) => { const off = auth.onAuthStateChanged(() => { off(); ok(); }); });
  }
  const user = async () => auth.currentUser || (await auth.signInAnonymously()).user;
  const saved = () => !!auth.currentUser && !auth.currentUser.isAnonymous;
  const denied = (e) => e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
  const offline = (e) => e && (e.code === 'unavailable' || e.code === 'auth/network-request-failed' || /offline|network/i.test(e.message || ''));

  // A saved account remembers its company and employee in the profile, so signing in on any phone finds them again.
  const LINK = /^grd:([a-z0-9]{20}):(.+)$/;
  async function remember(cid, employeeId) { if (saved()) await auth.currentUser.updateProfile({ displayName: `grd:${cid}:${employeeId}` }); }
  async function restore() {
    const m = saved() && LINK.exec(auth.currentUser.displayName || '');
    if (!m) return null;
    const me = { cid: m[1], employeeId: m[2], name: '', recent: [] };
    try { const s = (await db.doc(`att/${me.cid}/staff/${me.employeeId}`).get()).data(); if (s) { me.name = s.name; me.company = s.company; } } catch { /* shown on the home screen */ }
    store(me);
    return me;
  }
  async function current() {
    return load() || restore();
  }

  function authError(e) {
    const c = (e && e.code) || '';
    if (offline(e)) return 'تأكد من الإنترنت وجرب مرة ثانية.';
    if (c === 'auth/email-already-in-use' || c === 'auth/credential-already-in-use') return 'هذا الإيميل عنده حساب من قبل. اختار "عندي حساب" وادخل بكلمة السر مالته.';
    if (c === 'auth/invalid-email') return 'اكتب الإيميل بشكل صحيح.';
    if (c === 'auth/weak-password') return 'كلمة السر لازم تكون 6 أحرف أو أكثر.';
    if (c === 'auth/too-many-requests') return 'محاولات كثيرة. انتظر شوية وجرب مرة ثانية.';
    if (/wrong-password|user-not-found|invalid-credential|invalid-login/.test(c)) return 'الإيميل أو كلمة السر غلط.';
    return 'صار خطأ. جرب مرة ثانية.';
  }

  // Email + password fields shared by registration, sign-in and saving an existing phone's account.
  function accountFields(mode) {
    const email = h('input', { class: 'inp', type: 'email', dir: 'ltr', autocomplete: 'email', inputmode: 'email', placeholder: 'name@gmail.com', 'data-testid': 'input-email' });
    const pass = h('input', { class: 'inp', type: 'password', dir: 'ltr', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: '••••••', 'data-testid': 'input-password' });
    const err = h('p', { class: 'err', role: 'alert' });
    const read = () => {
      const e = email.value.trim().toLowerCase(), p = pass.value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { err.textContent = 'اكتب الإيميل بشكل صحيح.'; email.focus(); return null; }
      if (p.length < 6) { err.textContent = 'كلمة السر لازم تكون 6 أحرف أو أكثر.'; pass.focus(); return null; }
      err.textContent = ''; return { email: e, pass: p };
    };
    // Enter on the email moves to the password; Enter on the password presses this card's main button.
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pass.focus(); } });
    pass.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (!email.value.trim()) return email.focus();
      const b = pass.closest('.card') && pass.closest('.card').querySelector('.btn.primary:not([disabled])');
      if (b) b.click();
    });
    const node = h('div', { class: 'fields' },
      h('label', {}, h('span', {}, 'الإيميل'), email),
      h('label', {}, h('span', {}, mode === 'login' ? 'كلمة السر' : 'اختار كلمة سر (6 أحرف أو أكثر)'), pass), err);
    return { node, read, err, email };
  }

  // ---------- Email check: a 6-digit code sent from the company's Gmail (see email-otp/) ----------
  // Off while the address is empty. A verified email is remembered for this page only.
  // The service address lives in /otp.json (shared with the desktop app), so it can change without touching this page.
  let OTP_URL = (window.GRDLABS_CONFIG || {}).otp || '';
  fetch('/otp.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (!OTP_URL && typeof j.url === 'string' && /^https:\/\//.test(j.url)) OTP_URL = j.url; }).catch(() => {});
  const verified = new Set();
  async function otpCall(body) {
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(OTP_URL, { method: 'POST', body: JSON.stringify(Object.assign({ idToken }, body)) });
    return r.json();
  }
  const OTP_ERR = {
    bad_email: 'اكتب الإيميل بشكل صحيح.', quota: 'وصلنا الحد اليومي للرسائل. جرب باچر.',
    wrong: 'الكود غلط.', expired: 'الكود انتهى. اضغط «دز كود جديد».', blocked: 'محاولات غلط كثيرة. اضغط «دز كود جديد».',
    not_found: 'اضغط «دز كود جديد».', used: 'هذا الكود مستخدم. اضغط «دز كود جديد».'
  };
  // Shows a sheet over the page. `onOk` runs from the user's own tap, so Face ID can start right after.
  function askCode(email, purpose, okLabel, onOk) {
    const close = () => { sheet.remove(); clearInterval(timer); };
    const inp = h('input', { class: 'inp code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', dir: 'ltr', placeholder: '••••••', 'data-testid': 'input-otp' });
    const err = h('p', { class: 'err', role: 'alert' }), info = h('p', {}, 'جاري إرسال الكود إلى ', h('b', { dir: 'ltr' }, email), '…');
    let wait = 0, timer = null, busy = false;
    const again = h('button', { class: 'link', type: 'button', disabled: true, on: { click: () => send() } }, 'دز كود جديد');
    const tickAgain = () => { again.disabled = wait > 0; again.textContent = wait > 0 ? 'دز كود جديد بعد ' + wait + ' ثانية' : 'دز كود جديد'; };
    const countdown = (sec) => { wait = sec; tickAgain(); clearInterval(timer); timer = setInterval(() => { wait = Math.max(0, wait - 1); tickAgain(); if (!wait) clearInterval(timer); }, 1000); };
    async function send() {
      err.textContent = ''; again.disabled = true;
      try {
        const r = await otpCall({ action: 'send', email, purpose });
        if (r.ok) { info.replaceChildren('دزينا كود من 6 أرقام إلى ', h('b', { dir: 'ltr' }, email), '. إذا ما لگيته، شوف مجلد السبام.'); countdown(r.resendIn || 60); inp.focus(); return; }
        if (r.error === 'rate_limited') { countdown(Math.min(r.retryIn || 60, 3600)); info.replaceChildren('دزينا كود قبل شوية إلى ', h('b', { dir: 'ltr' }, email), '.'); return; }
        err.textContent = OTP_ERR[r.error] || 'ما گدرنا ندز الكود. جرب مرة ثانية.'; again.disabled = false;
      } catch { err.textContent = 'تأكد من الإنترنت وجرب مرة ثانية.'; again.disabled = false; }
    }
    async function check() {
      const code = inp.value.replace(/\D/g, '');
      if (code.length !== 6 || busy) { if (code.length !== 6) err.textContent = 'الكود 6 أرقام.'; return; }
      busy = true; ok.disabled = true; err.textContent = '';
      try {
        const r = await otpCall({ action: 'verify', email, code });
        if (r.ok) {
          verified.add(email); clearInterval(timer);
          const next = h('button', { class: 'btn primary', 'data-testid': 'button-otp-continue', on: { click: () => { close(); onOk(); } } }, okLabel);
          body.replaceChildren(h('div', { class: 'ic ok' }, '✓'), h('h2', {}, 'تم تأكيد الإيميل'), next);
          next.focus(); return;
        }
        err.textContent = (OTP_ERR[r.error] || 'صار خطأ. جرب مرة ثانية.') + (r.error === 'wrong' && r.left ? ' باقي ' + r.left + ' محاولات.' : '');
        if (r.error !== 'wrong') inp.value = '';
      } catch { err.textContent = 'تأكد من الإنترنت وجرب مرة ثانية.'; }
      busy = false; ok.disabled = false; inp.select();
    }
    const ok = h('button', { class: 'btn primary', 'data-testid': 'button-otp-verify', on: { click: check } }, 'تأكيد');
    inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); if (inp.value.length === 6) check(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); check(); } });
    const body = h('div', { class: 'card sheet-card' }, h('h2', {}, 'تأكيد الإيميل'), info, inp, err, ok, again,
      h('button', { class: 'link', type: 'button', on: { click: close } }, 'غيّر الإيميل'));
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, body);
    document.body.append(sheet);
    inp.focus();
    send();
  }

  // ---------- First visit, or a phone that lost its data: sign in ----------
  function welcome(after) {
    header();
    const f = accountFields('login');
    const go = h('button', { class: 'btn primary', 'data-testid': 'button-login', on: { click: async () => {
      const v = f.read(); if (!v) return;
      go.disabled = true;
      try {
        await auth.signInWithEmailAndPassword(v.email, v.pass);
        const me = await restore();
        if (!me) return message('wait', '📱', 'حسابك مو مربوط بشركة', 'اطلب من مديرك رمز الربط وامسحه بكاميرا التلفون.', logoutButton());
        (after || app)();
      } catch (e) { f.err.textContent = authError(e); go.disabled = false; }
    } } }, 'دخول');
    const reset = h('button', { class: 'link', type: 'button', on: { click: async () => {
      const e = f.email.value.trim().toLowerCase();
      if (!e) { f.err.textContent = 'اكتب إيميلك أول، وبعدين اضغط نسيت كلمة السر.'; return; }
      try { await auth.sendPasswordResetEmail(e); f.err.textContent = ''; reset.replaceWith(h('p', { class: 'ok' }, 'إذا الإيميل مسجل، راح يوصلك رابط لتغيير كلمة السر.')); }
      catch (x) { f.err.textContent = authError(x); }
    } } }, 'نسيت كلمة السر؟');
    show(h('div', { class: 'card hero' }, h('h1', {}, 'أهلاً بيك'), h('p', {}, 'شوف راتبك وسلفك وخصوماتك، وسجل حضورك من ملصق الشركة.')),
      h('div', { class: 'card' }, h('h2', {}, 'تسجيل الدخول'), f.node, go, reset),
      h('div', { class: 'card' }, h('h2', {}, 'أول مرة؟'),
        h('p', { style: 'margin:0' }, 'اطلب من مديرك رمز الربط من برنامج Grdlabs وامسحه بكاميرا تلفونك. تسجل مرة وحدة بس، وبعدها تدخل بإيميلك وكلمة السر من أي تلفون.')));
  }

  // ---------- Registration with the one-time pairing code ----------
  async function pairFlow(cid, code) {
    waiting('جاري التحقق من الرمز…');
    let p;
    try { await user(); const pair = await db.doc(`att/${cid}/pairs/${code}`).get(); p = pair.exists && pair.data(); }
    catch (e) { return message('bad', '!', 'تعذّر التحقق', offline(e) ? 'تأكد من الإنترنت وافتح الرابط مرة ثانية.' : 'افتح الرابط مرة ثانية أو اطلب رمز جديد.'); }
    if (!p || p.used || p.exp.toMillis() < Date.now()) {
      const me = await current();
      if (me && me.cid === cid && me.employeeId === (p && p.employeeId)) return app();
      return message('bad', '!', 'الرمز منتهي أو مستخدم', 'إذا سجلت من قبل، ادخل بإيميلك وكلمة السر. وإلا اطلب من مديرك رمز ربط جديد.', h('button', { class: 'btn primary', on: { click: () => welcome() } }, 'تسجيل الدخول'));
    }
    header(null, p.name);
    const bio = await bioAvailable();
    let mode = 'new';
    const f = accountFields('new'), fl = accountFields('login');
    const forms = h('div', {});
    const tabs = h('div', { class: 'seg' },
      h('button', { class: 'on', type: 'button', on: { click: (ev) => pick(ev, 'new') } }, 'حساب جديد'),
      h('button', { type: 'button', 'data-testid': 'button-have-account', on: { click: (ev) => pick(ev, 'login') } }, 'عندي حساب'));
    const pick = (ev, m) => { mode = m; for (const b of tabs.children) b.classList.toggle('on', b === ev.currentTarget); forms.replaceChildren(m === 'new' ? f.node : fl.node); };
    forms.append(f.node);
    const err = h('p', { class: 'err', role: 'alert' });
    const go = h('button', { class: 'btn primary', disabled: !bio, 'data-testid': 'button-pair', on: { click: async () => {
      const keep = saved();
      const v = keep ? {} : (mode === 'new' ? f : fl).read();
      if (!v) return;
      if (!keep && mode === 'new' && OTP_URL && !verified.has(v.email)) return askCode(v.email, 'signup', 'كمّل التسجيل', () => go.click());
      go.disabled = true; err.textContent = '';
      let cred;
      try { cred = await enroll(p.name); }
      catch { go.disabled = false; return; }
      try {
        if (!keep && mode === 'new') {
          if (auth.currentUser && auth.currentUser.isAnonymous) await auth.currentUser.linkWithCredential(firebase.auth.EmailAuthProvider.credential(v.email, v.pass));
          else await auth.createUserWithEmailAndPassword(v.email, v.pass);
        } else if (!keep) await auth.signInWithEmailAndPassword(v.email, v.pass);
      } catch (e) { (mode === 'new' ? f : fl).err.textContent = authError(e); go.disabled = false; return; }
      waiting('جاري التسجيل…');
      try {
        const uid = auth.currentUser.uid, b = db.batch();
        b.update(db.doc(`att/${cid}/pairs/${code}`), { used: true, usedBy: uid });
        b.set(db.doc(`att/${cid}/members/${uid}`), { employeeId: p.employeeId, code, at: firebase.firestore.FieldValue.serverTimestamp(), label: navigator.platform || 'phone' });
        await b.commit();
        await remember(cid, p.employeeId).catch(() => {});
        store({ cid, employeeId: p.employeeId, cred, name: p.name, recent: [] });
        message('ok', '✓', 'تم التسجيل', 'من هسه تدخل بإيميلك وكلمة السر من أي تلفون بدون رمز. لتسجيل الحضور قرّب تلفونك من ملصق الشركة.',
          h('button', { class: 'btn primary', on: { click: () => app() } }, 'افتح حسابي'));
      } catch (e) {
        if (denied(e)) return message('bad', '!', 'ما تم التسجيل', 'الرمز استُخدم أو انتهى، أو حسابك مربوط من قبل. جرب تدخل بحسابك، أو اطلب من مديرك رمز جديد.', h('button', { class: 'btn', on: { click: () => welcome() } }, 'تسجيل الدخول'));
        message('bad', '!', 'ما تم التسجيل', offline(e) ? 'تأكد من الإنترنت وافتح الرابط مرة ثانية.' : 'صار خطأ. افتح الرابط مرة ثانية.');
      }
    } } }, 'سجّل وفعّل Face ID');
    show(h('div', { class: 'card' },
      h('h1', {}, 'أهلاً ' + p.name),
      h('p', {}, 'تسجل مرة وحدة بس. بعدها تدخل بإيميلك وكلمة السر من أي تلفون، وتشوف راتبك وسلفك وخصوماتك وتسجل حضورك.'),
      saved() ? h('p', {}, 'راح ينربط حسابك ', h('b', { dir: 'ltr' }, auth.currentUser.email), ' بهذي الشركة.') : [tabs, forms],
      bio ? h('p', { class: 'muted' }, 'راح يطلب منك Face ID أو البصمة حتى يتأكد إنك صاحب التلفون.')
        : h('p', { class: 'err' }, 'هذا المتصفح ما يدعم Face ID أو البصمة. افتح الرابط بـ Safari بالآيفون أو Chrome بالأندرويد، وتأكد إن قفل الشاشة مفعّل.'),
      err, go));
  }

  // ---------- Clock in/out at the sticker ----------
  async function tapFlow(cid, tag) {
    const me = await current();
    if (!me) return welcome(() => tapFlow(cid, tag));
    if (me.cid !== cid) return message('bad', '!', 'هذا الملصق لشركة ثانية', 'حسابك مربوط بشركة ثانية.');
    header(me.company, me.name);
    const today = dayKey(new Date().toISOString());
    const last = (me.recent || []).filter((x) => dayKey(x.at) === today).pop();
    const suggest = last && last.kind === 'in' ? 'out' : 'in';
    const clock = (kind) => async (ev) => {
      ev.currentTarget.disabled = true;
      try { if (me.cred) await verify(me.cred); else { me.cred = await enroll(me.name || 'employee'); store(me); } }
      catch { return message('bad', '!', 'ما تم التحقق', 'لازم Face ID أو البصمة حتى يتسجل الحضور. قرّب التلفون من الملصق وجرب مرة ثانية.'); }
      waiting('جاري تحديد موقعك…');
      let pos;
      try { pos = await position(); }
      catch { return message('bad', '📍', 'ما كدرت أحدد موقعك', 'اسمح للمتصفح يوصل للموقع من الإعدادات، وشغّل الـ GPS، وجرب مرة ثانية.'); }
      try {
        const co = (await db.doc(`att/${cid}`).get()).data();
        const dist = metres(co.lat, co.lng, pos.coords.latitude, pos.coords.longitude);
        if (dist > co.radius) return message('bad', '📍', 'أنت بعيد عن الشركة', `المسافة ${nf.format(dist)} متر، والمسموح ${nf.format(co.radius)} متر. قرّب من الشركة وجرب مرة ثانية.`);
        if (tag !== co.tag) return message('bad', '!', 'الملصق قديم', 'رابط الملصق تغيّر. خبر مديرك حتى يحدّث الملصق.');
        waiting(kind === 'in' ? 'جاري تسجيل الحضور…' : 'جاري تسجيل الانصراف…');
        await db.collection(`att/${cid}/events`).add({ employeeId: me.employeeId, kind, at: firebase.firestore.FieldValue.serverTimestamp(),
          lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), dist, tag, uid: auth.currentUser.uid });
        const at = new Date().toISOString();
        me.recent = [...(me.recent || []), { kind, at }].slice(-60);
        store(me);
        message('ok', '✓', kind === 'in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف', 'الساعة ' + hm(at) + ' · على بعد ' + nf.format(dist) + ' متر من الشركة.',
          h('button', { class: 'btn', on: { click: () => app('attendance') } }, 'عرض حضوري'));
      } catch (e) {
        if (denied(e)) return gone();
        message('bad', '!', 'ما تسجّل', offline(e) ? 'تأكد من الإنترنت وقرّب التلفون من الملصق مرة ثانية.' : 'صار خطأ. قرّب التلفون من الملصق مرة ثانية.');
      }
    };
    show(h('div', { class: 'card' },
      h('h1', {}, 'أهلاً ' + (me.name || '')),
      h('p', {}, 'اختار شنو تريد تسجل. راح يطلب منك Face ID أو البصمة، وبعدها يتأكد من موقعك.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ' + (suggest === 'in' ? 'green' : ''), 'data-testid': 'button-clock-in', on: { click: clock('in') } }, 'حضور'),
        h('button', { class: 'btn ' + (suggest === 'out' ? 'primary' : ''), 'data-testid': 'button-clock-out', on: { click: clock('out') } }, 'انصراف'))));
  }

  // The company unpaired this employee: keep the account, ask for a new code.
  function gone() {
    store(null);
    message('wait', '📱', 'حسابك موقوف بهذي الشركة', 'مديرك فك ربط حسابك. اطلب منه رمز ربط جديد وامسحه بالكاميرا، وتكدر تستخدم نفس الإيميل.', saved() ? logoutButton() : null);
  }
  function logoutButton() {
    return h('button', { class: 'btn', 'data-testid': 'button-logout', on: { click: async () => { store(null); await auth.signOut(); welcome(); } } }, 'تسجيل الخروج');
  }

  // ---------- The signed-in app ----------
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    pay: '<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M7 15h3"/>',
    items: '<circle cx="9" cy="9" r="5.5"/><path d="M14.5 9.6a5.5 5.5 0 1 1-4.9 8.8M9 6.5v5M7 8.5h4"/>',
    attendance: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M8.5 15l2.5 2.5 4.5-5"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>',
  };
  const TABS = [['home', 'الرئيسية'], ['pay', 'الراتب'], ['items', 'السلف'], ['attendance', 'الحضور'], ['account', 'حسابي']];
  let state = null;

  async function app(tab) {
    const me = await current();
    if (!me) return welcome();
    if (!state || state.me.employeeId !== me.employeeId) waiting('جاري التحميل…');
    let s;
    try { const doc = await db.doc(`att/${me.cid}/staff/${me.employeeId}`).get(); s = doc.exists ? doc.data() : null; }
    catch (e) {
      if (denied(e)) return gone();
      return message('bad', '!', 'تعذّر التحميل', 'تأكد من الإنترنت.', h('button', { class: 'btn', on: { click: () => app(tab) } }, 'إعادة المحاولة'));
    }
    if (!s) return message('wait', '⏳', 'تم التسجيل', 'بياناتك تظهر هنا بعد ما يحدّث برنامج الشركة، عادةً خلال دقائق.', h('button', { class: 'btn', on: { click: () => app(tab) } }, 'تحديث'));
    if ((s.company && me.company !== s.company) || (s.name && me.name !== s.name)) store({ ...me, company: s.company, name: s.name });
    header(s.company, s.name + (s.jobTitle ? ' · ' + s.jobTitle : ''));
    state = { me: load() || me, s, tab: tab || (state && state.tab) || 'home' };
    render();
  }

  function render() {
    const { tab } = state;
    tabbar.replaceChildren(...TABS.map(([id, label]) => h('button', { class: id === tab ? 'on' : '', 'data-testid': 'tab-' + id, 'aria-current': id === tab ? 'page' : false,
      on: { click: () => { state.tab = id; render(); } } }, svg(ICONS[id]), h('span', {}, label))));
    view.replaceChildren(...{ home: homeTab, pay: payTab, items: itemsTab, attendance: attendanceTab, account: accountTab }[tab]().filter(Boolean));
    tabbar.hidden = false; document.body.classList.add('has-tabs');
    window.scrollTo(0, 0);
  }

  const allDays = () => {
    const all = [...(state.s.attendance || [])];
    for (const x of state.me.recent || []) if (!all.some((y) => y.kind === x.kind && Math.abs(Date.parse(y.at) - Date.parse(x.at)) < 180000)) all.push(x);
    const days = new Map();
    for (const x of all.sort((a, b) => a.at.localeCompare(b.at))) {
      const k = dayKey(x.at), d = days.get(k) || {};
      if (x.kind === 'in' && !d.in) d.in = x.at;
      if (x.kind === 'out') d.out = x.at;
      days.set(k, d);
    }
    return [...days].sort((a, b) => b[0].localeCompare(a[0]));
  };
  const allItems = () => (state.s.months || []).flatMap((m) => m.items.map((i) => ({ ...i, period: m.period }))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const stat = (label, value, tone) => h('div', { class: 'stat' }, h('span', {}, label), h('b', { class: 'num', style: tone ? `color:var(--${tone})` : null }, value));
  const updated = () => h('p', { class: 'hint' }, 'آخر تحديث من الشركة: ', h('span', { class: 'num' }, state.s.updated ? state.s.updated.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'),
    ' · ', h('button', { class: 'link', on: { click: () => app() } }, 'تحديث'));

  function saveBanner() {
    if (saved()) return null;
    return h('div', { class: 'card note' }, h('b', {}, 'احفظ حسابك'),
      h('p', {}, 'حتى تدخل من أي تلفون بدون رمز، أو إذا انمسحت بيانات المتصفح.'),
      h('button', { class: 'btn primary', 'data-testid': 'button-save-account', on: { click: () => { state.tab = 'account'; render(); } } }, 'احفظ حسابي'));
  }

  function homeTab() {
    const [m] = state.s.months || [];
    const today = allDays().find(([k]) => k === dayKey(new Date().toISOString()));
    const d = today ? today[1] : {};
    return [saveBanner(),
      m ? h('div', { class: 'card' },
        h('div', { class: 'between' }, h('h2', { style: 'margin:0' }, 'راتب ' + monthName(m.period)), paidPill(m)),
        h('div', { class: 'muted', style: 'margin-top:10px' }, m.paid ? 'الصافي المستلم' : 'الصافي المتوقع'),
        h('div', { class: 'big num', 'data-testid': 'text-net' }, iqd(m.net)),
        h('div', { class: 'stats' }, stat('الراتب', iqd(m.salary)), stat('السلف', iqd(m.advances), m.advances ? 'amber' : null),
          stat('الخصومات', iqd(m.deductions), m.deductions ? 'red' : null), stat('المكافآت', iqd(m.bonuses), m.bonuses ? 'green' : null)))
        : h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'ما اكو رواتب بعد.')),
      h('div', { class: 'card' }, h('h2', {}, 'اليوم'),
        h('div', { class: 'stats two' }, stat('الحضور', d.in ? hm(d.in) : '—', d.in ? 'green' : null), stat('الانصراف', d.out ? hm(d.out) : '—', d.out ? 'blue' : null)),
        h('p', { class: 'hint', style: 'margin-bottom:0' }, 'لتسجيل الحضور أو الانصراف قرّب تلفونك من ملصق الشركة.')),
      allItems().length ? h('div', { class: 'card' }, h('div', { class: 'between' }, h('h2', { style: 'margin:0' }, 'آخر الحركات'),
        h('button', { class: 'link', on: { click: () => { state.tab = 'items'; render(); } } }, 'الكل')), itemList(allItems().slice(0, 3))) : null,
      updated()];
  }

  const paidPill = (m) => m.paid ? h('span', { class: 'pill green' }, 'مصروف ' + shortDate(m.paidOn)) : h('span', { class: 'pill amber' }, 'غير مصروف بعد');
  function itemList(items) {
    return h('ul', { class: 'items' }, items.map((i) => h('li', {},
      h('span', {}, h('span', { class: 'pill ' + KIND[i.kind][1] }, KIND[i.kind][0]), ' ', i.reason || '', h('small', { class: 'num' }, shortDate(i.date))),
      h('span', { class: 'num' }, KIND[i.kind][2] + iqd(i.amount)))));
  }
  function monthBody(m) {
    return [h('div', { class: 'lines' },
      h('div', {}, h('span', {}, 'الراتب الأساسي'), h('span', { class: 'num' }, iqd(m.salary))),
      m.bonuses ? h('div', {}, h('span', {}, 'المكافآت'), h('span', { class: 'num', style: 'color:var(--green)' }, '+' + iqd(m.bonuses))) : null,
      m.deductions ? h('div', {}, h('span', {}, 'الخصومات'), h('span', { class: 'num', style: 'color:var(--red)' }, '−' + iqd(m.deductions))) : null,
      m.advances ? h('div', {}, h('span', {}, 'السلف'), h('span', { class: 'num', style: 'color:var(--amber)' }, '−' + iqd(m.advances))) : null,
      h('div', { class: 'total' }, h('span', {}, 'الصافي'), h('span', { class: 'num' }, iqd(m.net)))),
      m.items.length ? itemList(m.items) : null];
  }
  function payTab() {
    const months = state.s.months || [];
    if (!months.length) return [h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'ما اكو رواتب بعد.'))];
    const year = months.filter((m) => m.paid).reduce((t, m) => t + m.net, 0);
    return [h('div', { class: 'card' }, h('h2', {}, 'رواتبي'), h('div', { class: 'stats two' }, stat('المستلم آخر 12 شهر', iqd(year)), stat('عدد الأشهر', String(months.length)))),
      ...months.map((m, i) => i === 0
        ? h('div', { class: 'card' }, h('div', { class: 'between' }, h('h2', { style: 'margin:0' }, monthName(m.period)), paidPill(m)), monthBody(m))
        : h('div', { class: 'card fold' }, h('details', {}, h('summary', {}, h('span', {}, monthName(m.period)), h('span', { class: 'num' }, iqd(m.net))), paidPill(m), monthBody(m)))),
      updated()];
  }
  function itemsTab() {
    const items = allItems(), sum = (k) => items.filter((i) => i.kind === k).reduce((t, i) => t + i.amount, 0);
    const list = h('div', {});
    const filter = (k) => list.replaceChildren(...(items.filter((i) => !k || i.kind === k).length
      ? [itemList(items.filter((i) => !k || i.kind === k))] : [h('p', { class: 'muted', style: 'margin:12px 0 0' }, 'ما اكو شي.')]));
    const chips = h('div', { class: 'seg' }, [['', 'الكل'], ['advance', 'السلف'], ['deduction', 'الخصومات'], ['bonus', 'المكافآت']].map(([k, label], n) =>
      h('button', { class: n ? '' : 'on', type: 'button', on: { click: (ev) => { for (const b of chips.children) b.classList.toggle('on', b === ev.currentTarget); filter(k); } } }, label)));
    filter('');
    return [h('div', { class: 'card' }, h('h2', {}, 'السلف والخصومات'), h('p', { class: 'muted' }, 'آخر 12 شهر'),
      h('div', { class: 'stats three' }, stat('السلف', iqd(sum('advance')), 'amber'), stat('الخصومات', iqd(sum('deduction')), 'red'), stat('المكافآت', iqd(sum('bonus')), 'green'))),
      h('div', { class: 'card' }, chips, list), updated()];
  }
  function attendanceTab() {
    const rows = allDays(), month = dayKey(new Date().toISOString()).slice(0, 7);
    const thisMonth = rows.filter(([k, d]) => k.startsWith(month) && d.in).length;
    return [h('div', { class: 'card' }, h('h2', {}, 'حضوري'), h('div', { class: 'stats two' }, stat('أيام الحضور هذا الشهر', String(thisMonth)), stat('آخر 60 يوم', String(rows.filter(([, d]) => d.in).length)))),
      h('div', { class: 'card' }, !rows.length ? h('p', { style: 'margin:0' }, 'ما اكو بصمات بعد. قرّب تلفونك من ملصق الشركة حتى تسجل حضورك.')
        : h('div', { class: 'days' }, h('div', { class: 'head' }, h('span', {}, 'اليوم'), h('span', {}, 'الحضور'), h('span', {}, 'الانصراف')),
          rows.map(([k, d]) => h('div', {}, h('span', {}, dayName(k)), h('span', { class: 'num' }, d.in ? hm(d.in) : '—'), h('span', { class: 'num' }, d.out ? hm(d.out) : '—'))))),
      updated()];
  }
  function accountTab() {
    const s = state.s, me = state.me;
    const info = h('div', { class: 'card' }, h('h2', {}, 'معلوماتي'), h('div', { class: 'lines' },
      h('div', {}, h('span', {}, 'الاسم'), h('span', {}, s.name)),
      s.jobTitle ? h('div', {}, h('span', {}, 'الوظيفة'), h('span', {}, s.jobTitle)) : null,
      h('div', {}, h('span', {}, 'الشركة'), h('span', {}, s.company || '—')),
      h('div', {}, h('span', {}, 'الدخول'), saved() ? h('span', { dir: 'ltr', 'data-testid': 'text-email' }, auth.currentUser.email) : h('span', { class: 'pill amber' }, 'غير محفوظ')),
      h('div', {}, h('span', {}, 'Face ID بهذا التلفون'), h('span', { class: 'pill ' + (me.cred ? 'green' : 'amber') }, me.cred ? 'مفعّل' : 'يتفعّل بأول بصمة'))));
    if (saved()) return [info, h('div', { class: 'card' }, h('p', {}, 'تكدر تدخل بنفس الإيميل وكلمة السر من أي تلفون.'), logoutButton()), updated()];
    const f = accountFields('new');
    const go = h('button', { class: 'btn primary', 'data-testid': 'button-link-account', on: { click: async () => {
      const v = f.read(); if (!v) return;
      if (OTP_URL && !verified.has(v.email)) return askCode(v.email, 'link', 'احفظ حسابي', () => go.click());
      go.disabled = true;
      try {
        await auth.currentUser.linkWithCredential(firebase.auth.EmailAuthProvider.credential(v.email, v.pass));
        await remember(me.cid, me.employeeId);
        render();
      } catch (e) { f.err.textContent = authError(e); go.disabled = false; }
    } } }, 'احفظ حسابي');
    return [info, h('div', { class: 'card' }, h('h2', {}, 'احفظ حسابك'),
      h('p', {}, 'اختار إيميل وكلمة سر. بعدها تدخل من أي تلفون بدون رمز ربط، وحتى لو انمسحت بيانات المتصفح.'), f.node, go)];
  }

  async function boot() {
    const m = location.hash.match(/^#([pt])=([a-z0-9]{20})\.([A-Z2-9]{8,16})$/);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    try { await start(); }
    catch { return message('bad', '!', 'تعذّر الاتصال', 'تأكد من الإنترنت وافتح الصفحة مرة ثانية.'); }
    if (m && m[1] === 'p') return pairFlow(m[2], m[3]);
    if (m && m[1] === 't') return tapFlow(m[2], m[3]);
    return app();
  }
  boot();
})();
