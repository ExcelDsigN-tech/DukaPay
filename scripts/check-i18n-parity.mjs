import fs from 'fs';
import path from 'path';

const MESSAGES_DIR = path.resolve(process.cwd(), 'frontend/messages');
const BASE_LOCALE = 'en';

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function checkParity(dir, baseLocale) {
  const base = JSON.parse(fs.readFileSync(path.join(dir, `${baseLocale}.json`), 'utf8'));
  const baseKeys = new Set(Object.keys(flatten(base)));
  const locales = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const missing = {};
  for (const locale of locales) {
    if (locale === baseLocale) continue;
    const msgs = JSON.parse(fs.readFileSync(path.join(dir, `${locale}.json`), 'utf8'));
    const keys = new Set(Object.keys(flatten(msgs)));
    const diff = [...baseKeys].filter((k) => !keys.has(k)).sort();
    if (diff.length > 0) missing[locale] = diff;
  }
  return { ok: Object.keys(missing).length === 0, missing };
}

const { ok, missing } = checkParity(MESSAGES_DIR, BASE_LOCALE);
if (!ok) {
  for (const [locale, keys] of Object.entries(missing)) {
    console.error(`Missing ${keys.length} keys in ${locale}.json (vs ${BASE_LOCALE}.json):`);
    for (const k of keys) console.error(`  - ${k}`);
  }
  process.exit(1);
}
console.log('i18n parity OK: all locales match en.json keys.');
