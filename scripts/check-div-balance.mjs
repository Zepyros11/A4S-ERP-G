#!/usr/bin/env node
// Check all HTML files in modules/ for unbalanced <div> tags.
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const root = path.resolve('modules');
const files = walk(root, '.html');
let bad = 0;

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const opens  = (cleaned.match(/<div\b/g) || []).length;
  const closes = (cleaned.match(/<\/div>/g) || []).length;
  const diff = opens - closes;
  if (diff !== 0) {
    bad++;
    const rel = path.relative(path.resolve('.'), f).replace(/\\/g, '/');
    console.log(`⚠️   diff=${String(diff).padStart(3)}  ${rel}`);
  }
}
console.log('\n' + (bad === 0 ? `✅ All ${files.length} files balanced` : `⚠️  ${bad} / ${files.length} files unbalanced`));
