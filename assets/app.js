(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { config: null, mods: [], filters: { q: '', v: '', t: '', c: '', s: 'new' } };

  /* ---------- Language ---------- */
  const I18N = window.NEOMODS_I18N;
  if (!I18N) {
    app.innerHTML = '<p class="notice">assets/i18n.js is missing or outdated. Upload all files from the ZIP, including the assets folder, then reload with Ctrl+Shift+R.</p>';
    return;
  }
  const LANG_KEY = 'neomods-lang';
  let lang = I18N.defaultLang; // English unless the visitor picked another language

  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && I18N.strings[saved]) lang = saved;
  } catch { /* storage can be blocked, English stays */ }

  const t = (key, vars) => {
    let s = (I18N.strings[lang] || {})[key];
    if (typeof s !== 'string') s = I18N.strings[I18N.defaultLang][key];
    if (typeof s !== 'string') s = key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : '')) : s;
  };

  // Category names are stored in English in mod.json. Only the display is translated.
  const catName = (c) => (I18N.strings[lang].cats || {})[c] || I18N.strings[I18N.defaultLang].cats[c] || c;

  const applyStatic = () => {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    const noscript = document.querySelector('noscript');
    if (noscript) noscript.textContent = t('noscript');
  };

  const setupLangSelect = () => {
    const sel = document.getElementById('langSelect');
    sel.innerHTML = I18N.languages.map((l) => `<option value="${l.code}" lang="${l.code}">${l.name}</option>`).join('');
    sel.value = lang;
    sel.addEventListener('change', () => setLang(sel.value));
  };

  let draft = null; // keeps typed form values when the language changes
  const snapshotForm = () => {
    draft = null;
    const f = document.getElementById('form');
    if (!f) return;
    draft = {};
    f.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'checkbox') {
        draft[el.name] = draft[el.name] || [];
        if (el.checked) draft[el.name].push(el.value);
      } else draft[el.name] = el.value;
    });
  };
  const restoreForm = (f) => {
    if (!draft) return;
    f.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'checkbox') el.checked = (draft[el.name] || []).includes(el.value);
      else if (el.name in draft) el.value = draft[el.name];
    });
    draft = null;
  };

  const setLang = (code) => {
    if (!I18N.strings[code]) return;
    lang = code;
    try { localStorage.setItem(LANG_KEY, code); } catch { /* ignore */ }
    snapshotForm();
    applyStatic();
    if (state.config) route(true);
  };

  /* ---------- Helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Only allow http(s) links and relative paths (blocks e.g. javascript:)
  const safeUrl = (u) => {
    const s = String(u ?? '').trim();
    if (!s) return '#';
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^https?:\/\//i.test(s) ? s : '#';
    return s;
  };

  const typeLabel = (type) => t(type === 'plugin' ? 'badge.plugin' : 'badge.mod');

  const fmtDate = (d) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const fetchJson = async (url) => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };

  // Simple text rendering: paragraphs and "- " lists
  const prose = (text) => {
    const blocks = String(text ?? '').replace(/\r/g, '').split(/\n{2,}/);
    return blocks.map((b) => {
      const lines = b.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return '';
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(esc).join('<br>')}</p>`;
    }).join('');
  };

  const versionTags = (list, hit, max = 4) => {
    const shown = list.slice(0, max);
    const more = list.length - shown.length;
    return shown.map((v) => `<span class="vtag${v === hit ? ' hit' : ''}">${esc(v)}</span>`).join('')
      + (more > 0 ? `<span class="vtag">+${more}</span>` : '');
  };

  /* ---------- Routing ---------- */
  const parseHash = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
  };

  const setNav = (name) => {
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };

  const route = (keepScroll = false) => {
    const { parts, params } = parseHash();
    if (parts[0] === 'mod' && parts[1]) viewDetail(decodeURIComponent(parts[1]));
    else if (parts[0] === 'einreichen') viewSubmit();
    else viewHome(params);
    if (!keepScroll && !(parts.length === 0 && location.hash.includes('?'))) window.scrollTo(0, 0);
  };

  /* ---------- Home ---------- */
  const viewHome = (params) => {
    setNav('home');
    document.title = t('title.home');
    const { config } = state;
    const f = state.filters = {
      q: params.get('q') || '',
      v: params.get('v') || '',
      t: params.get('t') || '',
      c: params.get('c') || '',
      s: params.get('s') || 'new',
    };
    const latest = config.versions[0];

    app.innerHTML = `
      <section class="hero">
        <h1>${esc(t('hero.h1'))}</h1>
        <p class="lead">${esc(t('hero.lead'))}</p>
        <div class="search" role="search">
          <input type="search" id="q" placeholder="${esc(t('search.placeholder'))}" aria-label="${esc(t('search.aria'))}" value="${esc(f.q)}" autocomplete="off">
        </div>
        <p class="slots-label" id="slotsLabel">${esc(t('version.label'))}</p>
        <div class="slots" role="group" aria-labelledby="slotsLabel" id="slots">
          <button class="slot" type="button" data-v="" aria-pressed="${f.v === ''}">${esc(t('version.all'))}<small>${esc(t('version.all.sub'))}</small></button>
          ${config.versions.map((v) => `
            <button class="slot" type="button" data-v="${esc(v)}" aria-pressed="${f.v === v}">${esc(v)}<small>${esc(t(v === latest ? 'version.latest' : 'version.plain'))}</small></button>`).join('')}
        </div>
      </section>

      <div class="bar">
        <div class="seg" role="group" aria-label="${esc(t('type.aria'))}" id="types">
          <button type="button" data-t="" aria-pressed="${f.t === ''}">${esc(t('type.all'))}</button>
          <button type="button" data-t="mod" aria-pressed="${f.t === 'mod'}">${esc(t('type.mods'))}</button>
          <button type="button" data-t="plugin" aria-pressed="${f.t === 'plugin'}">${esc(t('type.plugins'))}</button>
        </div>
        <div class="selects">
          <label class="field">${esc(t('cat.label'))}
            <select id="cat">
              <option value="">${esc(t('cat.all'))}</option>
              ${config.categories.map((c) => `<option value="${esc(c)}"${f.c === c ? ' selected' : ''}>${esc(catName(c))}</option>`).join('')}
            </select>
          </label>
          <label class="field">${esc(t('sort.label'))}
            <select id="sort">
              <option value="new"${f.s === 'new' ? ' selected' : ''}>${esc(t('sort.new'))}</option>
              <option value="name"${f.s === 'name' ? ' selected' : ''}>${esc(t('sort.name'))}</option>
              <option value="ver"${f.s === 'ver' ? ' selected' : ''}>${esc(t('sort.ver'))}</option>
            </select>
          </label>
        </div>
      </div>

      <p class="count" id="count" aria-live="polite"></p>
      <div class="grid" id="grid"></div>
    `;

    const sync = () => {
      const p = new URLSearchParams();
      if (f.q) p.set('q', f.q);
      if (f.v) p.set('v', f.v);
      if (f.t) p.set('t', f.t);
      if (f.c) p.set('c', f.c);
      if (f.s && f.s !== 'new') p.set('s', f.s);
      const qs = p.toString();
      history.replaceState(null, '', '#/' + (qs ? '?' + qs : ''));
      renderGrid();
    };

    document.getElementById('q').addEventListener('input', (e) => { f.q = e.target.value.trim(); sync(); });
    document.getElementById('cat').addEventListener('change', (e) => { f.c = e.target.value; sync(); });
    document.getElementById('sort').addEventListener('change', (e) => { f.s = e.target.value; sync(); });
    document.getElementById('slots').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      f.v = b.dataset.v;
      document.querySelectorAll('#slots .slot').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sync();
    });
    document.getElementById('types').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      f.t = b.dataset.t;
      document.querySelectorAll('#types button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sync();
    });

    renderGrid();
  };

  const filtered = () => {
    const { q, v, t: type, c, s } = state.filters;
    const { versions } = state.config;
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const list = state.mods.filter((m) => {
      if (type && m.type !== type) return false;
      if (v && !m.neolegacy.includes(v)) return false;
      if (c && !(m.categories || []).includes(c)) return false;
      if (terms.length) {
        const hay = norm([m.name, m.author, m.summary, (m.categories || []).map(catName).join(' ')].join(' '));
        if (!terms.every((x) => hay.includes(x))) return false;
      }
      return true;
    });
    const verRank = (m) => {
      const idx = m.neolegacy.map((x) => versions.indexOf(x)).filter((i) => i >= 0);
      return idx.length ? Math.min(...idx) : 999;
    };
    const byName = (a, b) => a.name.localeCompare(b.name, lang);
    if (s === 'name') list.sort(byName);
    else if (s === 'ver') list.sort((a, b) => verRank(a) - verRank(b) || byName(a, b));
    else list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)) || byName(a, b));
    return list;
  };

  const card = (m) => `
    <a class="card" href="#/mod/${encodeURIComponent(m.slug)}">
      <img class="icon" src="${esc(safeUrl(m.icon))}" alt="" width="64" height="64" loading="lazy">
      <div class="card-body">
        <h3>${esc(m.name)}</h3>
        <p class="by">${esc(t('by', { author: m.author }))}</p>
        <p class="sum">${esc(m.summary)}</p>
        <div class="tags">
          <span class="badge ${esc(m.type)}">${esc(typeLabel(m.type))}</span>
          ${versionTags(m.neolegacy, state.filters.v)}
        </div>
      </div>
    </a>`;

  const renderGrid = () => {
    const grid = document.getElementById('grid');
    const count = document.getElementById('count');
    if (!grid) return;
    const list = filtered();
    count.textContent = list.length === 1 ? t('count.one') : t('count.many', { n: list.length });
    if (!list.length) {
      grid.innerHTML = `
        <div class="panel empty" style="grid-column:1/-1">
          <h2>${esc(t('empty.title'))}</h2>
          <p>${esc(t('empty.text'))}</p>
          <a class="btn" href="#/einreichen">${esc(t('empty.cta'))}</a>
        </div>`;
      return;
    }
    grid.innerHTML = list.map(card).join('');
  };

  /* ---------- Detail page ---------- */
  const viewDetail = (slug) => {
    setNav('home');
    const m = state.mods.find((x) => x.slug === slug);
    if (!m) {
      document.title = t('title.notfound');
      app.innerHTML = `
        <div class="panel empty">
          <h2>${esc(t('detail.nf.title'))}</h2>
          <p>${esc(t('detail.nf.text'))}</p>
          <a class="btn" href="#/">${esc(t('detail.nf.back'))}</a>
        </div>`;
      return;
    }
    document.title = `${m.name} – NeoMods`;
    const latest = m.versions[0];
    const shots = m.screenshots || [];
    const links = m.links || {};
    const linkItems = ['source', 'issues', 'website', 'discord'].filter((k) => links[k]).map((k) =>
      `<a href="${esc(safeUrl(links[k]))}" target="_blank" rel="noopener noreferrer">${esc(t('link.' + k))}</a>`);

    app.innerHTML = `
      <p class="crumb"><a href="#/">${esc(t('detail.back'))}</a></p>

      <div class="detail-head">
        <img class="icon" src="${esc(safeUrl(m.icon))}" alt="" width="96" height="96">
        <div>
          <h1>${esc(m.name)}</h1>
          <p class="by">${esc(t('by', { author: m.author }))}</p>
          <p class="sum">${esc(m.summary)}</p>
        </div>
      </div>

      <div class="detail">
        <div>
          ${shots.length ? `
          <section class="block panel" aria-label="${esc(t('detail.images'))}">
            <div class="shots">
              <button class="shot-main" type="button" id="shotMain" aria-label="${esc(t('detail.enlarge'))}">
                <img src="${esc(safeUrl(shots[0]))}" alt="${esc(t('detail.shot_alt', { n: 1, name: m.name }))}">
              </button>
              ${shots.length > 1 ? `<div class="thumbs">${shots.map((s, i) => `
                <button class="thumb" type="button" data-i="${i}" aria-label="${esc(t('detail.show_image', { n: i + 1 }))}" aria-current="${i === 0}">
                  <img src="${esc(safeUrl(s))}" alt="">
                </button>`).join('')}</div>` : ''}
            </div>
          </section>` : ''}

          <section class="block panel">
            <h2>${esc(t('detail.description'))}</h2>
            <div class="prose">${prose(m.description || m.summary)}</div>
          </section>

          <section class="block panel">
            <h2>${esc(t('detail.versions'))}</h2>
            <div class="versions">
              ${m.versions.map((v) => `
                <article class="ver">
                  <div class="ver-head">
                    <strong>${esc(v.version)}</strong>
                    <a class="btn${v === latest ? ' primary' : ''}" href="${esc(safeUrl(v.file))}" target="_blank" rel="noopener noreferrer">${esc(t('detail.download'))}</a>
                  </div>
                  <p class="ver-meta">${v.date ? esc(fmtDate(v.date)) : ''}</p>
                  <div class="tags">${versionTags(v.neolegacy, state.filters.v, 20)}</div>
                  ${v.changelog ? `<p>${esc(v.changelog)}</p>` : ''}
                </article>`).join('')}
            </div>
          </section>
        </div>

        <aside class="side">
          <div class="block panel">
            <a class="btn primary" href="${esc(safeUrl(latest.file))}" target="_blank" rel="noopener noreferrer">${esc(t('detail.download_ver', { v: latest.version }))}</a>
            <p class="side-note">${esc(t('detail.download_note'))}</p>
          </div>
          <div class="block panel">
            <dl>
              <div><dt>${esc(t('detail.type'))}</dt><dd><span class="badge ${esc(m.type)}">${esc(typeLabel(m.type))}</span></dd></div>
              <div><dt>${esc(t('detail.runs_with'))}</dt><dd>${versionTags(m.neolegacy, state.filters.v, 20)}</dd></div>
              ${(m.categories || []).length ? `<div><dt>${esc(t('detail.categories'))}</dt><dd>${m.categories.map((c) => `<span class="vtag">${esc(catName(c))}</span>`).join('')}</dd></div>` : ''}
              <div><dt>${esc(t('detail.updated'))}</dt><dd>${esc(fmtDate(m.updated))}</dd></div>
              ${linkItems.length ? `<div><dt>${esc(t('detail.links'))}</dt><dd style="flex-direction:column;gap:.3rem">${linkItems.join('')}</dd></div>` : ''}
            </dl>
          </div>
        </aside>
      </div>
    `;

    if (shots.length) {
      const main = document.getElementById('shotMain');
      const img = main.querySelector('img');
      let cur = 0;
      const show = (i) => {
        cur = i;
        img.src = safeUrl(shots[i]);
        img.alt = t('detail.shot_alt', { n: i + 1, name: m.name });
        document.querySelectorAll('.thumb').forEach((th) => th.setAttribute('aria-current', String(Number(th.dataset.i) === i)));
      };
      document.querySelectorAll('.thumb').forEach((th) => th.addEventListener('click', () => show(Number(th.dataset.i))));
      main.addEventListener('click', () => openLightbox(shots[cur], img.alt));
    }
  };

  /* ---------- Lightbox ---------- */
  const lb = document.getElementById('lightbox');
  const openLightbox = (src, alt) => {
    const img = lb.querySelector('img');
    img.src = safeUrl(src); img.alt = alt || '';
    if (typeof lb.showModal === 'function') lb.showModal(); else window.open(safeUrl(src), '_blank', 'noopener');
  };
  lb.querySelector('.lb-close').addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });

  /* ---------- Submit ---------- */
  const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const viewSubmit = () => {
    setNav('submit');
    document.title = t('title.submit');
    const { config } = state;
    app.innerHTML = `
      <h1 style="font:700 clamp(1.8rem,4vw,2.6rem)/1.1 var(--font-pixel);margin:0 0 .6rem">${esc(t('submit.title'))}</h1>
      <p class="lead" style="color:var(--muted);max-width:60ch;margin:0 0 2rem">${esc(t('submit.lead'))}</p>

      <div class="submit">
        <form class="form panel" id="form" novalidate>
          <div class="row">
            <label class="field">${esc(t('form.name'))}
              <input name="name" required maxlength="60" placeholder="${esc(t('form.name.ph'))}">
            </label>
            <label class="field">${esc(t('form.type'))}
              <select name="type"><option value="mod">${esc(t('badge.mod'))}</option><option value="plugin">${esc(t('badge.plugin'))}</option></select>
            </label>
          </div>
          <label class="field">${esc(t('form.summary'))}
            <input name="summary" required maxlength="140" placeholder="${esc(t('form.summary.ph'))}">
          </label>
          <label class="field">${esc(t('form.description'))}
            <textarea name="description" placeholder="${esc(t('form.description.ph'))}"></textarea>
          </label>
          <div class="row">
            <label class="field">${esc(t('form.author'))}
              <input name="author" required maxlength="40">
            </label>
            <label class="field">${esc(t('form.version'))}
              <input name="version" required value="1.0.0" maxlength="20">
            </label>
          </div>
          <fieldset>
            <legend>${esc(t('form.compat'))}</legend>
            <div class="checks">
              ${config.versions.map((v, i) => `<label><input type="checkbox" name="compat" value="${esc(v)}"${i === 0 ? ' checked' : ''}> ${esc(v)}</label>`).join('')}
            </div>
          </fieldset>
          <fieldset>
            <legend>${esc(t('form.categories'))}</legend>
            <div class="checks">
              ${config.categories.map((c) => `<label><input type="checkbox" name="cat" value="${esc(c)}"> ${esc(catName(c))}</label>`).join('')}
            </div>
          </fieldset>
          <label class="field">${esc(t('form.file'))}
            <input name="file" type="url" required placeholder="https://github.com/…/releases/download/…">
          </label>
          <div class="row">
            <label class="field">${esc(t('form.source'))}
              <input name="source" type="url" placeholder="https://github.com/…">
            </label>
            <label class="field">${esc(t('form.issues'))}
              <input name="issues" type="url" placeholder="https://github.com/…/issues">
            </label>
          </div>
          <label class="field">${esc(t('form.changelog'))}
            <input name="changelog" maxlength="200" placeholder="${esc(t('form.changelog.ph'))}">
          </label>
        </form>

        <div class="out">
          <div class="panel block">
            <h2>${esc(t('out.title'))}</h2>
            <p class="status" id="status" role="status"></p>
            <pre id="json" aria-label="${esc(t('out.json.aria'))}"></pre>
            <div class="actions">
              <button class="btn" type="button" id="copy">${esc(t('out.copy'))}</button>
              <a class="btn pink" id="issue" href="#" target="_blank" rel="noopener noreferrer">${esc(t('out.issue'))}</a>
            </div>
            <p class="hint" id="issueHint"></p>
          </div>
          <div class="panel block">
            <h2>${esc(t('next.title'))}</h2>
            <ol class="steps">
              <li>${esc(t('next.1'))}</li>
              <li>${esc(t('next.2'))}</li>
              <li>${esc(t('next.3'))}</li>
            </ol>
            <p class="hint" style="margin-top:1rem">${esc(t('next.git'))}</p>
          </div>
        </div>
      </div>
    `;

    const form = document.getElementById('form');
    const pre = document.getElementById('json');
    const issue = document.getElementById('issue');
    const hint = document.getElementById('issueHint');
    const status = document.getElementById('status');

    restoreForm(form);

    const build = () => {
      const fd = new FormData(form);
      const get = (k) => String(fd.get(k) || '').trim();
      const links = {};
      if (get('source')) links.source = get('source');
      if (get('issues')) links.issues = get('issues');
      const data = {
        name: get('name') || 'Name of your mod',
        type: get('type'),
        summary: get('summary'),
        description: get('description'),
        author: get('author'),
        categories: fd.getAll('cat'),
        icon: 'icon.png',
        screenshots: ['screenshot1.png'],
        versions: [{
          version: get('version') || '1.0.0',
          neolegacy: fd.getAll('compat'),
          file: get('file'),
          date: new Date().toISOString().slice(0, 10),
          changelog: get('changelog'),
        }],
      };
      if (Object.keys(links).length) data.links = links;
      return data;
    };

    const update = () => {
      const data = build();
      const slug = slugify(data.name) || 'your-mod';
      const json = JSON.stringify(data, null, 2);
      pre.textContent = `// Folder: mods/${slug}/mod.json\n${json}`;

      // The issue text is for the site owner, so it is always in English.
      const body = `New submission for NeoMods\n\nFolder name: \`${slug}\`\n\n\`\`\`json\n${json}\n\`\`\`\n\nIcon and screenshots are attached below.`;
      const url = `https://github.com/${config.repo}/issues/new?title=${encodeURIComponent('Submission: ' + data.name)}&body=${encodeURIComponent(body)}`;
      const tooLong = url.length > 7500;
      const noRepo = /YOUR-NAME/.test(config.repo);
      issue.href = tooLong || noRepo ? '#' : url;
      issue.setAttribute('aria-disabled', String(tooLong || noRepo));
      hint.textContent = noRepo ? t('out.hint.norepo') : tooLong ? t('out.hint.toolong') : '';
      hint.className = 'hint' + (noRepo || tooLong ? ' warn' : '');
      return { data, slug, json };
    };

    form.addEventListener('input', update);
    form.addEventListener('submit', (e) => e.preventDefault());
    update();

    document.getElementById('copy').addEventListener('click', async () => {
      const { json } = update();
      try {
        await navigator.clipboard.writeText(json);
        status.textContent = t('out.copied');
      } catch {
        const range = document.createRange(); range.selectNodeContents(pre);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        status.textContent = t('out.selected');
      }
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  };

  /* ---------- Start ---------- */
  const init = async () => {
    setupLangSelect();
    applyStatic();
    try {
      const [config, data] = await Promise.all([fetchJson('config.json'), fetchJson('data/mods.json')]);
      state.config = config;
      state.mods = data.mods || [];
      const pl = document.getElementById('projectLink');
      if (pl && config.projectUrl) pl.href = safeUrl(config.projectUrl);
      const ow = document.getElementById('ownerLink');
      if (ow && config.owner) {
        ow.textContent = config.owner.name || ow.textContent;
        ow.href = safeUrl(config.owner.url || ow.href);
      }
    } catch (err) {
      console.error(err);
      app.innerHTML = `
        <div class="panel empty">
          <h2>${esc(t('error.title'))}</h2>
          <p>${esc(t('error.text'))}</p>
        </div>`;
      return;
    }
    window.addEventListener('hashchange', () => route());
    route();
  };

  // Hide images that fail to load instead of showing a broken-image icon
  app.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
  }, true);

  init();
})();
