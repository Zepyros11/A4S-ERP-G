// Page audit: scans modules/**/*.html and produces docs/audit/pages-audit.{json,md}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const modulesDir = path.join(root, 'modules');
const outDir = path.join(root, 'docs', 'audit');
fs.mkdirSync(outDir, { recursive: true });

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.toLowerCase().endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(modulesDir).sort();

function stripComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

function matchAll(re, s) {
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push(m);
  return out;
}

// Manual classification of known standalone / fragment / abandoned pages.
// "standalone" = public-facing page (LIFF, kiosk) that intentionally has no ERP shell
// "fragment"   = HTML loaded via fetch into another page (modal contents only)
// "empty"      = abandoned / 0-byte file
const STANDALONE = new Set([
  'modules/event/register.html',
  'modules/event/check-in.html',
  'modules/event/cs-view/events-bookingRoom.html',
  'modules/event/cs-view/events-calendar.html',
  'modules/event/cs-view/event-poster-gallery-view.html',
  'modules/tour/check-seat.html',
  'modules/trip/check-seat.html',
]);

const rows = [];
for (const fp of files) {
  const rel = path.relative(root, fp).replace(/\\/g, '/');
  const raw = fs.readFileSync(fp, 'utf8');
  const text = stripComments(raw);

  const cssLinks = matchAll(/<link[^>]*href="([^"]+\.css)"/gi, text).map(m => m[1]);
  const jsLinks  = matchAll(/<script[^>]*src="([^"]+\.js)"/gi, text).map(m => m[1]);

  const has = (list, needle) => list.some(s => s.includes(needle));

  const moduleCss = cssLinks.filter(s => !s.includes('/css/') && !/^https?:/.test(s));

  // Classify
  const sizeBytes = raw.length;
  const hasHtmlTag = /<html[\s>]/i.test(raw);
  const hasBodyTag = /<body[\s>]/i.test(raw);
  let kind;
  if (sizeBytes === 0) kind = 'empty';
  else if (rel.startsWith('modules/ibd-portal/')) kind = 'portal';
  else if (STANDALONE.has(rel)) kind = 'standalone';
  else if (!hasHtmlTag && !hasBodyTag) kind = 'fragment';
  else kind = 'internal';

  const row = {
    file: rel,
    kind,
    sizeBytes,
    isPortal: kind === 'portal',
    cssCount: cssLinks.length,
    jsCount: jsLinks.length,
    importsMainCss: has(cssLinks, 'css/main.css'),
    importsModuleCss: moduleCss.length > 0,
    importsModalCss: has(cssLinks, 'modal.css'),
    importsTableCss: has(cssLinks, 'table.css'),
    importsImgGridCss: has(cssLinks, 'imageGrid.css'),
    hasModalManager: has(jsLinks, 'modalManager.js'),
    hasConfirmModal: has(jsLinks, 'confirmModal.js'),
    hasPromptModal: has(jsLinks, 'promptModal.js'),
    hasAuth: has(jsLinks, 'auth.js'),
    hasAuthz: has(jsLinks, 'authz.js'),
    hasPermissions: has(jsLinks, 'permissions.js'),
    hasSidebar: has(jsLinks, 'sidebar.js'),
    hasTopbarJs: has(jsLinks, 'topbar.js'),
    hasDateFormat: has(jsLinks, 'date-format.js'),
    hasSupabase: has(jsLinks, 'supabase.js'),
    hasConfig: has(jsLinks, 'config.js'),
    hasTopbarMarkup: /<div[^>]*class="[^"]*topbar/i.test(text),
    hasLayoutShell: /<div[^>]*class="[^"]*layout/i.test(text),
    hasSidebarSlot: /id="sidebar-container"/.test(text),
    hasContentArea: /class="[^"]*content-area/.test(text),
    hasPageWrap: /class="[^"]*\bpage\b/.test(text),
    hasToastEl: /id="toast"/.test(text),
    hasLoadingOverlay: /id="loadingOverlay"/.test(text),
    hasDomLoaded: /DOMContentLoaded/.test(text),
    nativeAlert: matchAll(/(?<![A-Za-z_$.])alert\s*\(/g, text).length,
    nativeConfirm: matchAll(/(?<![A-Za-z_$.])confirm\s*\(/g, text).length,
    nativePrompt: matchAll(/(?<![A-Za-z_$.])prompt\s*\(/g, text).length,
    moduleCssList: moduleCss.join(';'),
    jsList: jsLinks.join(';'),
  };
  rows.push(row);
}

fs.writeFileSync(path.join(outDir, 'pages-audit.json'), JSON.stringify(rows, null, 2), 'utf8');

const byKind = k => rows.filter(r => r.kind === k);
const internal   = byKind('internal');
const standalone = byKind('standalone');
const fragments  = byKind('fragment');
const portal     = byKind('portal');
const empty      = byKind('empty');

const md = [];
md.push('# Page audit (auto-generated)');
md.push('');
md.push(`Total HTML files scanned: **${rows.length}**`);
md.push('');
md.push('## Classification');
md.push('');
md.push('| Kind | Count | Description |');
md.push('|---|---:|---|');
md.push(`| internal   | ${internal.length}   | Internal ERP page — full shell expected (topbar+sidebar) |`);
md.push(`| standalone | ${standalone.length} | Public/LIFF/kiosk page — intentionally no ERP shell |`);
md.push(`| fragment   | ${fragments.length}  | Modal HTML loaded via fetch into another page |`);
md.push(`| portal     | ${portal.length}     | External customer portal (ibd-portal) — separate baseline |`);
md.push(`| empty      | ${empty.length}      | 0-byte / abandoned file |`);
md.push('');

if (empty.length) {
  md.push('### Empty / abandoned files');
  for (const r of empty) md.push(`- \`${r.file}\` (${r.sizeBytes} bytes)`);
  md.push('');
}
if (fragments.length) {
  md.push('### Modal fragments (not standalone pages — loaded via fetch)');
  for (const r of fragments) md.push(`- \`${r.file}\``);
  md.push('');
}
if (standalone.length) {
  md.push('### Standalone pages (public / LIFF / kiosk — separate design baseline)');
  for (const r of standalone) md.push(`- \`${r.file}\``);
  md.push('');
}


md.push('## Summary by criterion (internal pages only)');
md.push('');
md.push('| Criterion | Has | Missing |');
md.push('|---|---:|---:|');
const crit = [
  ['imports css/main.css', 'importsMainCss'],
  ['imports module css', 'importsModuleCss'],
  ['imports modal.css separately', 'importsModalCss'],
  ['imports table.css separately', 'importsTableCss'],
  ['has modalManager.js', 'hasModalManager'],
  ['has confirmModal.js', 'hasConfirmModal'],
  ['has auth.js', 'hasAuth'],
  ['has authz.js', 'hasAuthz'],
  ['has permissions.js', 'hasPermissions'],
  ['has sidebar.js', 'hasSidebar'],
  ['has date-format.js', 'hasDateFormat'],
  ['has supabase.js', 'hasSupabase'],
  ['has topbar markup', 'hasTopbarMarkup'],
  ['has layout shell', 'hasLayoutShell'],
  ['has sidebar slot', 'hasSidebarSlot'],
  ['has content-area', 'hasContentArea'],
  ['has page wrap', 'hasPageWrap'],
  ['has toast element', 'hasToastEl'],
  ['has loading overlay', 'hasLoadingOverlay'],
  ['has DOMContentLoaded', 'hasDomLoaded'],
];
for (const [label, key] of crit) {
  const h = internal.filter(r => r[key]).length;
  md.push(`| ${label} | ${h} | ${internal.length - h} |`);
}
md.push('');

md.push('## Drift: pages MISSING / VIOLATING required pieces (internal)');
md.push('');
const checks = [
  ['Missing main.css',      r => !r.importsMainCss],
  ['Missing modalManager',  r => !r.hasModalManager],
  ['Missing auth.js',       r => !r.hasAuth],
  ['Missing authz.js',      r => !r.hasAuthz],
  ['Missing permissions.js',r => !r.hasPermissions],
  ['Missing sidebar.js',    r => !r.hasSidebar],
  ['Missing date-format.js',r => !r.hasDateFormat],
  ['Missing topbar markup', r => !r.hasTopbarMarkup],
  ['Missing layout shell',  r => !r.hasLayoutShell],
  ['Missing toast element', r => !r.hasToastEl],
  ['Missing loading overlay', r => !r.hasLoadingOverlay],
  ['Native alert() used',   r => r.nativeAlert > 0],
  ['Native confirm() used', r => r.nativeConfirm > 0],
  ['Native prompt() used',  r => r.nativePrompt > 0],
  ['Imports modal.css separately (should fold into main.css)', r => r.importsModalCss],
  ['Imports table.css separately (should fold into main.css)', r => r.importsTableCss],
];
for (const [label, fn] of checks) {
  const hits = internal.filter(fn);
  md.push(`### ${label} — ${hits.length} page(s)`);
  if (hits.length === 0) md.push('_none_');
  else for (const h of hits) {
    const extra = label.includes('Native')
      ? ` (alert=${h.nativeAlert}, confirm=${h.nativeConfirm}, prompt=${h.nativePrompt})`
      : '';
    md.push(`- \`${h.file}\`${extra}`);
  }
  md.push('');
}

md.push('## Per-page table (internal)');
md.push('');
md.push('Legend: M=main.css · m=modalMgr · a=auth · z=authz · p=perm · s=sidebar · d=date · T=topbar markup · L=layout · S=sidebarSlot · t=toast · A#=alert · C#=confirm');
md.push('');
md.push('| File | M | m | a | z | p | s | d | T | L | S | t | A | C | module css |');
md.push('|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|');
const yn = b => (b ? '✓' : '·');
const nz = n => (n > 0 ? String(n) : '·');
for (const r of internal) {
  md.push(`| ${r.file} | ${yn(r.importsMainCss)} | ${yn(r.hasModalManager)} | ${yn(r.hasAuth)} | ${yn(r.hasAuthz)} | ${yn(r.hasPermissions)} | ${yn(r.hasSidebar)} | ${yn(r.hasDateFormat)} | ${yn(r.hasTopbarMarkup)} | ${yn(r.hasLayoutShell)} | ${yn(r.hasSidebarSlot)} | ${yn(r.hasToastEl)} | ${nz(r.nativeAlert)} | ${nz(r.nativeConfirm)} | ${r.moduleCssList} |`);
}
md.push('');

md.push('## Portal pages (separate baseline — informational)');
md.push('');
md.push('| File | M | module css | js |');
md.push('|---|:-:|---|---|');
for (const r of portal) {
  md.push(`| ${r.file} | ${yn(r.importsMainCss)} | ${r.moduleCssList} | ${r.jsList} |`);
}
md.push('');

// --- Native popups across the WHOLE codebase (real bug regardless of kind) ---
md.push('## Native popup violations (any kind)');
md.push('');
md.push('Memory rule: ห้ามใช้ native confirm/alert/prompt — ใช้ ConfirmModal/PromptModal');
md.push('');
md.push('| File | kind | alert | confirm | prompt |');
md.push('|---|:-:|---:|---:|---:|');
const offenders = rows.filter(r => r.nativeAlert + r.nativeConfirm + r.nativePrompt > 0);
for (const r of offenders) {
  md.push(`| ${r.file} | ${r.kind} | ${r.nativeAlert} | ${r.nativeConfirm} | ${r.nativePrompt} |`);
}
md.push('');

fs.writeFileSync(path.join(outDir, 'pages-audit.md'), md.join('\n'), 'utf8');

console.log(`wrote: ${path.join(outDir, 'pages-audit.json')}`);
console.log(`wrote: ${path.join(outDir, 'pages-audit.md')}`);
console.log(`internal: ${internal.length} | portal: ${portal.length}`);
