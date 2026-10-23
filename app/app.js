// Grdlabs employee app: pair this phone once, clock in/out at the company's NFC sticker, and see your own pay.
// Pairing link: #p=<company id>.<code>; sticker link: #t=<company id>.<tag token>. Firestore rules enforce who sees what.
(() => {
  'use strict';
  const KEY = 'grdlabs-employee-v1';
  const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const KIND = { bonus: ['مكافأة', 'green', '+'], deduction: ['خصم', 'red', '−'], advance: ['سلفة', 'amber', '−'] };
  const view = document.getElementById('view');
  const nf = new Intl.NumberFormat('en-US');
  const iqd = (n) => nf.format(Math.round(n || 0)) + ' د.ع';
  const monthName = (p) => { const [y, m] = p.split('-').map(Number); return MONTHS[m - 1] + ' ' + y; };
  const hm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayKey = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const dayName = (k) => new Date(k + 'T12:00:00').toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'numeric' });

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
  const show = (...nodes) => { view.replaceChildren(...nodes); window.scrollTo(0, 0); };
  const message = (tone, icon, title, text, ...extra) => show(h('div', { class: 'card msg' }, h('div', { class: 'ic ' + tone }, icon), h('h1', {}, title), text && h('p', {}, text), ...extra));
  const waiting = (title) => show(h('div', { class: 'card msg' }, h('div', { class: 'ic wait' }, h('div', { class: 'spin' })), h('h1', {}, title)));

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
  async function signIn() {
    firebase.initializeApp(window.GRDLABS_CONFIG.firebase);
    auth = firebase.auth(); db = firebase.firestore();
    // Local test hook only: ?emu=1 on localhost talks to the Firebase emulators.
    if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emu')) {
      auth.useEmulator('http://127.0.0.1:9099'); db.useEmulator('127.0.0.1', 8085);
    }
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const user = await new Promise((ok) => { const off = auth.onAuthStateChanged((u) => { off(); ok(u); }); });
    return user || (await auth.signInAnonymously()).user;
  }
  const denied = (e) => e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
  const offline = (e) => e && (e.code === 'unavailable' || /offline|network/i.test(e.message || ''));

  function unpaired(extra) {
    store(null);
    message('wait', '📱', 'التلفون مو مربوط', extra || 'هذا التطبيق لموظفي الشركات اللي تستخدم Grdlabs. اطلب من مديرك رمز الربط وامسحه بكاميرا التلفون.');
  }

  async function pairFlow(cid, code) {
    waiting('جاري التحقق من الرمز…');
    let pair;
    try { pair = await db.doc(`att/${cid}/pairs/${code}`).get(); }
    catch (e) { return message('bad', '!', 'تعذّر التحقق', offline(e) ? 'تأكد من الإنترنت وافتح الرابط مرة ثانية.' : 'افتح الرابط مرة ثانية أو اطلب رمز جديد.'); }
    const p = pair.exists && pair.data();
    if (!p || p.used || p.exp.toMillis() < Date.now()) return message('bad', '!', 'الرمز منتهي أو مستخدم', 'اطلب من مديرك رمز ربط جديد.');
    const bio = await bioAvailable();
    show(h('div', { class: 'card' },
      h('h1', {}, 'أهلاً ' + p.name),
      h('p', {}, 'راح يرتبط هذا التلفون بحسابك. بعدها تكدر تسجل حضورك من ملصق الشركة وتشوف راتبك وسلفك وخصوماتك.'),
      bio ? h('p', {}, 'راح يطلب منك Face ID أو البصمة حتى يتأكد إنك صاحب التلفون.')
        : h('p', { style: 'color:var(--red)' }, 'هذا المتصفح ما يدعم Face ID أو البصمة. افتح الرابط بـ Safari بالآيفون أو Chrome بالأندرويد، وتأكد إن قفل الشاشة مفعّل.'),
      h('button', { class: 'btn primary', disabled: !bio, 'data-testid': 'button-pair', on: { click: async (ev) => {
        ev.currentTarget.disabled = true;
        let cred;
        try { cred = await enroll(p.name); }
        catch { ev.currentTarget.disabled = false; return; }
        waiting('جاري ربط التلفون…');
        try {
          const uid = auth.currentUser.uid, b = db.batch();
          b.update(db.doc(`att/${cid}/pairs/${code}`), { used: true, usedBy: uid });
          b.set(db.doc(`att/${cid}/members/${uid}`), { employeeId: p.employeeId, code, at: firebase.firestore.FieldValue.serverTimestamp(), label: navigator.platform || 'phone' });
          await b.commit();
          store({ cid, employeeId: p.employeeId, cred, name: p.name, recent: [] });
          message('ok', '✓', 'تم ربط التلفون', 'لتسجيل الحضور قرّب تلفونك من ملصق الشركة. راتبك يظهر هنا بعد ما يحدّث البرنامج بيانات الشركة.',
            h('button', { class: 'btn primary', on: { click: home } }, 'عرض راتبي'));
        } catch (e) {
          message('bad', '!', 'ما تم الربط', offline(e) ? 'تأكد من الإنترنت وافتح الرابط مرة ثانية.' : 'الرمز استُخدم أو انتهى. اطلب من مديرك رمز جديد.');
        }
      } } }, 'ربط التلفون')));
  }

  async function tapFlow(cid, tag) {
    const me = load();
    if (!me) return unpaired('امسح رمز الربط اللي يعطيك ياه مديرك أول، وبعدين قرّب التلفون من الملصق.');
    if (me.cid !== cid) return message('bad', '!', 'هذا الملصق لشركة ثانية', 'تلفونك مربوط بشركة ثانية.');
    if (me.company) document.getElementById('company').textContent = me.company;
    document.getElementById('who').textContent = me.name;
    const today = dayKey(new Date().toISOString());
    const last = (me.recent || []).filter((x) => dayKey(x.at) === today).pop();
    const suggest = last && last.kind === 'in' ? 'out' : 'in';
    const clock = (kind) => async (ev) => {
      ev.currentTarget.disabled = true;
      try { await verify(me.cred); }
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
          h('button', { class: 'btn', on: { click: home } }, 'عرض راتبي وحضوري'));
      } catch (e) {
        if (denied(e)) return unpaired('انفك ربط هذا التلفون. اطلب من مديرك رمز ربط جديد.');
        message('bad', '!', 'ما تسجّل', offline(e) ? 'تأكد من الإنترنت وقرّب التلفون من الملصق مرة ثانية.' : 'صار خطأ. قرّب التلفون من الملصق مرة ثانية.');
      }
    };
    show(h('div', { class: 'card' },
      h('h1', {}, 'أهلاً ' + me.name),
      h('p', {}, 'اختار شنو تريد تسجل. راح يطلب منك Face ID أو البصمة، وبعدها يتأكد من موقعك.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ' + (suggest === 'in' ? 'green' : ''), 'data-testid': 'button-clock-in', on: { click: clock('in') } }, 'حضور'),
        h('button', { class: 'btn ' + (suggest === 'out' ? 'primary' : ''), 'data-testid': 'button-clock-out', on: { click: clock('out') } }, 'انصراف'))));
  }

  function attendanceCard(server, recent) {
    const all = [...server];
    for (const x of recent) if (!all.some((y) => y.kind === x.kind && Math.abs(Date.parse(y.at) - Date.parse(x.at)) < 180000)) all.push(x);
    const days = new Map();
    for (const x of all.sort((a, b) => a.at.localeCompare(b.at))) {
      const k = dayKey(x.at), d = days.get(k) || {};
      if (x.kind === 'in' && !d.in) d.in = x.at;
      if (x.kind === 'out') d.out = x.at;
      days.set(k, d);
    }
    const rows = [...days].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 31);
    return h('div', { class: 'card' }, h('h2', {}, 'حضوري'),
      !rows.length ? h('p', {}, 'ما اكو بصمات بعد. قرّب تلفونك من ملصق الشركة حتى تسجل حضورك.')
        : h('div', { class: 'days' }, h('div', { class: 'head' }, h('span', {}, 'اليوم'), h('span', {}, 'الحضور'), h('span', {}, 'الانصراف')),
          rows.map(([k, d]) => h('div', {}, h('span', {}, dayName(k)), h('span', { class: 'num' }, d.in ? hm(d.in) : '—'), h('span', { class: 'num' }, d.out ? hm(d.out) : '—')))));
  }
  function monthCard(m, open) {
    const lines = h('div', { class: 'lines' },
      h('div', {}, h('span', {}, 'الراتب الأساسي'), h('span', { class: 'num' }, iqd(m.salary))),
      m.bonuses ? h('div', {}, h('span', {}, 'المكافآت'), h('span', { class: 'num', style: 'color:var(--green)' }, '+' + iqd(m.bonuses))) : null,
      m.deductions ? h('div', {}, h('span', {}, 'الخصومات'), h('span', { class: 'num', style: 'color:var(--red)' }, '−' + iqd(m.deductions))) : null,
      m.advances ? h('div', {}, h('span', {}, 'السلف'), h('span', { class: 'num', style: 'color:var(--amber)' }, '−' + iqd(m.advances))) : null);
    const items = m.items.length ? h('ul', { class: 'items' }, m.items.map((i) => h('li', {},
      h('span', {}, h('span', { class: 'pill ' + KIND[i.kind][1] }, KIND[i.kind][0]), ' ', i.reason || ''),
      h('span', { class: 'num' }, KIND[i.kind][2] + iqd(i.amount))))) : null;
    const status = m.paid ? h('span', { class: 'pill green' }, 'مصروف ' + m.paidOn) : h('span', { class: 'pill amber' }, 'غير مصروف بعد');
    if (open) return h('div', { class: 'card' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('h2', { style: 'margin:0' }, 'راتب ' + monthName(m.period)), status),
      h('div', { class: 'muted', style: 'margin-top:10px' }, m.paid ? 'الصافي المستلم' : 'الصافي المتوقع'), h('div', { class: 'big num', 'data-testid': 'text-net' }, iqd(m.net)), lines, items);
    return h('details', {}, h('summary', {}, h('span', {}, monthName(m.period)), h('span', { class: 'num' }, iqd(m.net))), status, lines, items);
  }

  async function home() {
    const me = load();
    if (!me) return unpaired();
    waiting('جاري التحميل…');
    let doc;
    try { doc = await db.doc(`att/${me.cid}/staff/${me.employeeId}`).get(); }
    catch (e) {
      if (denied(e)) return unpaired('انفك ربط هذا التلفون. اطلب من مديرك رمز ربط جديد.');
      return message('bad', '!', 'تعذّر التحميل', 'تأكد من الإنترنت.', h('button', { class: 'btn', on: { click: home } }, 'إعادة المحاولة'));
    }
    if (!doc.exists) return message('wait', '⏳', 'تم ربط التلفون', 'بياناتك تظهر هنا بعد ما يحدّث برنامج الشركة، عادةً خلال دقائق.', h('button', { class: 'btn', on: { click: home } }, 'تحديث'));
    const s = doc.data();
    document.getElementById('company').textContent = s.company || 'Grdlabs';
    if (s.company && me.company !== s.company) store({ ...me, company: s.company });
    document.getElementById('who').textContent = s.name + (s.jobTitle ? ' · ' + s.jobTitle : '');
    const [current, ...older] = s.months || [];
    show(current ? monthCard(current, true) : h('div', { class: 'card' }, h('p', {}, 'ما اكو رواتب بعد.')),
      attendanceCard(s.attendance || [], me.recent || []),
      older.length ? h('div', { class: 'card' }, h('h2', {}, 'الأشهر السابقة'), older.map((m) => monthCard(m, false))) : null,
      h('p', { class: 'hint' }, 'آخر تحديث من الشركة: ', h('span', { class: 'num' }, s.updated ? s.updated.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'),
        '. لتسجيل الحضور قرّب تلفونك من ملصق الشركة.'));
  }

  async function boot() {
    const m = location.hash.match(/^#([pt])=([a-z0-9]{20})\.([A-Z2-9]{8,16})$/);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    try { await signIn(); }
    catch { return message('bad', '!', 'تعذّر الاتصال', 'تأكد من الإنترنت وافتح الصفحة مرة ثانية.'); }
    if (m && m[1] === 'p') return pairFlow(m[2], m[3]);
    if (m && m[1] === 't') return tapFlow(m[2], m[3]);
    return home();
  }
  boot();
})();
