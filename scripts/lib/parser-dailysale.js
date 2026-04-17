/* ============================================================
   parser-dailysale.js — parse 4 xls exports for Daily Sale CS
     bills         ← 01_บิลขายทั้งหมด
     payments      ← 01_รายงานช่องทางชำระเงิน
     topup_bills   ← 08_บิลเติมเงิน Ewallet
     topup_details ← 03_รายงานรายละเอียด Payment
   ============================================================ */

import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

/* ── Header maps per report type (all keys match 1 column in the xls) ── */
const HEADER_MAPS = {
  bills: {
    'วันเวลา': 'sale_datetime',
    'เลขที่บิล': 'bill_no',
    'เลขที่ใบกำกับภาษี': 'tax_invoice_no',
    'รหัสสมาชิก': 'member_code',
    'ชื่อสมาชิก': 'member_name',
    'ประเภทบิล': 'bill_type',
    'คะแนน': 'points',
    'จำนวนเงิน': 'amount',
    'VAT': 'vat',
    'ค่าจัดส่ง': 'shipping_fee',
    'ผู้บันทึก': 'recorded_by',
    'จัดส่ง': 'shipping',
    'ช่องทาง': 'channel',
    'สาขา': 'branch',
    'สาขารับ': 'receive_branch',
    'ประเภท': 'category',
    'ช่องทางบิล': 'bill_channel',
    'LB': 'lb',
    'หมายเหตุ': 'notes',
  },
  payments: {
    'วันที่ซื้อ': 'sale_date',
    'เลขที่บิล': 'bill_no',
    'จำนวนเงิน': 'amount',
    'ราคากลาง': 'base_price',
    'เงินสด': 'cash',
    'เงินโอน': 'transfer',
    'บัตรเครดิต': 'credit_card',
    'PAYPAL': 'paypal',
    'Dummy': 'dummy',
    'Ewallet': 'ewallet',
    'Gift Voucher': 'gift_voucher',
    'รูปแบบการชำระเงิน': 'payment_method',
  },
  topup_bills: {
    'วันที่ซื้อ': 'sale_date',
    'เลขที่บิล': 'bill_no',
    'รหัสสมาชิก': 'member_code',
    'ชื่อสมาชิก': 'member_name',
    'จำนวนเงิน': 'amount',
    'เงินสด': 'cash',
    'เงินโอน': 'transfer',
    'บัตรเครดิต': 'credit_card',
    'Gift Voucher': 'gift_voucher',
    'ผู้บันทึก': 'recorded_by',
    'สาขา': 'branch',
    'ช่องทาง': 'channel',
    'LB': 'lb',
    'หมายเหตุ': 'notes',
  },
  topup_details: {
    'วันที่ซื้อ': 'sale_date',
    'เลขที่บิล': 'bill_no',
    'รหัสสมาชิก': 'member_code',
    'ชื่อสมาชิก': 'member_name',
    'ช่องทางการชำระเงิน': 'payment_channel',
    'ทางการชำระ': 'payment_channel',
    'จำนวนเงิน': 'amount',
    'รูปแบบ': 'payment_format',
    'อ้างอิง': 'reference',
  },
};

const NUMERIC_FIELDS = new Set([
  'points', 'amount', 'vat', 'shipping_fee', 'base_price',
  'cash', 'transfer', 'credit_card', 'paypal', 'dummy', 'ewallet', 'gift_voucher',
]);

function _norm(h) {
  return String(h || '').replace(/\s+/g, '').toLowerCase();
}

function _toNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function _toStr(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return Number.isInteger(val) ? String(val) : String(val);
  if (val instanceof Date) return isNaN(val) ? '' : val.toISOString().slice(0, 10);
  return String(val).trim();
}

function _parseDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) return isNaN(val) ? null : val.toISOString().slice(0, 10);
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 80000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

function _parseDateTime(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) return isNaN(val) ? null : val.toISOString();
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 80000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d.toISOString();
  }
  const s = String(val).trim();
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString();
  const datePart = _parseDate(s);
  return datePart ? `${datePart}T00:00:00Z` : null;
}

function _findHeaderRow(rows, type) {
  const map = HEADER_MAPS[type];
  const keys = Object.keys(map).map(_norm);
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const matched = row.filter(c => c && keys.includes(_norm(c))).length;
    if (matched >= 4) return i;
  }
  return -1;
}

function _buildHeaderIndex(headers, type) {
  const map = HEADER_MAPS[type];
  const normMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [_norm(k), v]));
  const index = {};
  headers.forEach((h, i) => {
    if (!h) return;
    const field = map[h] || normMap[_norm(h)];
    if (field && !(field in index)) index[field] = i;
  });
  return index;
}

function _coerceValue(field, val, type) {
  if (val === null || val === undefined || val === '') {
    if (NUMERIC_FIELDS.has(field)) return 0;
    return null;
  }
  if (NUMERIC_FIELDS.has(field)) return _toNum(val);
  if (field === 'sale_datetime') return _parseDateTime(val);
  if (field === 'sale_date') return _parseDate(val);
  return _toStr(val);
}

/* ── Parser: bills (File 1) ── */
function parseBills(rows, headerIdx) {
  const headers = rows[headerIdx].map(h => h ? String(h).trim() : '');
  const idx = _buildHeaderIndex(headers, 'bills');
  const data = rows.slice(headerIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));
  const records = [];

  for (const r of data) {
    const rec = {};
    for (const [field, colIdx] of Object.entries(idx)) {
      rec[field] = _coerceValue(field, r[colIdx], 'bills');
    }
    if (!rec.bill_no) continue;
    if (rec.sale_datetime && !rec.sale_date) {
      rec.sale_date = rec.sale_datetime.slice(0, 10);
    }
    if (!rec.sale_date) continue;
    records.push(rec);
  }
  return records;
}

/* ── Parser: payments (File 2) — 1 row per bill ── */
function parsePayments(rows, headerIdx) {
  const headers = rows[headerIdx].map(h => h ? String(h).trim() : '');
  const idx = _buildHeaderIndex(headers, 'payments');
  const data = rows.slice(headerIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));
  const records = [];

  for (const r of data) {
    const rec = {};
    for (const [field, colIdx] of Object.entries(idx)) {
      rec[field] = _coerceValue(field, r[colIdx], 'payments');
    }
    if (!rec.bill_no) continue;
    if (!rec.sale_date) continue;
    records.push(rec);
  }
  return records;
}

/* ── Parser: topup_bills (File 4) ── */
function parseTopupBills(rows, headerIdx) {
  const headers = rows[headerIdx].map(h => h ? String(h).trim() : '');
  const idx = _buildHeaderIndex(headers, 'topup_bills');
  const data = rows.slice(headerIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));
  const records = [];

  for (const r of data) {
    const rec = {};
    for (const [field, colIdx] of Object.entries(idx)) {
      rec[field] = _coerceValue(field, r[colIdx], 'topup_bills');
    }
    if (!rec.bill_no) continue;
    if (!rec.sale_date) continue;
    records.push(rec);
  }
  return records;
}

/* ── Parser: topup_details (File 3) — N:1, merged row format ──
   Row 1 of each bill = summary (has bill_no + amount, empty payment_channel)
   Row 2+ = payment detail (empty bill_no, has payment_channel/format/reference)
   → We carry bill_no forward from summary rows to detail rows, emit only details.
*/
function parseTopupDetails(rows, headerIdx) {
  const headers = rows[headerIdx].map(h => h ? String(h).trim() : '');
  const idx = _buildHeaderIndex(headers, 'topup_details');
  const data = rows.slice(headerIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));
  const records = [];

  let ctx = { bill_no: null, sale_date: null, member_code: null, member_name: null };

  for (const r of data) {
    const rec = {};
    for (const [field, colIdx] of Object.entries(idx)) {
      rec[field] = _coerceValue(field, r[colIdx], 'topup_details');
    }

    if (rec.bill_no) {
      ctx = {
        bill_no: rec.bill_no,
        sale_date: rec.sale_date,
        member_code: rec.member_code,
        member_name: rec.member_name,
      };
    }

    if (!rec.payment_channel) continue;

    const detail = {
      bill_no: rec.bill_no || ctx.bill_no,
      sale_date: rec.sale_date || ctx.sale_date,
      member_code: rec.member_code || ctx.member_code,
      member_name: rec.member_name || ctx.member_name,
      payment_channel: rec.payment_channel,
      amount: rec.amount || 0,
      payment_format: rec.payment_format || null,
      reference: rec.reference || null,
    };

    if (!detail.bill_no || !detail.sale_date) continue;
    records.push(detail);
  }
  return records;
}

const PARSERS = {
  bills: parseBills,
  payments: parsePayments,
  topup_bills: parseTopupBills,
  topup_details: parseTopupDetails,
};

/* ── Main entry ── */
export async function parseDailySaleXls(filePath, type) {
  if (!PARSERS[type]) throw new Error(`Unknown report type: ${type}`);

  const buf = await readFile(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  const headerIdx = _findHeaderRow(rows, type);
  if (headerIdx === -1) {
    throw new Error(`[${type}] Header row not found — expected keys: ${Object.keys(HEADER_MAPS[type]).slice(0,3).join(', ')}`);
  }

  console.log(`[parser-${type}] Header row at line ${headerIdx + 1}`);
  const records = PARSERS[type](rows, headerIdx);
  console.log(`[parser-${type}] Parsed ${records.length} records`);
  return records;
}

/* ── Extract unique branch codes for auto-upsert to branches table ── */
export function extractBranches(records) {
  const codes = new Set();
  for (const r of records) {
    if (r.branch) codes.add(r.branch);
    if (r.receive_branch) codes.add(r.receive_branch);
  }
  return Array.from(codes);
}
