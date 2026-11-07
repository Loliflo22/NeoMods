// Talks to the Supabase backend with plain fetch/XHR. No library needed for visitors.
// Everything here is public-safe: it only uses the anon key, which is meant to be public.
(() => {
  'use strict';

  let cfg = { url: '', anonKey: '' };
  let versionOrder = [];
  let limits = { maxFileMB: 50, maxImageMB: 2, maxScreenshots: 6 };

  const init = (config) => {
    cfg = { url: String(config.supabase?.url || '').replace(/\/+$/, ''), anonKey: String(config.supabase?.anonKey || '') };
    versionOrder = config.versions || [];
    limits = { ...limits, ...(config.limits || {}) };
  };

  const enabled = () => /^https:\/\/[\w-]+\.supabase\.co$/.test(cfg.url) && cfg.anonKey.length > 20;
  // Old-style "anon" keys are JWTs and go in both headers. The newer "publishable" keys (sb_publishable_...) are not
  // JWTs and must only be sent as apikey.
  const headers = (extra = {}) => {
    const h = { apikey: cfg.anonKey, ...extra };
    if (cfg.anonKey.startsWith('eyJ')) h.Authorization = `Bearer ${cfg.anonKey}`;
    return h;
  };

  const publicUrl = (path) => `${cfg.url}/storage/v1/object/public/files/${String(path).split('/').map(encodeURIComponent).join('/')}`;

  /* ---------- Errors ---------- */
  // Every failure becomes an Error with a short .code the UI can translate.
  const makeError = (code, field) => Object.assign(new Error(code), { code, field });

  const fromServer = (status, body) => {
    const msg = String((body && (body.message || body.error)) || '');
    if (msg.startsWith('invalid_input:')) return makeError('invalid_input', msg.split(':')[1]);
    for (const c of ['rate_limited', 'file_too_large', 'file_missing', 'bad_key', 'version_exists', 'rejected']) {
      if (msg === c) return makeError(c);
    }
    if (status === 413) return makeError('file_too_large');
    if (status === 401 || status === 403 || /row-level security|not allowed|unauthorized/i.test(msg)) return makeError('upload_denied');
    return makeError('unknown');
  };

  /* ---------- Reading ---------- */
  const SELECT = 'id,slug,name,type,platform,summary,description,author,categories,icon_path,screenshot_paths,links,created_at,updated_at,'
    + 'releases(id,version,neolegacy,file_path,file_name,file_size,changelog,created_at)';

  const byVersionOrder = (a, b) => {
    const ia = versionOrder.indexOf(a), ib = versionOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  };

  const toMod = (p) => {
    const versions = (p.releases || [])
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((r) => ({
        id: r.id,
        version: r.version,
        neolegacy: (r.neolegacy || []).slice().sort(byVersionOrder),
        file: publicUrl(r.file_path),
        date: String(r.created_at).slice(0, 10),
        changelog: r.changelog || '',
        size: r.file_size,
      }));
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      type: p.type,
      platform: p.platform,
      summary: p.summary,
      description: p.description,
      author: p.author,
      categories: p.categories || [],
      icon: publicUrl(p.icon_path),
      screenshots: (p.screenshot_paths || []).map(publicUrl),
      links: p.links || {},
      versions,
      neolegacy: [...new Set(versions.flatMap((v) => v.neolegacy))].sort(byVersionOrder),
      updated: String(p.updated_at).slice(0, 10),
      source: 'community',
    };
  };

  const fetchProjects = async () => {
    let res;
    try {
      res = await fetch(`${cfg.url}/rest/v1/projects?select=${SELECT}&order=updated_at.desc&limit=1000`, { headers: headers(), cache: 'no-cache' });
    } catch { throw makeError('network'); }
    if (!res.ok) throw makeError('unknown');
    const rows = await res.json();
    // A project without any release cannot be shown, so skip it.
    return rows.filter((r) => (r.releases || []).length).map(toMod);
  };

  /* ---------- Writing ---------- */
  const rpc = async (name, args) => {
    let res;
    try {
      res = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(args),
      });
    } catch { throw makeError('network'); }
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw fromServer(res.status, body);
    return body;
  };

  // Uploads one file with progress. XHR is used because fetch cannot report upload progress.
  const upload = (path, file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${cfg.url}/storage/v1/object/files/${path.split('/').map(encodeURIComponent).join('/')}`);
    const h = headers({ 'x-upsert': 'false', 'Content-Type': file.type || 'application/octet-stream', 'cache-control': 'max-age=31536000' });
    Object.entries(h).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(makeError('network'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { if (onProgress) onProgress(1); resolve(); return; }
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      reject(fromServer(xhr.status, body));
    };
    xhr.send(file);
  });

  const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : (() => {
    const b = randomBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  })());
  const newToken = () => 'nm_' + btoa(String.fromCharCode(...randomBytes(24))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const ext = (file) => (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  const safeVersion = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(0, 20) || '0';
  const safeBase = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'file';

  // A submission uploads into its own folder. If something fails halfway, retrying with the same
  // session skips the files that already arrived.
  const newSession = () => ({ folder: uuid(), done: new Set() });

  const uploadAll = async (session, jobs, onProgress) => {
    for (const job of jobs) {
      if (session.done.has(job.name)) { onProgress(job.id, 1); continue; }
      await upload(`uploads/${session.folder}/${job.name}`, job.file, (f) => onProgress(job.id, f));
      session.done.add(job.name);
    }
  };

  // data: { type, platform, name, summary, description, author, categories, links, version, neolegacy, changelog, website }
  // files: { icon: File, shots: File[], file: File }
  const publish = async (session, data, files, onProgress) => {
    const iconName = `icon.${ext(files.icon) === 'jpeg' ? 'jpg' : ext(files.icon)}`;
    const shotNames = files.shots.map((f, i) => `shot-${i + 1}.${ext(f) === 'jpeg' ? 'jpg' : ext(f)}`);
    const fileName = `${safeBase(data.name)}-${safeVersion(data.version)}.${ext(files.file)}`;
    const jobs = [
      { id: 'icon', name: iconName, file: files.icon },
      ...files.shots.map((f, i) => ({ id: `shot${i + 1}`, name: shotNames[i], file: f })),
      { id: 'file', name: fileName, file: files.file },
    ];
    // Ask first, so nobody uploads big files just to be told the limit is reached.
    await rpc('can_publish', { p_kind: 'create' });
    await uploadAll(session, jobs, onProgress);
    const token = session.token || (session.token = newToken());
    onProgress('save', 0);
    const out = await rpc('create_project', {
      p: { ...data, folder: session.folder, icon: iconName, screenshots: shotNames, file: fileName },
      p_token: token,
    });
    onProgress('save', 1);
    return { slug: out.slug, token };
  };

  const publishRelease = async (session, slug, token, data, file, onProgress) => {
    const fileName = `${safeBase(slug)}-${safeVersion(data.version)}.${ext(file)}`;
    // Fail early on a wrong key or a duplicate version, before the big file is sent.
    await rpc('can_publish', { p_kind: 'release' });
    await rpc('check_release_access', { p_slug: slug, p_token: token, p_version: data.version });
    await uploadAll(session, [{ id: 'file', name: fileName, file }], onProgress);
    onProgress('save', 0);
    const out = await rpc('add_release', { p_slug: slug, p_token: token, p: { ...data, folder: session.folder, file: fileName } });
    onProgress('save', 1);
    return out;
  };

  window.NeoApi = {
    init, enabled, publicUrl, fetchProjects, toMod, newSession, publish, publishRelease,
    get limits() { return limits; },
    get config() { return { ...cfg }; },
    SELECT,
  };
})();
