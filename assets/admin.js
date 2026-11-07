// Moderation page (#/admin). Only the owner can use it: the database refuses everybody else.
// It is not linked anywhere on the site. Open <your site>/#/admin and sign in.
(() => {
  'use strict';

  const A = window.NeoApp;
  const API = window.NeoApi;
  const { esc } = A;

  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  let client = null;

  const loadLib = () => new Promise((resolve, reject) => {
    if (window.supabase) { resolve(); return; }
    const s = document.createElement('script');
    s.src = LIB; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the sign-in library.'));
    document.head.appendChild(s);
  });

  const getClient = async () => {
    if (client) return client;
    await loadLib();
    const { url, anonKey } = API.config;
    client = window.supabase.createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return client;
  };

  const root = () => document.getElementById('adminRoot');
  const say = (msg, bad = false) => {
    const el = document.getElementById('admMsg');
    if (!el) return;
    el.textContent = msg;
    el.className = 'adm-msg' + (bad ? ' bad' : '');
  };
  const mb = (n) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '');
  const day = (d) => String(d || '').slice(0, 10);

  /* ---------- Sign in ---------- */
  const loginView = (c, note = '') => {
    root().innerHTML = `
      <form class="form panel" id="login" novalidate>
        <h2>Admin sign in</h2>
        ${note ? `<p class="adm-msg bad">${esc(note)}</p>` : ''}
        <label class="field">E-mail <input name="email" type="email" autocomplete="username" required></label>
        <label class="field">Password <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="adm-msg bad" id="loginErr" role="alert"></p>
        <button class="btn primary big" type="submit">Sign in</button>
      </form>`;
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const { error } = await c.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) { document.getElementById('loginErr').textContent = 'Sign in failed. Check e-mail and password.'; return; }
      views.admin();
    });
  };

  /* ---------- Panel ---------- */
  const rowHtml = (p) => {
    const rels = (p.releases || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return `
      <article class="adm-row${p.hidden ? ' is-hidden' : ''}" data-id="${esc(p.id)}">
        <img class="icon" src="${esc(A.safeUrl(API.publicUrl(p.icon_path)))}" alt="" width="48" height="48" loading="lazy">
        <div class="adm-main">
          <strong>${esc(p.name)}</strong>
          <span class="badge ${esc(p.type)}">${esc(p.type)}</span>
          ${p.type === 'plugin' ? `<span class="badge plat">${esc(A.platformName(p.platform))}</span>` : ''}
          ${p.hidden ? '<span class="vtag">hidden</span>' : ''}
          <div class="adm-sub">by ${esc(p.author)} · ${esc(day(p.created_at))} · ${rels.length} release${rels.length === 1 ? '' : 's'} · /${esc(p.slug)}</div>
          <div class="adm-sub">${esc(p.summary)}</div>
        </div>
        <div class="adm-actions">
          ${p.hidden ? '' : `<a class="btn small" href="#/mod/${encodeURIComponent(p.slug)}">Open</a>`}
          <button class="btn small" type="button" data-act="toggle">${p.hidden ? 'Show' : 'Hide'}</button>
          <button class="btn small" type="button" data-act="releases">Releases</button>
          <button class="btn small danger" type="button" data-act="delete">Delete</button>
        </div>
        <ul class="adm-rel" hidden>
          ${rels.map((r) => `
            <li data-rid="${esc(r.id)}">
              <span><strong>${esc(r.version)}</strong> · ${esc(day(r.created_at))} · ${esc(mb(r.file_size))} · ${esc(r.file_name)}</span>
              <a class="btn small" href="${esc(A.safeUrl(API.publicUrl(r.file_path)))}" target="_blank" rel="noopener noreferrer">Download</a>
              <button class="btn small danger" type="button" data-act="delrel">Delete</button>
            </li>`).join('')}
        </ul>
      </article>`;
  };

  const panelView = async (c, session) => {
    const { data: isAdmin, error: adminErr } = await c.rpc('is_admin');
    if (adminErr || !isAdmin) {
      root().innerHTML = `
        <div class="panel block">
          <h2>Not an admin</h2>
          <p>${esc(session.user.email)} is signed in, but is not on the admin list. See step 3 at the end of backend/schema.sql.</p>
          <button class="btn" type="button" id="out">Sign out</button>
        </div>`;
      document.getElementById('out').addEventListener('click', async () => { await c.auth.signOut(); views.admin(); });
      return;
    }

    root().innerHTML = `
      <div class="adm-bar">
        <input type="search" id="admFilter" placeholder="Filter by name, author or slug" aria-label="Filter">
        <span class="adm-sub">${esc(session.user.email)}</span>
        <button class="btn small" type="button" id="cleanup" title="Deletes uploaded files that no entry uses, for example after a failed upload">Clean up unused files</button>
        <button class="btn small" type="button" id="out">Sign out</button>
      </div>
      <p class="adm-msg" id="admMsg" role="status"></p>
      <div id="admList"><p class="notice">Loading …</p></div>`;
    document.getElementById('out').addEventListener('click', async () => { await c.auth.signOut(); views.admin(); });

    const { data, error } = await c.from('projects').select('*,releases(*)').order('created_at', { ascending: false }).limit(1000);
    if (error) { say(`Could not load: ${error.message}`, true); return; }
    let projects = data;

    const draw = () => {
      const q = A.norm(document.getElementById('admFilter').value);
      const list = projects.filter((p) => !q || A.norm(`${p.name} ${p.author} ${p.slug}`).includes(q));
      document.getElementById('admList').innerHTML = list.length
        ? list.map(rowHtml).join('')
        : '<p class="notice">Nothing here yet.</p>';
    };
    draw();
    document.getElementById('admFilter').addEventListener('input', draw);

    // Files that were uploaded but never became part of an entry (failed or abandoned uploads).
    document.getElementById('cleanup').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        say('Looking for unused files …');
        const used = new Set(projects.flatMap((p) => [p.icon_path, ...(p.screenshot_paths || []), ...(p.releases || []).map((r) => r.file_path)]));
        const bucket = c.storage.from('files');
        const { data: folders, error: e1 } = await bucket.list('uploads', { limit: 1000 });
        if (e1) throw e1;
        const cutoff = Date.now() - 60 * 60 * 1000; // never touch uploads that are less than an hour old
        const stale = [];
        let bytes = 0;
        for (const f of (folders || []).filter((x) => x.name).slice(0, 300)) {
          const { data: files, error: e2 } = await bucket.list(`uploads/${f.name}`, { limit: 100 });
          if (e2) throw e2;
          for (const file of files || []) {
            const path = `uploads/${f.name}/${file.name}`;
            if (!used.has(path) && new Date(file.created_at).getTime() < cutoff) { stale.push(path); bytes += (file.metadata && file.metadata.size) || 0; }
          }
        }
        if (!stale.length) { say('No unused files found.'); return; }
        if (!window.confirm(`Delete ${stale.length} unused file(s), ${mb(bytes) || '0 MB'} in total?`)) { say(''); return; }
        const { error: e3 } = await bucket.remove(stale);
        if (e3) throw e3;
        say(`Deleted ${stale.length} unused file(s).`);
      } catch (e) {
        say(`Clean-up failed: ${e.message}`, true);
      } finally {
        btn.disabled = false;
      }
    });

    const refreshPublic = () => A.reloadCommunity().catch(() => {});

    const removeFiles = async (paths) => {
      if (!paths.length) return;
      const { error: e } = await c.storage.from('files').remove(paths);
      if (e) say(`Entry removed, but some files could not be deleted: ${e.message}`, true);
    };

    document.getElementById('admList').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const rowEl = btn.closest('.adm-row');
      const p = projects.find((x) => x.id === rowEl.dataset.id);
      if (!p) return;
      const act = btn.dataset.act;

      if (act === 'releases') {
        const ul = rowEl.querySelector('.adm-rel'); ul.hidden = !ul.hidden; return;
      }

      btn.disabled = true;
      try {
        if (act === 'toggle') {
          const { data: rows, error: e } = await c.from('projects').update({ hidden: !p.hidden }).eq('id', p.id).select('id');
          if (e || !rows.length) throw new Error(e ? e.message : 'Not allowed.');
          p.hidden = !p.hidden;
          say(p.hidden ? `"${p.name}" is hidden from the site.` : `"${p.name}" is visible again.`);
          draw(); refreshPublic();
        } else if (act === 'delete') {
          if (!window.confirm(`Delete "${p.name}" with all its releases and files?\n\nThis cannot be undone.`)) { btn.disabled = false; return; }
          const paths = [p.icon_path, ...(p.screenshot_paths || []), ...(p.releases || []).map((r) => r.file_path)];
          const { data: rows, error: e } = await c.from('projects').delete().eq('id', p.id).select('id');
          if (e || !rows.length) throw new Error(e ? e.message : 'Not allowed.');
          projects = projects.filter((x) => x.id !== p.id);
          say(`"${p.name}" was deleted.`);
          draw(); refreshPublic();
          await removeFiles(paths);
        } else if (act === 'delrel') {
          const rid = btn.closest('li').dataset.rid;
          const r = (p.releases || []).find((x) => x.id === rid);
          if (!r) return;
          if ((p.releases || []).length < 2) { say('This is the only release. Delete the whole project instead.', true); btn.disabled = false; return; }
          if (!window.confirm(`Delete version ${r.version} of "${p.name}"?`)) { btn.disabled = false; return; }
          const { data: rows, error: e } = await c.from('releases').delete().eq('id', rid).select('id');
          if (e || !rows.length) throw new Error(e ? e.message : 'Not allowed.');
          p.releases = p.releases.filter((x) => x.id !== rid);
          say(`Version ${r.version} was deleted.`);
          draw(); refreshPublic();
          await removeFiles([r.file_path]);
        }
      } catch (e) {
        say(`Failed: ${e.message}`, true);
        btn.disabled = false;
      }
    });
  };

  /* ---------- Entry ---------- */
  const { views } = A;
  views.admin = async () => {
    A.setNav('admin');
    document.title = 'Admin – NeoMods';
    A.app.innerHTML = '<h1 class="page-title">Admin</h1><div id="adminRoot"><p class="notice">Loading …</p></div>';
    if (!API.enabled()) { root().innerHTML = '<p class="notice">The database is not connected yet. See the README.</p>'; return; }
    try {
      const c = await getClient();
      const { data } = await c.auth.getSession();
      if (!data.session) loginView(c);
      else await panelView(c, data.session);
    } catch (e) {
      root().innerHTML = `<p class="adm-msg bad">${esc(e.message)}</p>`;
    }
  };
})();
