// Bulk rename module-specific hero classes to shared `page-hero*`
// SAFE: splits class="..." into individual tokens and matches whole-class only.
// Compound classes like `ds-hero-cell`, `ds-hero-grid` are left untouched.
//
// Whole-class matches replaced:
//   <prefix>-hero            → page-hero
//   <prefix>-hero-title      → page-hero-title
//   <prefix>-hero-subtitle   → page-hero-sub
//   <prefix>-hero-sub        → page-hero-sub
//   <prefix>-hero-actions    → page-hero-actions
//   <prefix>-hero-right      → page-hero-actions
//   <prefix>-hero-eyebrow    → page-hero-sub
//   page-header              → page-hero
//   page-title               → page-hero-title  (when standalone class)
//
// Usage: node scripts/rename-hero-classes.mjs <files...>  OR  --all

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.toLowerCase().endsWith('.html')) out.push(full);
  }
  return out;
}

let files = process.argv.slice(2);
if (files[0] === '--all') {
  files = walk(path.join(root, 'modules'));
}

const SKIP = new Set([
  'modules/event/register.html',
  'modules/event/check-in.html',
  'modules/event/cs-view/events-bookingRoom.html',
  'modules/event/cs-view/events-calendar.html',
  'modules/event/cs-view/event-poster-gallery-view.html',
  'modules/tour/check-seat.html',
  'modules/trip/check-seat.html',
  'modules/inventory/categories-form.html',
  'modules/inventory/warehouses-form.html',
]);

function renameClass(c) {
  if (/^[a-z]{1,6}-hero$/.test(c)) return 'page-hero';
  if (/^[a-z]{1,6}-hero-title$/.test(c)) return 'page-hero-title';
  if (/^[a-z]{1,6}-hero-(subtitle|sub)$/.test(c)) return 'page-hero-sub';
  if (/^[a-z]{1,6}-hero-(actions|right)$/.test(c)) return 'page-hero-actions';
  if (/^[a-z]{1,6}-hero-eyebrow$/.test(c)) return 'page-hero-sub';
  if (c === 'page-header') return 'page-hero';
  if (c === 'page-title') return 'page-hero-title';
  return c;
}

let total = 0, changed = 0, sample = [];
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  if (SKIP.has(rel)) continue;
  total++;
  const before = fs.readFileSync(f, 'utf8');
  const txt = before.replace(/class="([^"]*)"/g, (m, classes) => {
    const tokens = classes.split(/\s+/).filter(Boolean);
    const newTokens = tokens.map(renameClass);
    const newClasses = newTokens.join(' ');
    return `class="${newClasses}"`;
  });
  if (txt !== before) {
    fs.writeFileSync(f, txt, 'utf8');
    changed++;
    if (sample.length < 5) sample.push(rel);
    console.log(`  ✓ ${rel}`);
  }
}
console.log(`\nTotal scanned: ${total} | Changed: ${changed}`);
