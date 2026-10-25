/* Grdlabs control panel, website build.
 * Signs the owner in (Firebase, or Supabase) and gives the page the same small store it uses inside claude.ai
 * (doc(path).set/delete/onSnapshot, collection(name).onSnapshot), backed by Firestore documents of the same paths.
 * The signing seed never reaches the database in the clear: it is sealed with AES-GCM under a key
 * derived from a passphrase that only the owner knows, and opened in this tab's memory. */
(() => {
  const CFG = window.GRDLABS_CONFIG || {};
  const ITER = 310000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  // ---------- small modal ----------
  const css = document.createElement('style');
  css.textContent = `
  .gw-scrim{position:fixed;inset:0;z-index:100;background:var(--bg,#eef1f8);display:grid;place-items:center;padding:16px}
  .gw-box{width:min(400px,100%);background:var(--panel,#fff);border:1px solid var(--line,#dfe3ee);border-radius:18px;padding:28px;display:grid;gap:14px;box-shadow:0 20px 60px -20px rgba(20,28,48,.25)}
  .gw-box h2{margin:0;font-size:20px}.gw-box p{margin:0;color:var(--mute,#5f6880);font-size:14px}
  .gw-box label{display:grid;gap:6px;font-size:13px;color:var(--mute,#5f6880)}
  .gw-box .gw-err{color:#c92a2a;font-size:13px;min-height:1.2em}
  .gw-box .gw-logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px}
  .gw-box .gw-logo i{width:12px;height:12px;border-radius:4px;background:var(--mark,#3fb34f)}
  .gw-out{position:fixed;inset-inline-start:16px;bottom:16px;z-index:50}`;
  document.head.append(css);

  function modal({ title, text, fields, submit, alt }) {
    return new Promise((resolve) => {
      const scrim = document.createElement('div'); scrim.className = 'gw-scrim';
      const form = document.createElement('form'); form.className = 'gw-box'; form.noValidate = true;
      form.innerHTML = `<div class="gw-logo"><i></i>Grdlabs</div><h2></h2><p></p>`;
      form.querySelector('h2').textContent = title; form.querySelector('p').textContent = text || '';
      const inputs = fields.map(f => {
        const l = document.createElement('label'); l.textContent = f.label;
        const i = document.createElement('input'); Object.assign(i, { type: f.type || 'text', autocomplete: f.auto || 'off', required: true, dir: 'ltr' });
        l.append(i); form.append(l); return i;
      });
      const err = document.createElement('div'); err.className = 'gw-err'; err.setAttribute('role', 'alert');
      const go = document.createElement('button'); go.type = 'submit'; go.className = 'primary'; go.textContent = submit;
      form.append(err, go);
      if (alt) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = alt.label; b.onclick = () => { scrim.remove(); resolve({ alt: true }); }; form.append(b); }
      form.onsubmit = async (e) => {
        e.preventDefault(); err.textContent = '';
        const values = inputs.map(i => i.value);
        // Enter on a field with others still empty moves to the next empty one instead of complaining.
        const empty = inputs.find(i => !i.value.trim());
        if (empty) { empty.focus(); return; }
        go.disabled = true;
        try { const r = await (fields.check ? fields.check(values) : null); if (r) { err.textContent = r; go.disabled = false; return; } }
        catch (x) { err.textContent = String(x?.message || x); go.disabled = false; return; }
        scrim.remove(); resolve({ values });
      };
      scrim.append(form); document.body.append(scrim); setTimeout(() => inputs[0]?.focus(), 30);
    });
  }

  // ---------- passphrase sealing ----------
  async function derive(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(seed, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(pass, salt), enc.encode(seed)));
    return { sealed: b64(ct), salt: b64(salt), iv: b64(iv), iter: ITER };
  }
  async function open(doc, pass) {
    const k = await derive(pass, unb64(doc.salt));
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(doc.iv) }, k, unb64(doc.sealed)));
  }

  // ---------- backends ----------
  const COLLS = ['companies', 'plans', 'payments', 'reports', 'secret', 'meta'];
  const authMsg = (e) => {
    const m = String(e?.code || e?.message || e);
    if (/invalid|wrong-password|user-not-found|credential/i.test(m)) return 'الإيميل أو كلمة السر غلط.';
    if (/email-already|already/i.test(m)) return 'هذا الإيميل عنده حساب. ارجع وسجّل دخول.';
    if (/weak-password/i.test(m)) return 'كلمة السر ضعيفة.';
    if (/network/i.test(m)) return 'ما في اتصال بالإنترنت.';
    return 'صار خطأ: ' + m;
  };
  function firebaseBackend() {
    const app = window.firebase.initializeApp(CFG.firebase);
    const auth = app.auth(), fs = app.firestore();
    return {
      session: () => new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); }),
      async signIn(email, pass) { try { await auth.signInWithEmailAndPassword(email, pass); } catch (e) { return authMsg(e); } },
      async signUp(email, pass) { try { await auth.createUserWithEmailAndPassword(email, pass); } catch (e) { return authMsg(e); } },
      signOut: () => auth.signOut(),
      idToken: () => auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null),
      async isOwner() {
        const uid = auth.currentUser.uid, ref = fs.doc('control/owner');
        try { const d = await ref.get(); if (d.exists && d.data().uid === uid) return true; } catch { /* missing, or someone else's */ }
        // The first signed-in account claims the panel; the rules let this create happen only once.
        try { await ref.set({ uid, at: new Date().toISOString() }); return true; } catch { return false; }
      },
      async list() {
        const all = [];
        for (const c of COLLS) (await fs.collection(c).get()).forEach(d => all.push({ path: c + '/' + d.id, data: d.data() }));
        return all;
      },
      put: (path, data) => fs.doc(path).set(data),
      del: (path) => fs.doc(path).delete(),
    };
  }
  function supabaseBackend() {
    const sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    return {
      session: async () => (await sb.auth.getSession()).data.session,
      async signIn(email, password) { const r = await sb.auth.signInWithPassword({ email, password }); if (r.error) return authMsg(r.error); },
      async signUp(email, password) {
        const r = await sb.auth.signUp({ email, password });
        if (r.error) return authMsg(r.error);
        if (!r.data.session) return 'انرسل إيميل تأكيد. افتحه واضغط الرابط، وبعدها ارجع وسجّل دخول.';
      },
      signOut: () => sb.auth.signOut(),
      isOwner: async () => { const r = await sb.rpc('control_is_owner'); return !r.error && !!r.data; },
      async list() {
        const all = [];
        for (let from = 0; ; from += 1000) { const d = ok(await sb.from('control_docs').select('path,data').range(from, from + 999)); all.push(...d); if (d.length < 1000) break; }
        return all;
      },
      put: async (path, data) => ok(await sb.from('control_docs').upsert({ path, coll: path.split('/')[0], data, updated_at: new Date().toISOString() })),
      del: async (path) => ok(await sb.from('control_docs').delete().eq('path', path)),
    };
  }

  // ---------- store ----------
  let backend = null;
  async function db() {
    const be = CFG.firebase?.apiKey && window.firebase ? firebaseBackend() : CFG.url && CFG.anonKey && window.supabase ? supabaseBackend() : null;
    backend = be;
    if (!be) {
      await modal({ title: 'الموقع مو مربوط بعد', text: 'إعدادات قاعدة البيانات ناقصة في config.js.', fields: [], submit: 'حسناً' });
      return null;
    }

    // Sign in. The first account to sign in claims the panel; any other account sees nothing.
    while (!(await be.session())) {
      const fields = [{ label: 'الإيميل', type: 'email', auto: 'username' }, { label: 'كلمة السر', type: 'password', auto: 'current-password' }];
      fields.check = ([email, password]) => be.signIn(email.trim(), password);
      const res = await modal({ title: 'تسجيل الدخول', text: 'لوحة تحكم Grdlabs. الدخول لصاحب الحساب فقط.', fields, submit: 'دخول', alt: { label: 'أول مرة؟ سوّي حساب المالك' } });
      if (res.alt) {
        const f2 = [{ label: 'الإيميل', type: 'email', auto: 'username' }, { label: 'كلمة سر الدخول (8 أحرف أو أكثر)', type: 'password', auto: 'new-password' }];
        f2.check = ([email, password]) => password.length < 8 ? 'كلمة السر لازم 8 أحرف أو أكثر.' : be.signUp(email.trim(), password);
        await modal({ title: 'حساب المالك', text: 'أول حساب يدخل هو المالك الوحيد للوحة.', fields: f2, submit: 'سوّي الحساب', alt: { label: 'رجوع' } });
      }
    }

    if (!(await be.isOwner())) {
      await modal({ title: 'هذا الحساب ما عنده صلاحية', text: 'اللوحة مقفولة على حساب المالك فقط.', fields: [], submit: 'خروج' });
      await be.signOut(); location.reload(); return null;
    }

    const out = document.createElement('button'); out.type = 'button'; out.textContent = 'تسجيل خروج';
    out.onclick = async () => { await be.signOut(); location.reload(); };
    const foot = document.querySelector('.railfoot');
    if (foot) { out.className = 'ghost sm'; out.style.paddingInline = '0'; foot.append(out); } else { out.className = 'gw-out'; document.body.append(out); }

    const rows = new Map(); // path -> data
    const subs = new Set();
    let pass = null, seed = null;
    const notify = () => subs.forEach(f => f());
    async function refresh() {
      const all = await be.list();
      rows.clear(); for (const r of all) rows.set(r.path, r.data);
      notify();
    }
    async function unlock() {
      const doc = rows.get('secret/key');
      if (!doc?.sealed || seed) return;
      const f = [{ label: 'كلمة سر المفتاح', type: 'password', auto: 'off' }];
      f.check = async ([p]) => { try { seed = await open(doc, p); pass = p; } catch { return 'كلمة السر غلط.'; } };
      const r = await modal({ title: 'فتح مفتاح التوقيع', text: 'حتى تطلّع أكواد، اكتب كلمة سر المفتاح. تبقى بهذي الصفحة لحد ما تسكّرها.', fields: f, submit: 'فتح', alt: { label: 'بعدين' } });
      if (!r.alt) notify();
    }
    async function askNewPass() {
      const f = [{ label: 'كلمة سر المفتاح (10 أحرف أو أكثر)', type: 'password', auto: 'new-password' }, { label: 'أعدها', type: 'password', auto: 'new-password' }];
      f.check = async ([a, b]) => { if (a.length < 10) return 'لازم 10 أحرف أو أكثر.'; if (a !== b) return 'الكلمتين مو نفس الشي.'; };
      const r = await modal({ title: 'كلمة سر للمفتاح', text: 'المفتاح ينحفظ مشفّر بهذي الكلمة. إذا نسيتها تحتاج ملف النسخة الاحتياطية حتى ترجعه.', fields: f, submit: 'حفظ', alt: { label: 'إلغاء' } });
      if (r.alt) throw { code: 'declined' };
      return r.values[0];
    }
    const view = (path) => {
      const v = rows.get(path);
      if (path === 'secret/key') return v && seed ? { seed, public: v.public } : null;
      return v;
    };

    await refresh();
    // Keep a second open tab or device in step without a realtime socket.
    setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => {}); });
    setTimeout(unlock, 50);

    return {
      doc(path) {
        return {
          async set(value) {
            let data = JSON.parse(JSON.stringify(value));
            if (path === 'secret/key') {
              const p = pass || await askNewPass();
              data = { ...(await seal(value.seed, p)), public: value.public };
              pass = p; seed = value.seed;
            }
            await be.put(path, data);
            rows.set(path, data); notify();
          },
          async delete() {
            await be.del(path);
            rows.delete(path); notify();
          },
          onSnapshot(cb) { const f = () => { const v = view(path); cb({ exists: !!v, data: () => v }); }; subs.add(f); setTimeout(f); return () => subs.delete(f); },
        };
      },
      collection(c) {
        return { onSnapshot(cb) {
          const f = () => cb({ docs: [...rows].filter(([p]) => p.startsWith(c + '/')).map(([, v]) => ({ data: () => v })) });
          subs.add(f); setTimeout(f); return () => subs.delete(f);
        } };
      },
    };
  }

  // idToken lets pages call Grdlabs services (the email code log) as the signed-in owner.
  window.grdlabsWeb = { db, idToken: () => backend && backend.idToken ? backend.idToken() : Promise.resolve(null) };
})();
