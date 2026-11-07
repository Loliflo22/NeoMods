(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { config: null, mods: [], remote: 'off', filters: { q: '', v: '', t: '', p: '', c: '', s: 'new' } };

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

  // Category names are stored in English. Only the display is translated.
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

  const setLang = (code) => {
    if (!I18N.strings[code]) return;
    lang = code;
    try { localStorage.setItem(LANG_KEY, code); } catch { /* ignore */ }
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

  const platformName = (id) => {
    const hit = (state.config?.platforms || []).find((p) => p.id === id);
    if (hit) return hit.name;
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
  };

  const fmtDate = (d) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const fmtSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
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

  const badges = (m) => `<span class="badge ${esc(m.type)}">${esc(typeLabel(m.type))}</span>`
    + (m.type === 'plugin' && m.platform ? `<span class="badge plat">${esc(platformName(m.platform))}</span>` : '');

  /* ---------- Views registry (upload.js and admin.js add their views here) ---------- */
  const views = {};

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
    const first = parts[0];
    const arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    if (first === 'mod' && arg) viewDetail(arg);
    else if ((first === 'upload' || first === 'einreichen') && views.upload) views.upload();
    else if (first === 'manage' && arg && views.manage) views.manage(arg);
    else if (first === 'admin' && views.admin) views.admin();
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
      p: params.get('p') || '',
      c: params.get('c') || '',
      s: params.get('s') || 'new',
    };
    if (f.t === 'mod') f.p = '';
    const latest = config.versions[0];

    app.innerHTML = `
      ${state.remote === 'down' ? `<p class="notice warn-notice" role="status">${esc(t('notice.backend_down'))}</p>` : ''}
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
          <label class="field" id="platField"${f.t === 'mod' ? ' hidden' : ''}>${esc(t('filter.platform'))}
            <select id="plat">
              <option value="">${esc(t('filter.platform.all'))}</option>
              ${config.platforms.map((p) => `<option value="${esc(p.id)}"${f.p === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </label>
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
      if (f.p) p.set('p', f.p);
      if (f.c) p.set('c', f.c);
      if (f.s && f.s !== 'new') p.set('s', f.s);
      const qs = p.toString();
      history.replaceState(null, '', '#/' + (qs ? '?' + qs : ''));
      renderGrid();
    };

    document.getElementById('q').addEventListener('input', (e) => { f.q = e.target.value.trim(); sync(); });
    document.getElementById('cat').addEventListener('change', (e) => { f.c = e.target.value; sync(); });
    document.getElementById('plat').addEventListener('change', (e) => { f.p = e.target.value; sync(); });
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
      if (f.t === 'mod') { f.p = ''; document.getElementById('plat').value = ''; }
      document.getElementById('platField').hidden = f.t === 'mod';
      document.querySelectorAll('#types button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sync();
    });

    renderGrid();
  };

  const filtered = () => {
    const { q, v, t: type, p, c, s } = state.filters;
    const { versions } = state.config;
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const list = state.mods.filter((m) => {
      if (type && m.type !== type) return false;
      if (p && m.platform !== p) return false;
      if (v && !m.neolegacy.includes(v)) return false;
      if (c && !(m.categories || []).includes(c)) return false;
      if (terms.length) {
        const hay = norm([m.name, m.author, m.summary, platformName(m.platform), (m.categories || []).map(catName).join(' ')].join(' '));
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
          ${badges(m)}
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
          <a class="btn" href="#/upload">${esc(t('empty.cta'))}</a>
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
                    <a class="btn${v === latest ? ' primary' : ''}" href="${esc(safeUrl(v.file))}" target="_blank" rel="noopener noreferrer" download>${esc(t('detail.download'))}${v.size ? ` · ${esc(fmtSize(v.size))}` : ''}</a>
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
            <a class="btn primary" href="${esc(safeUrl(latest.file))}" target="_blank" rel="noopener noreferrer" download>${esc(t('detail.download_ver', { v: latest.version }))}</a>
            <p class="side-note">${esc(t('detail.download_note'))}</p>
          </div>
          <div class="block panel">
            <dl>
              <div><dt>${esc(t('detail.type'))}</dt><dd>${badges(m)}</dd></div>
              <div><dt>${esc(t('detail.runs_with'))}</dt><dd>${versionTags(m.neolegacy, state.filters.v, 20)}</dd></div>
              ${(m.categories || []).length ? `<div><dt>${esc(t('detail.categories'))}</dt><dd>${m.categories.map((c) => `<span class="vtag">${esc(catName(c))}</span>`).join('')}</dd></div>` : ''}
              <div><dt>${esc(t('detail.updated'))}</dt><dd>${esc(fmtDate(m.updated))}</dd></div>
              ${linkItems.length ? `<div><dt>${esc(t('detail.links'))}</dt><dd style="flex-direction:column;gap:.3rem">${linkItems.join('')}</dd></div>` : ''}
            </dl>
          </div>
          ${m.source === 'community' ? `<p class="side-note"><a href="#/manage/${encodeURIComponent(m.slug)}">${esc(t('manage.link'))}</a></p>` : ''}
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

  /* ---------- Start ---------- */
  const loadAll = async () => {
    const [config, staticData] = await Promise.all([
      fetchJson('config.json'),
      fetchJson('data/mods.json').catch(() => ({ mods: [] })),
    ]);
    state.config = config;
    window.NeoApi.init(config);

    let community = [];
    if (window.NeoApi.enabled()) {
      try { community = await window.NeoApi.fetchProjects(); state.remote = 'ok'; }
      catch (err) { console.warn('Community uploads unavailable:', err.code || err); state.remote = 'down'; }
    }

    // Built-in entries get platform defaults so filters work for them too.
    const builtIn = (staticData.mods || []).map((m) => ({
      platform: m.type === 'plugin' ? 'other' : 'neolegacy', ...m, source: 'static',
    }));
    const seen = new Set();
    state.mods = [...community, ...builtIn].filter((m) => (seen.has(m.slug) ? false : (seen.add(m.slug), true)));

    const pl = document.getElementById('projectLink');
    if (pl && config.projectUrl) pl.href = safeUrl(config.projectUrl);
    const ow = document.getElementById('ownerLink');
    if (ow && config.owner) {
      ow.textContent = config.owner.name || ow.textContent;
      ow.href = safeUrl(config.owner.url || ow.href);
    }
  };

  const init = async () => {
    setupLangSelect();
    applyStatic();
    try {
      await loadAll();
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

  // The helpers other scripts (upload.js, admin.js) need.
  window.NeoApp = {
    app, state, views, I18N, t, esc, safeUrl, catName, platformName, typeLabel, fmtDate, fmtSize, norm, prose,
    setNav, route, openLightbox, badges, versionTags,
    get lang() { return lang; },
    reloadCommunity: async () => {
      if (!window.NeoApi.enabled()) return;
      const community = await window.NeoApi.fetchProjects();
      const builtIn = state.mods.filter((m) => m.source === 'static');
      state.mods = [...community, ...builtIn];
      state.remote = 'ok';
    },
  };

  // Wait until every script (including upload.js and admin.js) has registered its view.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
