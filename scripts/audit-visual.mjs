// Visual component drift audit — counts per-module variants of common UI patterns
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'audit');

function walk(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some(e => name.toLowerCase().endsWith(e))) out.push(full);
  }
  return out;
}

const htmlFiles = walk(path.join(root, 'modules'), ['.html']);
const cssFiles  = walk(path.join(root, 'modules'), ['.css'])
  .concat(walk(path.join(root, 'css'), ['.css']));

// Visual concepts we want to track. Each has a regex against class names.
const concepts = [
  { name: 'hero / page header banner',  re: /\b([a-z]+)-hero\b/g },
  { name: 'stats row / kpi card',       re: /\b([a-z]+)-(stats|kpi|metric)\b/g },
  { name: 'page card / panel',          re: /\b([a-z]+)-card\b/g },
  { name: 'filter bar / toolbar',       re: /\b([a-z]+)-(toolbar|filter-bar|filterbar)\b/g },
  { name: 'empty state',                re: /\b([a-z]+)-(empty|empty-state)\b/g },
  { name: 'page title',                 re: /\b([a-z]+)-(page-title|hdr-title|page-hdr)\b/g },
];

const conceptHits = concepts.map(c => ({ ...c, prefixes: new Map() }));

function collect(text) {
  for (const c of conceptHits) {
    c.re.lastIndex = 0;
    let m;
    while ((m = c.re.exec(text)) !== null) {
      const prefix = m[1];
      const full = m[0];
      const entry = c.prefixes.get(prefix) || { full: new Set(), count: 0 };
      entry.full.add(full);
      entry.count += 1;
      c.prefixes.set(prefix, entry);
    }
  }
}

for (const fp of [...htmlFiles, ...cssFiles]) {
  collect(fs.readFileSync(fp, 'utf8'));
}

const md = ['# Visual component drift audit', ''];
md.push('สำรวจ class-name prefix ของ visual component ทั่วทั้ง `modules/` + `css/`');
md.push('แต่ละ row คือ "1 module ทำ component นี้แบบของตัวเอง"');
md.push('');

for (const c of conceptHits) {
  md.push(`## ${c.name}`);
  md.push('');
  if (c.prefixes.size === 0) { md.push('_ไม่พบ_'); md.push(''); continue; }
  md.push(`พบ **${c.prefixes.size}** prefix ที่ต่างกัน`);
  md.push('');
  md.push('| prefix | ตัวอย่าง class | count |');
  md.push('|---|---|---:|');
  const sorted = [...c.prefixes.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [prefix, info] of sorted) {
    const examples = [...info.full].slice(0, 3).join(', ');
    md.push(`| \`${prefix}\` | ${examples} | ${info.count} |`);
  }
  md.push('');
}

// scan for inline <style> blocks per page (sign of "module-level CSS not extracted")
md.push('## หน้าที่มี inline `<style>` block (CSS ไม่ได้แยกออกไปไฟล์)');
md.push('');
md.push('| File | inline style chars |');
md.push('|---|---:|');
for (const fp of htmlFiles) {
  const rel = path.relative(root, fp).replace(/\\/g, '/');
  const txt = fs.readFileSync(fp, 'utf8');
  const blocks = [...txt.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  const total = blocks.reduce((a, b) => a + b[1].length, 0);
  if (total > 200) md.push(`| ${rel} | ${total.toLocaleString()} |`);
}
md.push('');

const out = path.join(outDir, 'visual-drift.md');
fs.writeFileSync(out, md.join('\n'), 'utf8');
console.log('wrote:', out);
