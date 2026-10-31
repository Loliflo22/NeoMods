// Liest alle mods/*/mod.json, prüft sie und schreibt data/mods.json.
// Aufruf: node scripts/build-index.mjs
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsDir = path.join(root, 'mods');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));

const errors = [];
const warnings = [];
const fail = (slug, msg) => errors.push(`mods/${slug}: ${msg}`);
const warn = (slug, msg) => warnings.push(`mods/${slug}: ${msg}`);

const isHttp = (s) => /^https?:\/\/\S+$/i.test(s);
const isSafeRelative = (s) => /^[\w][\w .\-]*$/.test(s) && !s.includes('..');
const MAX_IMAGE = 1024 * 1024; // 1 MB

const mods = [];
const entries = (await readdir(modsDir, { withFileTypes: true })).filter((d) => d.isDirectory());

for (const dir of entries) {
  const slug = dir.name;
  const folder = path.join(modsDir, slug);
  const file = path.join(folder, 'mod.json');

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    fail(slug, 'Ordnername nur mit a-z, 0-9 und Bindestrichen (z. B. mein-mod)');
    continue;
  }
  if (!existsSync(file)) { fail(slug, 'mod.json fehlt'); continue; }

  let m;
  try { m = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { fail(slug, `mod.json ist kein gültiges JSON (${e.message})`); continue; }

  const str = (v, name, { max = 5000, required = true } = {}) => {
    if (typeof v !== 'string' || !v.trim()) { if (required) fail(slug, `"${name}" fehlt`); return ''; }
    if (v.length > max) fail(slug, `"${name}" ist zu lang (max. ${max} Zeichen)`);
    return v.trim();
  };

  const name = str(m.name, 'name', { max: 60 });
  const summary = str(m.summary, 'summary', { max: 140 });
  const author = str(m.author, 'author', { max: 40 });
  const description = str(m.description, 'description', { max: 8000, required: false });
  if (!['mod', 'plugin'].includes(m.type)) fail(slug, '"type" muss "mod" oder "plugin" sein');

  const categories = Array.isArray(m.categories) ? m.categories : [];
  for (const c of categories) {
    if (!config.categories.includes(c)) fail(slug, `Kategorie "${c}" steht nicht in config.json`);
  }

  // Dateien (lokal oder URL) auflösen
  const resolveFile = (value, label, { image = false } = {}) => {
    if (typeof value !== 'string' || !value.trim()) { fail(slug, `${label} fehlt`); return ''; }
    const v = value.trim();
    if (isHttp(v)) return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) { fail(slug, `${label}: nur http(s)-Links erlaubt`); return ''; }
    if (!isSafeRelative(v)) { fail(slug, `${label}: ungültiger Dateiname "${v}"`); return ''; }
    const full = path.join(folder, v);
    if (!existsSync(full)) { fail(slug, `${label}: Datei "${v}" liegt nicht im Ordner`); return ''; }
    return `mods/${slug}/${encodeURI(v)}`;
  };

  const icon = resolveFile(m.icon, 'icon', { image: true });
  const screenshots = (Array.isArray(m.screenshots) ? m.screenshots : [])
    .map((s, i) => resolveFile(s, `screenshots[${i}]`, { image: true })).filter(Boolean);
  if (screenshots.length > 8) warn(slug, 'mehr als 8 Screenshots, nur die ersten 8 werden gezeigt');

  for (const rel of [m.icon, ...(m.screenshots || [])]) {
    if (typeof rel === 'string' && !isHttp(rel) && isSafeRelative(rel) && existsSync(path.join(folder, rel))) {
      const size = (await stat(path.join(folder, rel))).size;
      if (size > MAX_IMAGE) warn(slug, `"${rel}" ist größer als 1 MB, bitte verkleinern`);
    }
  }

  // Versionen
  if (!Array.isArray(m.versions) || !m.versions.length) { fail(slug, '"versions" braucht mindestens einen Eintrag'); continue; }
  const versions = [];
  m.versions.forEach((v, i) => {
    const label = `versions[${i}]`;
    const version = str(v.version, `${label}.version`, { max: 20 });
    const compat = Array.isArray(v.neolegacy) ? v.neolegacy : [];
    if (!compat.length) fail(slug, `${label}.neolegacy braucht mindestens eine NeoLegacy-Version`);
    for (const c of compat) {
      if (!config.versions.includes(c)) fail(slug, `${label}: NeoLegacy-Version "${c}" steht nicht in config.json`);
    }
    const dl = resolveFile(v.file, `${label}.file`);
    const date = typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : '';
    if (!date) fail(slug, `${label}.date muss im Format JJJJ-MM-TT sein`);
    versions.push({
      version,
      neolegacy: [...compat].sort((a, b) => config.versions.indexOf(a) - config.versions.indexOf(b)),
      file: dl,
      date,
      changelog: typeof v.changelog === 'string' ? v.changelog.trim().slice(0, 300) : '',
    });
  });
  // Neueste Version zuerst (nach Datum, bei Gleichstand Reihenfolge in der Datei)
  versions.sort((a, b) => b.date.localeCompare(a.date));

  const links = {};
  for (const k of ['source', 'issues', 'website', 'discord']) {
    const v = m.links?.[k];
    if (v === undefined || v === '') continue;
    if (typeof v === 'string' && isHttp(v)) links[k] = v;
    else fail(slug, `links.${k} muss ein http(s)-Link sein`);
  }

  const neolegacy = [...new Set(versions.flatMap((v) => v.neolegacy))]
    .sort((a, b) => config.versions.indexOf(a) - config.versions.indexOf(b));

  mods.push({
    slug, name, type: m.type, summary, description, author, categories,
    icon, screenshots: screenshots.slice(0, 8), versions, neolegacy, links,
    updated: versions[0].date,
  });
}

const names = new Map();
for (const m of mods) {
  const key = m.name.toLowerCase();
  if (names.has(key)) errors.push(`Der Name "${m.name}" wird in mods/${names.get(key)} und mods/${m.slug} verwendet`);
  names.set(key, m.slug);
}

warnings.forEach((w) => console.warn('Warnung:', w));

if (errors.length) {
  console.error(`\n${errors.length} Fehler gefunden:\n`);
  errors.forEach((e) => console.error('  -', e));
  process.exit(1);
}

mods.sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name, 'de'));
await mkdir(path.join(root, 'data'), { recursive: true });
await writeFile(
  path.join(root, 'data', 'mods.json'),
  JSON.stringify({ generated: new Date().toISOString(), mods }, null, 2) + '\n',
);
console.log(`${mods.length} Einträge nach data/mods.json geschrieben.`);
