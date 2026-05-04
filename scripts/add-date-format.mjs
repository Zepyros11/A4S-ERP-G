// Adds <script src="<depth>js/core/date-format.js"></script> to pages
// that don't have it yet. Inserts after existing auth.js/authz.js script.
//
// Usage: node scripts/add-date-format.mjs --all  OR  pass file paths

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
if (files[0] === '--all') files = walk(path.join(root, 'modules'));

// Skip standalone / portal / fragment / empty
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

let total = 0, added = 0, alreadyHas = 0, skipped = 0;
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  if (SKIP.has(rel)) { skipped++; continue; }
  if (rel.startsWith('modules/ibd-portal/')) { skipped++; continue; }

  total++;
  const before = fs.readFileSync(f, 'utf8');

  if (/date-format\.js/.test(before)) {
    alreadyHas++;
    continue;
  }

  // Need a reference script to anchor the insertion. Use auth.js loader.
  const authMatch = before.match(/<script\s+src="([^"]*?)js\/core\/auth\.js"><\/script>/);
  if (!authMatch) {
    // Page doesn't have auth.js either — skip and report
    console.log(`  ⚠ ${rel} — no auth.js anchor, skipped`);
    skipped++;
    continue;
  }

  const depth = authMatch[1]; // e.g. "../../"
  const insertion = `<script src="${depth}js/core/date-format.js"></script>\n`;

  // Insert AFTER <script src="...auth.js"></script> (and authz if present)
  const newText = before.replace(
    /(<script\s+src="[^"]*?js\/core\/authz\.js"><\/script>\s*\n)/,
    `$1${insertion}`
  );

  if (newText === before) {
    // No authz — insert after auth.js
    const fallback = before.replace(
      /(<script\s+src="[^"]*?js\/core\/auth\.js"><\/script>\s*\n)/,
      `$1${insertion}`
    );
    if (fallback === before) {
      console.log(`  ⚠ ${rel} — failed to insert`);
      skipped++;
      continue;
    }
    fs.writeFileSync(f, fallback, 'utf8');
  } else {
    fs.writeFileSync(f, newText, 'utf8');
  }
  added++;
  console.log(`  ✓ ${rel}`);
}

console.log(`\nTotal scanned: ${total} | Added: ${added} | Already had: ${alreadyHas} | Skipped: ${skipped}`);
