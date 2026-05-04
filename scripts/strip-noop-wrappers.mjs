// Removes the dead `.layout` / `.content-area` / `#sidebar-container` wrappers
// from internal HTML pages — they have NO CSS rules and NO JS reference.
// See memory: project_layout_wrappers_noop.md
//
// Usage:  node scripts/strip-noop-wrappers.mjs <file1> [file2] ...
// Or:     node scripts/strip-noop-wrappers.mjs --all  (find all candidates)
//
// Pattern removed:
//   <div class="topbar"></div>
//   <div class="layout">
//     <div id="sidebar-container"></div>
//     <div class="content-area">
//       <div class="page">
//         CONTENT
//       </div>
//     </div>
//   </div>
//
// Becomes:
//   <div class="topbar"></div>
//   <div class="page">
//     CONTENT
//   </div>

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
  files = walk(path.join(root, 'modules'))
    .filter(f => /class="layout"|content-area|sidebar-container/.test(fs.readFileSync(f, 'utf8')));
}
if (files.length === 0) {
  console.log('No files passed. Try: node scripts/strip-noop-wrappers.mjs --all');
  process.exit(0);
}

let total = 0;
let changed = 0;
let skipped = [];

for (const f of files) {
  total++;
  const before = fs.readFileSync(f, 'utf8');
  let txt = before;

  // Remove the opening wrappers (3 lines that always appear together)
  txt = txt.replace(
    /[ \t]*<div\s+class="layout">\s*\n[ \t]*<div\s+id="sidebar-container"><\/div>\s*\n[ \t]*<div\s+class="content-area">\s*\n/g,
    ''
  );

  // Remove orphan #sidebar-container (in case wrapper was already gone)
  txt = txt.replace(
    /[ \t]*<div\s+id="sidebar-container"><\/div>\s*\n/g,
    ''
  );

  // Remove the closing wrappers — heuristic: 3 consecutive </div> lines
  // (one for content-area, one for layout, one was </div class=page> if it exists)
  // Be conservative: only remove if we removed the opening AND there's a recognizable
  // sequence of 2 extra </div> (content-area + layout) before </body>
  // We'll match the pattern:  </div>  [whitespace]  </div>  [whitespace]  </div>
  // immediately before </body> — keep one </div> for the .page
  if (txt !== before) {
    // Find the last </div> sequence before </body>
    txt = txt.replace(
      /([ \t]*<\/div>\s*\n)([ \t]*<\/div>\s*\n)([ \t]*<\/div>\s*\n)(\s*<!--[\s\S]*?-->\s*)?(\s*<script|\s*<\/body>)/,
      '$1$4$5'
    );
  }

  if (txt === before) {
    skipped.push(path.relative(root, f).replace(/\\/g, '/'));
    continue;
  }

  fs.writeFileSync(f, txt, 'utf8');
  changed++;
  console.log(`  ✓ ${path.relative(root, f).replace(/\\/g, '/')}`);
}

console.log(`\nTotal: ${total} | Changed: ${changed} | Skipped: ${skipped.length}`);
if (skipped.length) {
  console.log('\nSkipped (manual fix needed):');
  for (const s of skipped) console.log('  - ' + s);
}
