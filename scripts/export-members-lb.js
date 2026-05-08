#!/usr/bin/env node
/* ============================================================
   export-members-lb.js — Export member_code + member_name + LB (country_code)
   Usage:
     node export-members-lb.js <codes-file> [output.xlsx]
   codes-file: .txt (one code per line) | .csv | .xlsx (first column)
   ============================================================ */

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import * as XLSX from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  // Try load from scripts/.env
  const envPath = join(import.meta.dirname || '.', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = process.env[m[1]] || m[2];
    }
  }
}

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY missing (check scripts/.env)');
  process.exit(1);
}

function readCodes(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    return rows.map(r => r?.[0]).filter(v => v !== null && v !== undefined && v !== '');
  }
  // .txt / .csv → first column / one per line
  const text = readFileSync(path, 'utf8');
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split(/[,\t]/)[0].trim().replace(/^"|"$/g, ''));
}

function normalizeCode(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  // numeric → strip leading zeros (DB stores as "1234" not "0001234")
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

async function fetchByCodes(codes) {
  // PostgREST `in.(...)` — chunk to avoid URL length issues
  const CHUNK = 200;
  const out = [];
  for (let i = 0; i < codes.length; i += CHUNK) {
    const batch = codes.slice(i, i + CHUNK);
    const list = batch.map(c => encodeURIComponent(c)).join(',');
    const url = `${URL_BASE}/rest/v1/members?select=member_code,member_name,country_code&member_code=in.(${list})`;
    const res = await fetch(url, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
    }
    const rows = await res.json();
    out.push(...rows);
    console.log(`   batch ${Math.floor(i/CHUNK)+1}: requested ${batch.length} → got ${rows.length}`);
  }
  return out;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node export-members-lb.js <codes-file> [output.xlsx]');
    process.exit(1);
  }
  if (!existsSync(inputPath)) {
    console.error(`❌ Input not found: ${inputPath}`);
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = process.argv[3] ||
    join(import.meta.dirname || '.', '..', 'exports', `members-lb-${ts}.xlsx`);

  console.log(`📥 Reading: ${inputPath}`);
  const rawCodes = readCodes(inputPath);
  console.log(`   raw codes: ${rawCodes.length}`);

  const normalized = rawCodes.map(normalizeCode).filter(Boolean);
  const unique = [...new Set(normalized)];
  console.log(`   normalized + unique: ${unique.length}`);

  console.log(`\n🔎 Querying Supabase...`);
  const rows = await fetchByCodes(unique);
  console.log(`   ✅ Fetched ${rows.length} rows`);

  // Build code → row map for ordering
  const byCode = new Map(rows.map(r => [String(r.member_code), r]));
  const missing = unique.filter(c => !byCode.has(c));
  if (missing.length) {
    console.log(`\n⚠️  ${missing.length} code(s) not found in members table:`);
    console.log(`   ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' ...' : ''}`);
  }

  // Output rows: preserve input order, pad zeros to 7 digits like source web (0119632)
  const padCode = (c) => String(c).padStart(7, '0');
  const outputRows = unique.map(code => {
    const r = byCode.get(code);
    return {
      member_code: padCode(code),
      member_name: r?.member_name || '',
      LB: r?.country_code || '',
    };
  });

  // Build workbook
  const ws = XLSX.utils.json_to_sheet(outputRows, { header: ['member_code', 'member_name', 'LB'] });
  ws['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 6 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Members');
  XLSX.writeFile(wb, outputPath);

  console.log(`\n✅ Done`);
  console.log(`   File: ${outputPath}`);
  console.log(`   Rows: ${outputRows.length} (found: ${rows.length}, missing: ${missing.length})`);
}

main().catch(e => {
  console.error('💥 Fatal:', e.message);
  process.exit(1);
});
