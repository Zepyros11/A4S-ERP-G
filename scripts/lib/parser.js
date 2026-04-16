/* ============================================================
   parser.js — อ่าน .xls/.xlsx → records สำหรับ upsert Supabase
   Mirror logic จาก modules/customer/members-import.js (browser)
   ============================================================ */

import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { encrypt } from './crypto.js';

/* ── Column mapping: header ภาษาไทย → DB field ── */
const HEADER_MAP = {
  'วันที่สมัคร': 'registered_at',
  'วันเกิด': 'birth_date',
  'รหัสสมาชิก': 'member_code',
  'ชื่อสมาชิก': 'member_name',
  'ชื่อบุคคล': 'full_name',
  'ชื่อบุคคลธรรมดา': 'full_name',
  'โทรศัพท์': 'phone',
  'รหัสผ่าน': '__password_plain',
  'บัตรประชาชน': '__national_id_plain',
  'เลขบัตรประชาชน': '__national_id_plain',
  'ชื่อผู้สมัครร่วม': 'co_applicant_name',
  'ประชาชน': 'co_applicant_id',
  'เลขบัตรประชาชนผู้สมัครร่วม': 'co_applicant_id',
  'Package': 'package',
  'ตำแหน่ง': 'position',
  'ตำแหน่ง สูงสุด': 'position_level',
  'รหัสผู้แนะนำ': 'sponsor_code',
  'รหัสอัพไลน์': 'upline_code',
  'ด้าน': 'side',
  'สถานะเอกสาร': 'doc_status',
  'SP': 'sp_flag',
  'TN': 'tn_flag',
  'E-mail': 'email',
  'ประเภทสมาชิก': 'member_type',
  'ประเภทบุคคล': 'person_type',
  'เข้ากระเป๋า': 'wallet_percent',
  'เข้ากระเป๋า A': 'wallet_percent',
  'ช่องทางสมัคร': 'channel',
  'สัญชาติ': 'nationality',
  'LB': 'country_code',
};

const NUMERIC_CODE_FIELDS = new Set(['member_code', 'sponsor_code', 'upline_code']);

/* Normalize Thai/English header for fuzzy matching (strip spaces, lowercase) */
function _normHeader(h) {
  return String(h || '').replace(/\s+/g, '').toLowerCase();
}

/* Build a normalized lookup once (case + whitespace insensitive) */
const HEADER_MAP_NORM = Object.fromEntries(
  Object.entries(HEADER_MAP).map(([k, v]) => [_normHeader(k), v])
);

/* Substring patterns for extra robustness when header has decoration */
const HEADER_PATTERNS = [
  { re: /ชื่อบุคคล/, field: 'full_name' },
  { re: /ชื่อสมาชิก/, field: 'member_name' },
  { re: /รหัสสมาชิก/, field: 'member_code' },
  { re: /โทรศัพท์|โทร/, field: 'phone' },
  { re: /วันที่สมัคร/, field: 'registered_at' },
  { re: /วันเกิด/, field: 'birth_date' },
  { re: /รหัสผู้แนะนำ|ผู้แนะนำ/, field: 'sponsor_code' },
  { re: /รหัสอัพไลน์|อัพไลน์/, field: 'upline_code' },
  { re: /ด้าน/, field: 'side' },
  { re: /^package$/i, field: 'package' },
  { re: /^lb$/i, field: 'country_code' },
];

function mapHeader(raw) {
  if (!raw) return null;
  // 1. Direct match (fast path)
  if (HEADER_MAP[raw]) return HEADER_MAP[raw];
  // 2. Normalized match (ignore whitespace + case)
  const norm = _normHeader(raw);
  if (HEADER_MAP_NORM[norm]) return HEADER_MAP_NORM[norm];
  // 3. Substring pattern fallback
  for (const { re, field } of HEADER_PATTERNS) {
    if (re.test(raw)) return field;
  }
  return null;
}

/* ── Helpers (mirror browser toCleanString / toNumericCode / parseDate) ── */
function toCleanString(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '';
    if (Number.isInteger(val) || Math.abs(val) >= 1e10) return Math.round(val).toString();
    return String(val);
  }
  if (val instanceof Date) {
    if (isNaN(val)) return '';
    return val.toISOString().slice(0, 10);
  }
  return String(val).trim();
}

function toNumericCode(val) {
  const s = toCleanString(val);
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function _validIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (isNaN(dt)) return null;
  if (dt.toISOString().slice(0, 10) !== iso) return null;
  const y = Number(m[1]);
  if (y < 1900 || y > 2100) return null;
  return iso;
}

function parseDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    return _validIso(val.toISOString().slice(0, 10));
  }
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 80000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(d)) return _validIso(d.toISOString().slice(0, 10));
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return _validIso(s.slice(0, 10));
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return _validIso(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`);
  }
  return null;
}

/* ── Main: parse .xls file → Supabase records ── */
export async function parseXlsToRecords(filePath, { masterKey, sourceFile = null } = {}) {
  const buf = await readFile(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  // Find header row (has "รหัสสมาชิก")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i] && rows[i].some(c => c && String(c).includes('รหัสสมาชิก'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error('Header row not found (expect "รหัสสมาชิก")');

  const headers = rows[headerIdx].map(h => (h ? String(h).trim() : ''));
  const dataRows = rows.slice(headerIdx + 1).filter(r =>
    r && r.some(c => c !== null && c !== '' && c !== undefined)
  );

  // Diagnostic: log header → mapping for CI logs
  console.log(`[parser] Headers detected (${headers.filter(Boolean).length} cols):`);
  const unmapped = [];
  headers.forEach((h, i) => {
    if (!h) return;
    const m = mapHeader(h);
    if (m) console.log(`  col ${i}: "${h}" → ${m}`);
    else { console.log(`  col ${i}: "${h}" → (unmapped)`); unmapped.push(h); }
  });
  if (unmapped.length) console.log(`[parser] ⚠️ ${unmapped.length} header(s) unmapped → stored as extra_data`);

  // Convert each row → record
  const records = [];
  for (const r of dataRows) {
    const rec = { source_file: sourceFile || filePath };
    const extra = {};

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (!h) continue;
      const val = r[i];
      if (val === null || val === undefined || val === '') continue;

      const mapped = mapHeader(h);
      if (!mapped) { extra[h] = val; continue; }

      if (mapped === '__password_plain') {
        if (masterKey) rec.password_encrypted = encrypt(toCleanString(val), masterKey);
        continue;
      }
      if (mapped === '__national_id_plain') {
        if (masterKey) rec.national_id_encrypted = encrypt(toCleanString(val), masterKey);
        continue;
      }
      if (mapped === 'registered_at' || mapped === 'birth_date') {
        rec[mapped] = parseDate(val);
        continue;
      }
      if (mapped === 'wallet_percent') {
        const n = Number(val);
        rec[mapped] = Number.isFinite(n) ? n : null;
        continue;
      }
      if (NUMERIC_CODE_FIELDS.has(mapped)) {
        rec[mapped] = toNumericCode(val);
        continue;
      }
      rec[mapped] = toCleanString(val);
    }

    if (Object.keys(extra).length) rec.extra_data = extra;
    if (rec.member_code) records.push(rec);   // skip rows without primary key
  }

  // Diagnostic: count populated fields
  const fieldCounts = {};
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (v !== null && v !== undefined && v !== '') {
        fieldCounts[k] = (fieldCounts[k] || 0) + 1;
      }
    }
  }
  console.log(`[parser] Field fill rates (${records.length} rows):`);
  for (const [k, c] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((c / records.length) * 100).toFixed(1);
    console.log(`  ${k}: ${c.toLocaleString()} (${pct}%)`);
  }

  return records;
}
