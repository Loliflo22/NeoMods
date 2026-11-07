// Upload page (#/upload) and "add a new version" page (#/manage/<slug>).
(() => {
  'use strict';

  const A = window.NeoApp;
  const API = window.NeoApi;
  const { t, esc, views } = A;

  const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;
  const FILE_EXT = /\.(zip|jar|dll|7z|rar)$/i;
  const VER_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,19}$/;
  const MB = 1024 * 1024;
  const KEY_STORE = 'neomods-keys';

  /* ---------- Saved edit keys (only on this device) ---------- */
  const getKeys = () => { try { return JSON.parse(localStorage.getItem(KEY_STORE) || '{}'); } catch { return {}; } };
  const saveKey = (slug, token) => {
    try { const k = getKeys(); k[slug] = token; localStorage.setItem(KEY_STORE, JSON.stringify(k)); } catch { /* storage blocked */ }
  };

  /* ---------- Shared helpers ---------- */
  const lockLanguage = (on) => { const s = document.getElementById('langSelect'); if (s) s.disabled = on; };

  const errorText = (e) => {
    if (e.code === 'invalid_input') {
      const map = { neolegacy: 'form.compat', links: 'form.source', screenshots: 'form.shots', key: 'manage.key', folder: 'form.file' };
      const labelKey = map[e.field] || `form.${e.field}`;
      const label = t(labelKey);
      return t('err.invalid_input', { field: label === labelKey ? e.field : label });
    }
    const key = `err.${e.code}`;
    const s = t(key);
    return s === key ? t('err.unknown') : s;
  };

  const checks = (name, items, selected, label = (x) => x) => items.map((x) =>
    `<label><input type="checkbox" name="${name}" value="${esc(x)}"${selected.includes(x) ? ' checked' : ''}> ${esc(label(x))}</label>`).join('');

  const readForm = (form) => {
    const fd = new FormData(form);
    const one = (k) => String(fd.get(k) ?? '').trim();
    return {
      type: one('type') || 'mod', platform: one('platform'), name: one('name'), summary: one('summary'),
      description: String(fd.get('description') ?? '').trim(), author: one('author'), version: one('version'),
      changelog: one('changelog'), source: one('source'), issues: one('issues'), website: one('website'),
      key: one('key'), confirm: fd.get('confirm') === 'on', compat: fd.getAll('compat'), cat: fd.getAll('cat'),
    };
  };

  const applyDraft = (form, d) => {
    if (!d) return;
    form.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'file') return;
      if (el.type === 'checkbox') {
        if (el.name === 'compat') el.checked = (d.compat || []).includes(el.value);
        else if (el.name === 'cat') el.checked = (d.cat || []).includes(el.value);
        else el.checked = !!d[el.name];
      } else if (el.name in d && d[el.name] !== undefined) el.value = d[el.name];
    });
  };

  const limitCategories = (form) => {
    const boxes = [...form.querySelectorAll('input[name="cat"]')];
    const full = boxes.filter((b) => b.checked).length >= 5;
    boxes.forEach((b) => { b.disabled = full && !b.checked; });
  };

  const fileLabel = (f) => (f ? t('form.chosen', { name: f.name }) : '');

  const progressRows = (rows) => `
    <section class="panel block" id="progress" aria-live="polite">
      ${rows.map((r) => `
        <div class="prog-row">
          <label for="pg-${r.id}">${esc(r.label)}</label>
          <progress id="pg-${r.id}" max="1" value="0"></progress>
        </div>`).join('')}
    </section>`;

  const onProgress = (id, frac) => { const el = document.getElementById(`pg-${id}`); if (el) el.value = frac; };

  const showErrors = (list) => {
    const box = document.getElementById('errors');
    if (!box) return;
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<strong>${esc(t('err.title'))}</strong><ul>${list.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
    if (list.length) { box.setAttribute('tabindex', '-1'); box.focus(); box.scrollIntoView({ block: 'center' }); }
  };

  const disabledView = (title) => {
    A.app.innerHTML = `
      <div class="panel empty">
        <h2>${esc(t('upload.disabled.title'))}</h2>
        <p>${esc(t('upload.disabled.text'))}</p>
        <a class="btn" href="#/">${esc(t('detail.nf.back'))}</a>
      </div>`;
    document.title = title;
  };

  /* =====================================================================
     Upload page
     ===================================================================== */
  let draft = null;                       // typed values, survive a language switch
  let files = { icon: null, shots: [], file: null };
  let session = null;                     // upload folder, reused when a retry is needed
  let result = null;                      // { slug, token } after a successful upload
  let busy = false;
  window.addEventListener('hashchange', () => { result = null; });

  const validateUpload = (d) => {
    const { limits } = API;
    const errs = [];
    const req = (v, key) => { if (!v) errs.push(t('val.required', { field: t(key) })); };
    req(d.name.length >= 2, 'form.name');
    req(d.summary.length >= 5, 'form.summary');
    req(d.author, 'form.author');
    if (d.type === 'plugin' && !d.platform) errs.push(t('val.platform'));
    if (!VER_RE.test(d.version)) errs.push(t('val.version'));
    if (!d.compat.length) errs.push(t('val.compat'));

    if (!files.icon) errs.push(t('val.required', { field: t('form.icon') }));
    else if (!IMG_EXT.test(files.icon.name)) errs.push(t('val.image_type', { field: t('form.icon') }));
    else if (files.icon.size > limits.maxImageMB * MB) errs.push(t('val.too_big', { field: t('form.icon'), mb: limits.maxImageMB }));

    if (files.shots.length > limits.maxScreenshots) errs.push(t('val.too_big', { field: t('form.shots'), mb: limits.maxImageMB }));
    files.shots.forEach((f) => {
      if (!IMG_EXT.test(f.name)) errs.push(t('val.image_type', { field: `${t('form.shots')} (${f.name})` }));
      else if (f.size > limits.maxImageMB * MB) errs.push(t('val.too_big', { field: `${t('form.shots')} (${f.name})`, mb: limits.maxImageMB }));
    });

    if (!files.file) errs.push(t('val.required', { field: t('form.file') }));
    else if (!FILE_EXT.test(files.file.name)) errs.push(t('val.file_type', { field: t('form.file') }));
    else if (files.file.size > limits.maxFileMB * MB) errs.push(t('val.too_big', { field: t('form.file'), mb: limits.maxFileMB }));

    if (d.source && !/^https:\/\/\S{3,}$/.test(d.source)) errs.push(t('val.link', { field: t('form.source') }));
    if (d.issues && !/^https:\/\/\S{3,}$/.test(d.issues)) errs.push(t('val.link', { field: t('form.issues') }));
    if (!d.confirm) errs.push(t('val.confirm'));
    return errs;
  };

  const doneView = () => {
    const { slug, token } = result;
    A.app.innerHTML = `
      <div class="panel block done">
        <h1>${esc(t('done.title'))}</h1>
        <p>${esc(t('done.text'))}</p>
        <p><a class="btn primary" href="#/mod/${encodeURIComponent(slug)}">${esc(t('done.view'))}</a></p>
      </div>
      <div class="panel block keybox">
        <h2>${esc(t('done.key.title'))}</h2>
        <p class="warn">${esc(t('done.key.text'))}</p>
        <input type="text" readonly id="keyField" value="${esc(token)}" aria-label="${esc(t('done.key.title'))}" onfocus="this.select()">
        <div class="actions">
          <button class="btn" type="button" id="copyKey">${esc(t('done.key.copy'))}</button>
          <button class="btn" type="button" id="saveKey">${esc(t('done.key.download'))}</button>
          <button class="btn" type="button" id="again">${esc(t('done.another'))}</button>
        </div>
        <p class="status" id="keyStatus" role="status"></p>
      </div>`;

    const status = document.getElementById('keyStatus');
    document.getElementById('copyKey').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(token); status.textContent = t('done.key.copied'); }
      catch { document.getElementById('keyField').select(); }
    });
    document.getElementById('saveKey').addEventListener('click', () => {
      const text = `NeoMods edit key\nProject: ${location.origin}${location.pathname}#/mod/${slug}\nKey: ${token}\n`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = `neomods-key-${slug}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    document.getElementById('again').addEventListener('click', () => {
      result = null; draft = null; files = { icon: null, shots: [], file: null }; session = null;
      views.upload();
    });
  };

  views.upload = () => {
    A.setNav('upload');
    const title = t('title.upload');
    document.title = title;
    if (!API.enabled()) { disabledView(title); return; }
    if (result) { doneView(); return; }

    const { config } = A.state;
    const { limits } = API;
    const d = draft || { type: 'mod', compat: [config.versions[0]], cat: [], version: '1.0.0' };

    A.app.innerHTML = `
      <h1 class="page-title">${esc(t('upload.title'))}</h1>
      <p class="page-lead">${esc(t('upload.lead'))}</p>

      <form class="form panel" id="form" novalidate>
        <fieldset id="lock" class="plain">
          <div class="row">
            <label class="field">${esc(t('form.type'))}
              <select name="type"><option value="mod">${esc(t('badge.mod'))}</option><option value="plugin">${esc(t('badge.plugin'))}</option></select>
            </label>
            <label class="field" id="platWrap" hidden>${esc(t('form.platform'))}
              <select name="platform">
                <option value="">–</option>
                ${config.platforms.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
              </select>
              <span class="hint">${esc(t('form.platform.hint'))}</span>
            </label>
          </div>

          <label class="field">${esc(t('form.name'))}
            <input name="name" required maxlength="60" placeholder="${esc(t('form.name.ph'))}" autocomplete="off">
          </label>
          <label class="field">${esc(t('form.summary'))}
            <input name="summary" required maxlength="140" placeholder="${esc(t('form.summary.ph'))}" autocomplete="off">
          </label>
          <label class="field">${esc(t('form.description'))}
            <textarea name="description" maxlength="8000" placeholder="${esc(t('form.description.ph'))}"></textarea>
          </label>
          <div class="row">
            <label class="field">${esc(t('form.author'))}
              <input name="author" required maxlength="40" autocomplete="nickname">
            </label>
            <label class="field">${esc(t('form.version'))}
              <input name="version" required maxlength="20" autocomplete="off">
            </label>
          </div>

          <fieldset class="plain">
            <legend>${esc(t('form.compat'))}</legend>
            <div class="checks">${checks('compat', config.versions, d.compat || [])}</div>
          </fieldset>
          <fieldset class="plain">
            <legend>${esc(t('form.categories'))} <span class="hint">${esc(t('form.categories.hint'))}</span></legend>
            <div class="checks">${checks('cat', config.categories, d.cat || [], A.catName)}</div>
          </fieldset>

          <div class="field">
            <label for="fIcon">${esc(t('form.icon'))}</label>
            <input type="file" id="fIcon" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif">
            <span class="hint">${esc(t('form.icon.hint', { mb: limits.maxImageMB }))}</span>
            <span class="chosen" id="iconInfo"></span>
          </div>
          <div class="field">
            <label for="fShots">${esc(t('form.shots'))}</label>
            <input type="file" id="fShots" multiple accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif">
            <span class="hint">${esc(t('form.shots.hint', { n: limits.maxScreenshots, mb: limits.maxImageMB }))}</span>
            <span class="chosen" id="shotsInfo"></span>
          </div>
          <div class="field">
            <label for="fFile">${esc(t('form.file'))}</label>
            <input type="file" id="fFile" accept=".zip,.jar,.dll,.7z,.rar">
            <span class="hint">${esc(t('form.file.hint', { mb: limits.maxFileMB }))}</span>
            <span class="chosen" id="fileInfo"></span>
          </div>

          <label class="field">${esc(t('form.changelog'))}
            <input name="changelog" maxlength="300" placeholder="${esc(t('form.changelog.ph'))}" autocomplete="off">
          </label>
          <div class="row">
            <label class="field">${esc(t('form.source'))}
              <input name="source" type="url" placeholder="https://github.com/…" autocomplete="off">
            </label>
            <label class="field">${esc(t('form.issues'))}
              <input name="issues" type="url" placeholder="https://github.com/…/issues" autocomplete="off">
            </label>
          </div>

          <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>

          <label class="confirm"><input type="checkbox" name="confirm"> ${esc(t('form.confirm'))}</label>

          <div class="errors" id="errors" role="alert" hidden></div>
          <button class="btn primary big" type="submit" id="publish">${esc(t('form.publish'))}</button>
        </fieldset>
      </form>
      <div id="progressHost"></div>
    `;

    const form = document.getElementById('form');
    applyDraft(form, d);
    const platWrap = document.getElementById('platWrap');
    const syncType = () => { platWrap.hidden = form.elements.type.value !== 'plugin'; };
    syncType();
    limitCategories(form);

    const showFiles = () => {
      document.getElementById('iconInfo').textContent = fileLabel(files.icon);
      document.getElementById('shotsInfo').textContent = files.shots.map((f) => f.name).join(', ');
      document.getElementById('fileInfo').textContent = fileLabel(files.file);
    };
    showFiles();

    const remember = () => { draft = readForm(form); };
    form.addEventListener('input', () => { remember(); syncType(); });
    form.addEventListener('change', () => { remember(); syncType(); limitCategories(form); });

    document.getElementById('fIcon').addEventListener('change', (e) => { files.icon = e.target.files[0] || null; session = null; showFiles(); });
    document.getElementById('fShots').addEventListener('change', (e) => { files.shots = [...e.target.files].slice(0, 20); session = null; showFiles(); });
    document.getElementById('fFile').addEventListener('change', (e) => { files.file = e.target.files[0] || null; session = null; showFiles(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const v = readForm(form);
      draft = v;
      const problems = validateUpload(v);
      showErrors(problems);
      if (problems.length) return;

      busy = true; lockLanguage(true);
      document.getElementById('lock').disabled = true;
      const btn = document.getElementById('publish');
      btn.textContent = t('form.publishing');

      const rows = [
        { id: 'icon', label: t('progress.icon') },
        ...files.shots.map((_, i) => ({ id: `shot${i + 1}`, label: t('progress.shot', { n: i + 1 }) })),
        { id: 'file', label: t('progress.file') },
        { id: 'save', label: t('progress.save') },
      ];
      document.getElementById('progressHost').innerHTML = progressRows(rows);

      const links = {};
      if (v.source) links.source = v.source;
      if (v.issues) links.issues = v.issues;
      const data = {
        type: v.type, name: v.name, summary: v.summary, description: v.description, author: v.author,
        categories: v.cat, links, version: v.version, neolegacy: v.compat, changelog: v.changelog, website: v.website,
      };
      if (v.type === 'plugin') data.platform = v.platform;

      try {
        session = session || API.newSession();
        const out = await API.publish(session, data, files, onProgress);
        saveKey(out.slug, out.token);
        result = out;
        draft = null; files = { icon: null, shots: [], file: null }; session = null;
        try { await A.reloadCommunity(); } catch { /* the new entry shows up on the next page load */ }
        busy = false; lockLanguage(false);
        doneView();
      } catch (err) {
        busy = false; lockLanguage(false);
        const lockEl = document.getElementById('lock');
        if (lockEl) lockEl.disabled = false;
        btn.textContent = t('form.publish');
        document.getElementById('progressHost').innerHTML = '';
        showErrors([errorText(err)]);
      }
    });
  };

  /* =====================================================================
     Add a new version
     ===================================================================== */
  let mdraft = null;
  let mfile = null;
  let msession = null;
  let mdone = null;
  window.addEventListener('hashchange', () => { mdone = null; });

  views.manage = (slug) => {
    A.setNav('upload');
    const title = t('title.manage');
    document.title = title;
    if (!API.enabled()) { disabledView(title); return; }
    const mod = A.state.mods.find((m) => m.slug === slug && m.source === 'community');
    if (!mod) {
      A.app.innerHTML = `
        <div class="panel empty">
          <h2>${esc(t('detail.nf.title'))}</h2>
          <p>${esc(t('detail.nf.text'))}</p>
          <a class="btn" href="#/">${esc(t('detail.nf.back'))}</a>
        </div>`;
      return;
    }
    if (mdone && mdone.slug === slug) {
      A.app.innerHTML = `
        <div class="panel block done">
          <h1>${esc(t('done.title'))}</h1>
          <p>${esc(t('manage.done', { v: mdone.version }))}</p>
          <p><a class="btn primary" href="#/mod/${encodeURIComponent(slug)}">${esc(t('done.view'))}</a></p>
        </div>`;
      return;
    }

    const { config } = A.state;
    const { limits } = API;
    const d = mdraft && mdraft.slug === slug ? mdraft : {
      slug, key: getKeys()[slug] || '', compat: [config.versions[0]], version: '',
    };

    A.app.innerHTML = `
      <p class="crumb"><a href="#/mod/${encodeURIComponent(slug)}">← ${esc(mod.name)}</a></p>
      <h1 class="page-title">${esc(t('manage.title'))}</h1>
      <p class="page-lead">${esc(t('manage.lead', { name: mod.name }))}</p>

      <form class="form panel" id="form" novalidate>
        <fieldset id="lock" class="plain">
          <label class="field">${esc(t('manage.key'))}
            <input name="key" type="password" required autocomplete="off" spellcheck="false">
          </label>
          <label class="field">${esc(t('form.version'))}
            <input name="version" required maxlength="20" autocomplete="off" placeholder="${esc(mod.versions[0]?.version || '')}">
          </label>
          <fieldset class="plain">
            <legend>${esc(t('form.compat'))}</legend>
            <div class="checks">${checks('compat', config.versions, d.compat || [])}</div>
          </fieldset>
          <div class="field">
            <label for="fFile">${esc(t('form.file'))}</label>
            <input type="file" id="fFile" accept=".zip,.jar,.dll,.7z,.rar">
            <span class="hint">${esc(t('form.file.hint', { mb: limits.maxFileMB }))}</span>
            <span class="chosen" id="fileInfo"></span>
          </div>
          <label class="field">${esc(t('form.changelog'))}
            <input name="changelog" maxlength="300" autocomplete="off">
          </label>
          <div class="errors" id="errors" role="alert" hidden></div>
          <button class="btn primary big" type="submit" id="publish">${esc(t('manage.submit'))}</button>
        </fieldset>
      </form>
      <div id="progressHost"></div>
    `;

    const form = document.getElementById('form');
    applyDraft(form, d);
    const info = document.getElementById('fileInfo');
    info.textContent = fileLabel(mfile);
    const remember = () => { mdraft = { ...readForm(form), slug }; };
    form.addEventListener('input', remember);
    form.addEventListener('change', remember);
    document.getElementById('fFile').addEventListener('change', (e) => { mfile = e.target.files[0] || null; msession = null; info.textContent = fileLabel(mfile); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const v = readForm(form);
      mdraft = { ...v, slug };
      const errs = [];
      if (!v.key) errs.push(t('val.required', { field: t('manage.key') }));
      if (!VER_RE.test(v.version)) errs.push(t('val.version'));
      if (!v.compat.length) errs.push(t('val.compat'));
      if (!mfile) errs.push(t('val.required', { field: t('form.file') }));
      else if (!FILE_EXT.test(mfile.name)) errs.push(t('val.file_type', { field: t('form.file') }));
      else if (mfile.size > limits.maxFileMB * MB) errs.push(t('val.too_big', { field: t('form.file'), mb: limits.maxFileMB }));
      showErrors(errs);
      if (errs.length) return;

      busy = true; lockLanguage(true);
      document.getElementById('lock').disabled = true;
      document.getElementById('publish').textContent = t('form.publishing');
      document.getElementById('progressHost').innerHTML = progressRows([
        { id: 'file', label: t('progress.file') }, { id: 'save', label: t('progress.save') },
      ]);
      try {
        msession = msession || API.newSession();
        await API.publishRelease(msession, slug, v.key, { version: v.version, neolegacy: v.compat, changelog: v.changelog }, mfile, onProgress);
        saveKey(slug, v.key);
        mdone = { slug, version: v.version };
        mdraft = null; mfile = null; msession = null;
        try { await A.reloadCommunity(); } catch { /* shows up on next load */ }
        busy = false; lockLanguage(false);
        views.manage(slug);
      } catch (err) {
        busy = false; lockLanguage(false);
        const lockEl = document.getElementById('lock');
        if (lockEl) lockEl.disabled = false;
        document.getElementById('publish').textContent = t('manage.submit');
        document.getElementById('progressHost').innerHTML = '';
        showErrors([errorText(err)]);
      }
    });
  };
})();
