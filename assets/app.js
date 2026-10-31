(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { config: null, mods: [], filters: { q: '', v: '', t: '', c: '', s: 'new' } };

  /* ---------- Helfer ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Nur http(s)-Links und relative Pfade zulassen (blockt z. B. javascript:)
  const safeUrl = (u) => {
    const s = String(u ?? '').trim();
    if (!s) return '#';
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^https?:\/\//i.test(s) ? s : '#';
    return s;
  };

  const typeLabel = (t) => (t === 'plugin' ? 'Plugin' : 'Mod');

  const fmtDate = (d) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const fetchJson = async (url) => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };

  // Einfache Textdarstellung: Absätze und "- "-Listen
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

  const route = () => {
    const { parts, params } = parseHash();
    if (parts[0] === 'mod' && parts[1]) viewDetail(decodeURIComponent(parts[1]));
    else if (parts[0] === 'einreichen') viewSubmit();
    else viewHome(params);
    if (!(parts.length === 0 && location.hash.includes('?'))) window.scrollTo(0, 0);
  };

  /* ---------- Startseite ---------- */
  const viewHome = (params) => {
    setNav('home');
    document.title = 'NeoMods – Mods und Plugins für NeoLegacy';
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
        <h1>Mods und Plugins für NeoLegacy</h1>
        <p class="lead">Suche nach Mods, filtere nach deiner NeoLegacy-Version und lade sie direkt herunter.</p>
        <div class="search" role="search">
          <input type="search" id="q" placeholder="Mod oder Plugin suchen" aria-label="Mods und Plugins durchsuchen" value="${esc(f.q)}" autocomplete="off">
        </div>
        <p class="slots-label" id="slotsLabel">Deine NeoLegacy-Version</p>
        <div class="slots" role="group" aria-labelledby="slotsLabel" id="slots">
          <button class="slot" type="button" data-v="" aria-pressed="${f.v === ''}">Alle<small>Versionen</small></button>
          ${config.versions.map((v) => `
            <button class="slot" type="button" data-v="${esc(v)}" aria-pressed="${f.v === v}">${esc(v)}<small>${v === latest ? 'neueste' : 'Version'}</small></button>`).join('')}
        </div>
      </section>

      <div class="bar">
        <div class="seg" role="group" aria-label="Typ" id="types">
          <button type="button" data-t="" aria-pressed="${f.t === ''}">Alle</button>
          <button type="button" data-t="mod" aria-pressed="${f.t === 'mod'}">Mods</button>
          <button type="button" data-t="plugin" aria-pressed="${f.t === 'plugin'}">Plugins</button>
        </div>
        <div class="selects">
          <label class="field">Kategorie
            <select id="cat">
              <option value="">Alle Kategorien</option>
              ${config.categories.map((c) => `<option value="${esc(c)}"${f.c === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>
          <label class="field">Sortieren
            <select id="sort">
              <option value="new"${f.s === 'new' ? ' selected' : ''}>Zuletzt aktualisiert</option>
              <option value="name"${f.s === 'name' ? ' selected' : ''}>Name (A–Z)</option>
              <option value="ver"${f.s === 'ver' ? ' selected' : ''}>Neueste Version zuerst</option>
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
    const { q, v, t, c, s } = state.filters;
    const { versions } = state.config;
    const terms = norm(q).split(/\s+/).filter(Boolean);
    let list = state.mods.filter((m) => {
      if (t && m.type !== t) return false;
      if (v && !m.neolegacy.includes(v)) return false;
      if (c && !(m.categories || []).includes(c)) return false;
      if (terms.length) {
        const hay = norm([m.name, m.author, m.summary, (m.categories || []).join(' ')].join(' '));
        if (!terms.every((x) => hay.includes(x))) return false;
      }
      return true;
    });
    const verRank = (m) => {
      const idx = m.neolegacy.map((x) => versions.indexOf(x)).filter((i) => i >= 0);
      return idx.length ? Math.min(...idx) : 999;
    };
    if (s === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    else if (s === 'ver') list.sort((a, b) => verRank(a) - verRank(b) || a.name.localeCompare(b.name, 'de'));
    else list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)) || a.name.localeCompare(b.name, 'de'));
    return list;
  };

  const card = (m) => `
    <a class="card" href="#/mod/${encodeURIComponent(m.slug)}">
      <img class="icon" src="${esc(safeUrl(m.icon))}" alt="" width="64" height="64" loading="lazy">
      <div class="card-body">
        <h3>${esc(m.name)}</h3>
        <p class="by">von ${esc(m.author)}</p>
        <p class="sum">${esc(m.summary)}</p>
        <div class="tags">
          <span class="badge ${esc(m.type)}">${typeLabel(m.type)}</span>
          ${versionTags(m.neolegacy, state.filters.v)}
        </div>
      </div>
    </a>`;

  const renderGrid = () => {
    const grid = document.getElementById('grid');
    const count = document.getElementById('count');
    if (!grid) return;
    const list = filtered();
    count.textContent = list.length === 1 ? '1 Treffer' : `${list.length} Treffer`;
    if (!list.length) {
      grid.innerHTML = `
        <div class="panel empty" style="grid-column:1/-1">
          <h2>Nichts gefunden</h2>
          <p>Probiere einen anderen Suchbegriff, eine andere Version oder entferne die Filter.</p>
          <a class="btn" href="#/einreichen">Eigenen Mod einreichen</a>
        </div>`;
      return;
    }
    grid.innerHTML = list.map(card).join('');
  };

  /* ---------- Detailseite ---------- */
  const viewDetail = (slug) => {
    setNav('home');
    const m = state.mods.find((x) => x.slug === slug);
    if (!m) {
      document.title = 'Nicht gefunden – NeoMods';
      app.innerHTML = `
        <div class="panel empty">
          <h2>Dieser Eintrag existiert nicht</h2>
          <p>Der Mod wurde vielleicht umbenannt oder entfernt.</p>
          <a class="btn" href="#/">Zur Übersicht</a>
        </div>`;
      return;
    }
    document.title = `${m.name} – NeoMods`;
    const latest = m.versions[0];
    const shots = m.screenshots || [];
    const links = m.links || {};
    const linkItems = [
      ['source', 'Quellcode'], ['issues', 'Fehler melden'], ['website', 'Webseite'], ['discord', 'Discord'],
    ].filter(([k]) => links[k]).map(([k, label]) =>
      `<a href="${esc(safeUrl(links[k]))}" target="_blank" rel="noopener noreferrer">${label}</a>`);

    app.innerHTML = `
      <p class="crumb"><a href="#/">← Alle Mods und Plugins</a></p>

      <div class="detail-head">
        <img class="icon" src="${esc(safeUrl(m.icon))}" alt="" width="96" height="96">
        <div>
          <h1>${esc(m.name)}</h1>
          <p class="by">von ${esc(m.author)}</p>
          <p class="sum">${esc(m.summary)}</p>
        </div>
      </div>

      <div class="detail">
        <div>
          ${shots.length ? `
          <section class="block panel" aria-label="Bilder">
            <div class="shots">
              <button class="shot-main" type="button" id="shotMain" aria-label="Bild vergrößern">
                <img src="${esc(safeUrl(shots[0]))}" alt="Screenshot 1 von ${esc(m.name)}">
              </button>
              ${shots.length > 1 ? `<div class="thumbs">${shots.map((s, i) => `
                <button class="thumb" type="button" data-i="${i}" aria-label="Bild ${i + 1} anzeigen" aria-current="${i === 0}">
                  <img src="${esc(safeUrl(s))}" alt="">
                </button>`).join('')}</div>` : ''}
            </div>
          </section>` : ''}

          <section class="block panel">
            <h2>Beschreibung</h2>
            <div class="prose">${prose(m.description || m.summary)}</div>
          </section>

          <section class="block panel">
            <h2>Versionen</h2>
            <div class="versions">
              ${m.versions.map((v) => `
                <article class="ver">
                  <div class="ver-head">
                    <strong>${esc(v.version)}</strong>
                    <a class="btn${v === latest ? ' primary' : ''}" href="${esc(safeUrl(v.file))}" target="_blank" rel="noopener noreferrer">Herunterladen</a>
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
            <a class="btn primary" href="${esc(safeUrl(latest.file))}" target="_blank" rel="noopener noreferrer">Herunterladen · ${esc(latest.version)}</a>
            <p class="side-note">Der Download kommt direkt vom Autor.</p>
          </div>
          <div class="block panel">
            <dl>
              <div><dt>Typ</dt><dd><span class="badge ${esc(m.type)}">${typeLabel(m.type)}</span></dd></div>
              <div><dt>Läuft mit NeoLegacy</dt><dd>${versionTags(m.neolegacy, state.filters.v, 20)}</dd></div>
              ${(m.categories || []).length ? `<div><dt>Kategorien</dt><dd>${m.categories.map((c) => `<span class="vtag">${esc(c)}</span>`).join('')}</dd></div>` : ''}
              <div><dt>Zuletzt aktualisiert</dt><dd>${esc(fmtDate(m.updated))}</dd></div>
              ${linkItems.length ? `<div><dt>Links</dt><dd style="flex-direction:column;gap:.3rem">${linkItems.join('')}</dd></div>` : ''}
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
        img.alt = `Screenshot ${i + 1} von ${m.name}`;
        document.querySelectorAll('.thumb').forEach((t) => t.setAttribute('aria-current', String(Number(t.dataset.i) === i)));
      };
      document.querySelectorAll('.thumb').forEach((t) => t.addEventListener('click', () => show(Number(t.dataset.i))));
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

  /* ---------- Einreichen ---------- */
  const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const viewSubmit = () => {
    setNav('submit');
    document.title = 'Einreichen – NeoMods';
    const { config } = state;
    app.innerHTML = `
      <h1 style="font:700 clamp(1.8rem,4vw,2.6rem)/1.1 var(--font-pixel);margin:0 0 .6rem">Mod oder Plugin einreichen</h1>
      <p class="lead" style="color:var(--muted);max-width:60ch;margin:0 0 2rem">
        Fülle das Formular aus. Du bekommst fertige Daten, die du als GitHub-Issue abschicken kannst.
        Nach einer kurzen Prüfung wird dein Eintrag aufgenommen.
      </p>

      <div class="submit">
        <form class="form panel" id="form" novalidate>
          <div class="row">
            <label class="field">Name
              <input name="name" required maxlength="60" placeholder="z. B. Edelstein-Werkzeuge">
            </label>
            <label class="field">Typ
              <select name="type"><option value="mod">Mod</option><option value="plugin">Plugin</option></select>
            </label>
          </div>
          <label class="field">Kurzbeschreibung (ein Satz)
            <input name="summary" required maxlength="140" placeholder="Was macht dein Mod?">
          </label>
          <label class="field">Beschreibung
            <textarea name="description" placeholder="Was kann dein Mod? So installierst du ihn. Absätze mit Leerzeile, Listen mit „- “."></textarea>
          </label>
          <div class="row">
            <label class="field">Dein Name oder GitHub-Name
              <input name="author" required maxlength="40">
            </label>
            <label class="field">Version deines Mods
              <input name="version" required value="1.0.0" maxlength="20">
            </label>
          </div>
          <fieldset>
            <legend>Läuft mit NeoLegacy</legend>
            <div class="checks">
              ${config.versions.map((v, i) => `<label><input type="checkbox" name="compat" value="${esc(v)}"${i === 0 ? ' checked' : ''}> ${esc(v)}</label>`).join('')}
            </div>
          </fieldset>
          <fieldset>
            <legend>Kategorien</legend>
            <div class="checks">
              ${config.categories.map((c) => `<label><input type="checkbox" name="cat" value="${esc(c)}"> ${esc(c)}</label>`).join('')}
            </div>
          </fieldset>
          <label class="field">Download-Link (Datei oder GitHub-Release)
            <input name="file" type="url" required placeholder="https://github.com/…/releases/download/…">
          </label>
          <div class="row">
            <label class="field">Quellcode (optional)
              <input name="source" type="url" placeholder="https://github.com/…">
            </label>
            <label class="field">Fehler melden (optional)
              <input name="issues" type="url" placeholder="https://github.com/…/issues">
            </label>
          </div>
          <label class="field">Was ist neu in dieser Version?
            <input name="changelog" maxlength="200" placeholder="Erste Version">
          </label>
        </form>

        <div class="out">
          <div class="panel block">
            <h2>Deine Daten</h2>
            <p class="status" id="status" role="status"></p>
            <pre id="json" aria-label="Erzeugte mod.json"></pre>
            <div class="actions">
              <button class="btn" type="button" id="copy">JSON kopieren</button>
              <a class="btn pink" id="issue" href="#" target="_blank" rel="noopener noreferrer">Als GitHub-Issue einreichen</a>
            </div>
            <p class="hint" id="issueHint"></p>
          </div>
          <div class="panel block">
            <h2>So geht es weiter</h2>
            <ol class="steps">
              <li>Klicke auf „Als GitHub-Issue einreichen“. Die Daten sind schon eingetragen.</li>
              <li>Ziehe dein Icon (quadratisch, PNG) und deine Screenshots ins Issue.</li>
              <li>Schicke das Issue ab. Wir prüfen den Eintrag und nehmen ihn auf.</li>
            </ol>
            <p class="hint" style="margin-top:1rem">Du kennst dich mit Git aus? Dann lege einen Ordner <code>mods/dein-name/</code> mit einer <code>mod.json</code> an und öffne einen Pull Request.</p>
          </div>
        </div>
      </div>
    `;

    const form = document.getElementById('form');
    const pre = document.getElementById('json');
    const issue = document.getElementById('issue');
    const hint = document.getElementById('issueHint');
    const status = document.getElementById('status');

    const build = () => {
      const fd = new FormData(form);
      const get = (k) => String(fd.get(k) || '').trim();
      const compat = fd.getAll('compat');
      const links = {};
      if (get('source')) links.source = get('source');
      if (get('issues')) links.issues = get('issues');
      const data = {
        name: get('name') || 'Name deines Mods',
        type: get('type'),
        summary: get('summary'),
        description: get('description'),
        author: get('author'),
        categories: fd.getAll('cat'),
        icon: 'icon.png',
        screenshots: ['screenshot1.png'],
        versions: [{
          version: get('version') || '1.0.0',
          neolegacy: compat,
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
      const slug = slugify(data.name) || 'dein-mod';
      const json = JSON.stringify(data, null, 2);
      pre.textContent = `// Ordner: mods/${slug}/mod.json\n${json}`;

      const body = `Neue Einreichung für NeoMods\n\nOrdnername: \`${slug}\`\n\n\`\`\`json\n${json}\n\`\`\`\n\nIcon und Screenshots hängen unten am Issue.`;
      const url = `https://github.com/${config.repo}/issues/new?title=${encodeURIComponent('Einreichung: ' + data.name)}&body=${encodeURIComponent(body)}`;
      const tooLong = url.length > 7500;
      const noRepo = /DEIN-NAME/.test(config.repo);
      issue.href = tooLong || noRepo ? '#' : url;
      issue.setAttribute('aria-disabled', String(tooLong || noRepo));
      hint.textContent = noRepo
        ? 'Hinweis für den Betreiber: Trage in config.json bei „repo“ dein GitHub-Repository ein.'
        : tooLong ? 'Die Beschreibung ist zu lang für den Direktlink. Kopiere das JSON und füge es in ein neues Issue ein.' : '';
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
        status.textContent = 'Kopiert.';
      } catch {
        const range = document.createRange(); range.selectNodeContents(pre);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        status.textContent = 'Markiert. Drücke Strg+C zum Kopieren.';
      }
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  };

  /* ---------- Start ---------- */
  const init = async () => {
    try {
      const [config, data] = await Promise.all([fetchJson('config.json'), fetchJson('data/mods.json')]);
      state.config = config;
      state.mods = data.mods || [];
      const pl = document.getElementById('projectLink');
      if (pl && config.projectUrl) pl.href = safeUrl(config.projectUrl);
    } catch (err) {
      console.error(err);
      app.innerHTML = `
        <div class="panel empty">
          <h2>Die Daten konnten nicht geladen werden</h2>
          <p>Öffne die Seite über GitHub Pages oder starte lokal einen Server mit <code>python3 -m http.server</code> und rufe <code>http://localhost:8000</code> auf.</p>
        </div>`;
      return;
    }
    window.addEventListener('hashchange', route);
    route();
  };

  // Bilder, die nicht laden, ausblenden statt Platzhalter-Symbol zu zeigen
  app.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
  }, true);

  init();
})();
