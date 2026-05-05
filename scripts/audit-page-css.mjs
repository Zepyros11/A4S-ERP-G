#!/usr/bin/env node
// Audit pages for design-system compliance.
// Checks: hero, stats, table, custom classes, structural issues.
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

const PAGES_SKIP_PORTAL = /modules[\\\/](ibd-portal|event[\\\/]register|event[\\\/]cs-view)/;
// Form pages naturally don't have hero (modal-style data entry)
const PAGES_SKIP_FORM = /[-_]form\.html$|requisition\.html$/;
// Special tools (no loadTopbar, custom UX)
const PAGES_SKIP_SPECIAL = new Set([
  'modules/event/check-in.html',
  'modules/inventory/movements.html',
  'modules/report/reports.html',
  'modules/settings/db_viewer.html',
  'modules/tour/check-seat.html',
  'modules/trip/check-seat.html',
  'modules/customer/members-import.html', // hidden from sidebar — button-only access
  'modules/dashboard/dashboard.html',     // has .welcome-banner (personalized clock/date hero)
]);
// Dashboards intentionally use default (large) hero, not compact
const PAGES_DASHBOARDS = /-dashboard\.html$|^modules[\\\/]dashboard[\\\/]/;
// Pages with intentional custom design (skip class-name flags)
const PAGES_SKIP_CUSTOM = new Set([
  'modules/customer-service/daily-sale.html', // .ds-table-wrap, .ds-tab-panel kept (tab logic + narrow numeric table)
  'modules/customer-service/promotion-list.html', // .promo-toolbar for grid toggle (intentional)
  'modules/event/line-promote.html', // .lp-action-bar dark navy bar (system tools)
  'modules/customer/members-tree.html', // .tree-search-wrap has autocomplete (custom)
]);

const issues = [];
for (const f of walk('modules', '.html')) {
  const rel = path.relative(path.resolve('.'), f).replace(/\\/g, '/');
  const html = fs.readFileSync(f, 'utf8');

  // Skip portal/cs-view (different layout context)
  const isPortal = PAGES_SKIP_PORTAL.test(f);
  // Skip form/special/dashboard pages
  const isForm = PAGES_SKIP_FORM.test(f);
  const isSpecial = PAGES_SKIP_SPECIAL.has(rel);
  const isDashboard = PAGES_DASHBOARDS.test(f) || /events-dashboard|ibd-dashboard/.test(f);
  const isCustomDesign = PAGES_SKIP_CUSTOM.has(rel);

  // Fully skip non-standard pages
  if (isPortal || isForm || isSpecial) continue;

  const flags = [];

  // 1) Has page-hero?
  const hasHero = /<(?:div|section|header)\s+class="[^"]*page-hero[^"]*"/.test(html);
  if (!hasHero) flags.push('NO_HERO');

  // 2) Has compact hero specifically? (skip dashboards intentionally)
  const hasCompact = /page-hero--compact/.test(html);
  if (hasHero && !hasCompact && !isDashboard && !isPortal) flags.push('HERO_NOT_COMPACT');

  // Custom-design pages skip class-name flags (kept intentionally)
  if (!isCustomDesign) {
    // 3) Old custom toolbar/header (should be page-hero)
    if (/<div\s+class="[^"]*\b(promo-toolbar|cat-hero|ds-hero|epg-header-info|lp-action-bar)\b/.test(html))
      flags.push('CUSTOM_HEADER');
    // 4) Custom stat classes (should be .stat-card)
    if (!isDashboard && /class="[^"]*\b(lm-stat|ds-hero-cell|kpi-grid|stat-grid)\b/.test(html))
      flags.push('CUSTOM_STAT');
    // 6) Custom toolbar (should be table-toolbar)
    if (/class="[^"]*\b(lm-toolbar|ds-filters|epg-toolbar-left)\b/.test(html))
      flags.push('CUSTOM_TOOLBAR');
    // 7) Custom search (should be search-wrap + search-input)
    if (/class="[^"]*\b(lm-search|cat-search|ds-search|tree-search-wrap)\b/.test(html))
      flags.push('CUSTOM_SEARCH');
    // 8) Custom tabs (should be page-tabs + page-tab) — exact word match (not -panel)
    if (/class="[^"]*\b(ds-tabs|epg-tabs|cat-tabs|po-tabs)\b/.test(html) ||
        /class="(?:[^"]*\s)?(ds-tab|epg-tab|cat-tab|po-tab)(?:\s[^"]*)?"/.test(html))
      flags.push('CUSTOM_TABS');
    // 9) Custom table (should be data-table inside table-card)
    if (/class="[^"]*\b(ds-table|lm-table|cat-table|epg-table)\b/.test(html))
      flags.push('CUSTOM_TABLE');
    // 10) Custom paginate (should be .pagination + .pagination-btn)
    if (/class="[^"]*\b(lm-paginate|ds-paginate|cat-paginate|epg-paginate)\b/.test(html))
      flags.push('CUSTOM_PAGINATE');
  }

  // 11) Inline page-title font (e.g. style="font-size:20px;font-weight:700") → should use page-hero
  if (/<div\s+style="[^"]*font-size:\s*(?:18|20|22|24)px[^"]*font-weight:\s*7/.test(html))
    flags.push('INLINE_TITLE');

  // 12) Has empty `class="page-hero"` (no modifiers) on a non-dashboard page?
  // Skip — already handled by HERO_NOT_COMPACT

  if (flags.length) issues.push({ file: rel, flags });
}

// Group by primary flag
const byFlag = {};
for (const it of issues) {
  for (const f of it.flags) {
    (byFlag[f] ||= []).push(it.file);
  }
}

console.log('=== AUDIT REPORT ===\n');
const order = [
  'NO_HERO', 'HERO_NOT_COMPACT', 'CUSTOM_HEADER', 'CUSTOM_STAT',
  'CUSTOM_TOOLBAR', 'CUSTOM_SEARCH', 'CUSTOM_TABS', 'CUSTOM_TABLE',
  'CUSTOM_PAGINATE', 'INLINE_TITLE'
];
for (const flag of order) {
  if (!byFlag[flag]) continue;
  console.log(`\n[${flag}] (${byFlag[flag].length})`);
  byFlag[flag].forEach(f => console.log('  ' + f));
}

console.log(`\n--- Summary ---`);
console.log(`Total issues: ${issues.length} pages with at least 1 flag`);
const total = walk('modules', '.html').length;
console.log(`Clean pages: ${total - issues.length} / ${total}`);
