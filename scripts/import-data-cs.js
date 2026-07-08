#!/usr/bin/env node
/* ============================================================
   import-data-cs.js — Historical import of the DATA_CS Google Sheet
     (the "already-corrected" daily-sale data) into ERP / Supabase.

   Background (see docs/DAILY-SALE-MIGRATION-HANDOFF.md):
     - answerforsuccess = raw data with the WRONG payment channel
     - Google Sheet DATA_CS = the SAME bills but with the payment channel
       already corrected by CS. It is the source of truth for history.
     → every payment row imported here is written with corrected = true so
       the hourly answerforsuccess sync (scripts/sync-daily-sale.js →
       upsertPayments) will NOT overwrite the corrected channels.

   Reads 3 CSV exports from data/daily-sale-import/ :
     *DailySale_DATA*.csv  → daily_sale_bills + daily_sale_payments  (~7,600)
     *Billonline_DATA*.csv → daily_sale_bills + daily_sale_payments  (~1,480, STHONLIN)
     *CheckBill_DATA*.csv  → daily_sale_reconcile

   Usage (from repo root or scripts/):
     node scripts/import-data-cs.js            # writes to Supabase
     DRY_RUN=1 node scripts/import-data-cs.js  # parse + validate only, no writes
   ============================================================ */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* ── env: reuse scripts/.env (SUPABASE_URL / SUPABASE_SERVICE_KEY) ── */
const SCRIPT_DIR = import.meta.dirname || '.';
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  const envPath = join(SCRIPT_DIR, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = process.env[m[1]] || m[2];
    }
  }
}
const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

const DATA_DIR = join(SCRIPT_DIR, '..', 'data', 'daily-sale-import');
const SOURCE_FILE = 'DATA_CS-import';
const CORRECTION_NOTES = 'DATA_CS historical import (channel already corrected by CS)';
const NOW_ISO = new Date().toISOString();

/* ============================================================
   Helpers
   ============================================================ */

// RFC-4180-ish CSV parser: handles quoted fields, embedded commas, "" escapes.
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// " 1,500 " → 1500 ; "" / " -   " → 0 ; keeps sign
function num(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[,\s]/g, '');
  if (s === '' || s === '-') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// "1/9/2025" (D/M/YYYY) → "2025-09-01" ; tolerant of trailing time / Buddhist year
function toISODate(v) {
  if (!v) return null;
  const s = String(v).trim().split(/[ T]/)[0];
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  let yy = parseInt(y, 10);
  if (yy > 2500) yy -= 543;            // guard: Buddhist era → CE
  const dd = parseInt(d, 10), mm = parseInt(mo, 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

const clean = v => { const s = (v == null ? '' : String(v)).trim(); return s === '' ? null : s; };
const chan = billNo => (billNo && billNo.includes('ONLIN')) ? 'Online' : 'Branch';  // STHONLIN / ETHONLIN

function findFile(keyword) {
  const f = readdirSync(DATA_DIR).find(n => n.toLowerCase().includes(keyword.toLowerCase()) && n.toLowerCase().endsWith('.csv'));
  if (!f) throw new Error(`CSV not found for "${keyword}" in ${DATA_DIR}`);
  return join(DATA_DIR, f);
}

/* ============================================================
   Parsers  (positional column indices — a data row always has a
   parseable D/M/YYYY in column 0, so header / numeric-header /
   blank rows are skipped automatically)
   ============================================================ */

// DailySale_DATA columns:
// 0 วันที่ 1 วันที่ออกบิล 2 เลขที่บิล 3 รหัส 4 ชื่อ
// 5 Cash 6 FrontOffice 7 Online 8 KBANK 9 KTB 10 E-WALLET 11 gift 12 qr 13 หักค่าคอม 14 ARP
// 15 Total 16 ผู้บันทึก 17 หมายเหตุ 18 Branch 19 TYPE
function parseDailySale(path) {
  const bills = new Map(), pays = new Map();
  let skipped = 0;
  for (const r of parseCSV(readFileSync(path, 'utf8'))) {
    const saleDate = toISODate(r[0]);
    const billNo = clean(r[2]);
    if (!saleDate || !billNo) { skipped++; continue; }
    // branch col is uniformly BKK01 in this export (the daily CS ledger is HQ);
    // normalize defensively so stray case variants never spawn duplicate branches.
    const branch = (clean(r[18]) || 'BKK01').toUpperCase();
    const cash = num(r[5]), fo = num(r[6]), online = num(r[7]);
    const kbank = num(r[8]), ktb = num(r[9]), ewallet = num(r[10]);
    const gift = num(r[11]), qr = num(r[12]), comm = num(r[13]), arp = num(r[14]);
    // preserve the collapsed channel detail in payment_method (KBANK vs KTB, etc.)
    const parts = [];
    if (fo) parts.push('Front Office'); if (online) parts.push('Online');
    if (kbank) parts.push('KBANK'); if (ktb) parts.push('KTB');
    bills.set(billNo, {
      bill_no: billNo, sale_date: saleDate, business_date: saleDate,
      member_code: clean(r[3]), member_name: clean(r[4]),
      amount: num(r[15]), branch, channel: chan(billNo),
      bill_type: clean(r[19]),   // TYPE: Dailysale / ARP / EWALLET — keeps ETH distinguishable
      recorded_by: clean(r[16]), notes: clean(r[17]), source_file: SOURCE_FILE,
    });
    pays.set(billNo, {
      bill_no: billNo, sale_date: saleDate, amount: num(r[15]),
      cash,
      front_office: fo, online, kbank, ktb,          // split (increment 2)
      transfer: kbank + ktb, credit_card: fo + online, // aggregates (backward-compat)
      ewallet, gift_voucher: gift, qr_payment: qr,
      commission_deduct: comm, arp_amount: arp,
      payment_method: parts.length ? parts.join('+') : null,
      corrected: true, corrected_at: NOW_ISO, correction_notes: CORRECTION_NOTES,
      source_file: SOURCE_FILE,
    });
  }
  return { bills, pays, skipped };
}

// Billonline_DATA columns:
// 0 วันที่ 1 วันที่สั่งซื้อ 2 เลขที่บิล 3 รหัสผู้ซื้อ 4 ชื่อผู้ซื้อ
// 5 Online 6 E-WALLET 7 QR 8 หักคอม 9 ARP(usd) 10 สาขา 11 เวลา 12 หมายเหตุ
// (no Total column → amount = Online + E-WALLET + QR)
function parseBillonline(path) {
  const bills = new Map(), pays = new Map();
  let skipped = 0;
  for (const r of parseCSV(readFileSync(path, 'utf8'))) {
    const saleDate = toISODate(r[0]);
    const billNo = clean(r[2]);
    if (!saleDate || !billNo) { skipped++; continue; }
    // col10 (สาขา) here is the customer pickup point (NB/DP/…), NOT the selling
    // branch — the selling branch is BKK01 (see DailySale). Pickup detail already
    // lives in the note ("รับเอง …"), so force BKK01 and don't corrupt branch.
    const branch = 'BKK01';
    const online = num(r[5]), ewallet = num(r[6]), qr = num(r[7]);
    const comm = num(r[8]), arp = num(r[9]);
    const amount = online + ewallet + qr;
    const parts = [];
    if (online) parts.push('Online'); if (ewallet) parts.push('E-WALLET'); if (qr) parts.push('QR');
    bills.set(billNo, {
      bill_no: billNo, sale_date: saleDate, business_date: saleDate,
      member_code: clean(r[3]), member_name: clean(r[4]),
      amount, branch, channel: 'Online', bill_type: null,
      recorded_by: null, notes: clean(r[12]), source_file: SOURCE_FILE,
    });
    pays.set(billNo, {
      bill_no: billNo, sale_date: saleDate, amount,
      cash: 0,
      front_office: 0, online, kbank: 0, ktb: 0,      // Billonline = online CC only
      transfer: 0, credit_card: online,
      ewallet, gift_voucher: 0, qr_payment: qr,
      commission_deduct: comm, arp_amount: arp,
      payment_method: parts.length ? parts.join('+') : null,
      corrected: true, corrected_at: NOW_ISO, correction_notes: CORRECTION_NOTES,
      source_file: SOURCE_FILE,
    });
  }
  return { bills, pays, skipped };
}

// CheckBill_DATA columns:
// 0 วันที่ 1 จำนวนบิล(นับจริง) 2 มูลค่า(นับจริง) 3 คงเหลือ 4 จำนวนบิล(ระบบ) 5 มูลค่า(ระบบ)
// 6 ผลต่าง(generated,skip) 7 SIGNATURE 8 หมายเหตุ
// NOTE: first pair = bill (source of truth / counted), second pair = system.
//   Verified against the sheet's own ผลต่าง sign: diff = bill_value - system_value
//   e.g. 12/7 → 61,040 - 74,440 = -13,400, matching the sheet's "-13,400".
function parseCheckBill(path) {
  const recs = new Map();
  let skipped = 0;
  for (const r of parseCSV(readFileSync(path, 'utf8'))) {
    const d = toISODate(r[0]);
    if (!d) { skipped++; continue; }
    const branch = 'BKK01';
    recs.set(`${d}|${branch}`, {
      reconcile_date: d, branch,
      bill_count: Math.round(num(r[1])), bill_value: num(r[2]),
      remaining: num(r[3]),
      system_count: Math.round(num(r[4])), system_value: num(r[5]),
      signature: clean(r[7]), notes: clean(r[8]),
    });
  }
  return { recs, skipped };
}

/* ============================================================
   Supabase REST
   ============================================================ */
async function req(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const t = await res.text();
  return t ? (() => { try { return JSON.parse(t); } catch { return null; } })() : null;
}

// Confirm required migrations (021 qr/comm/arp · 023 business_date · 025 corrected)
// are live before writing — a missing column would fail every batch.
async function preflight() {
  const checks = [
    ['daily_sale_payments', 'bill_no,corrected,qr_payment,front_office,online,kbank,ktb', '027 (+025/021)'],
    ['daily_sale_bills', 'bill_no,business_date,bill_type', '023'],
    ['daily_sale_reconcile', 'reconcile_date,bill_count,system_count', '020'],
  ];
  for (const [table, cols, mig] of checks) {
    try { await req(`${table}?select=${cols}&limit=1`); }
    catch (e) {
      throw new Error(`preflight failed on ${table} (${e.message.slice(0, 120)})\n   → run migration ${mig} in Supabase first.`);
    }
  }
}

async function ensureBranches(codes) {
  if (!codes.length) return;
  await req('branches?on_conflict=branch_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: codes.map(c => ({ branch_code: c, branch_name: c, country_code: 'TH', display_order: 99, active: true })),
  });
}

async function upsert(table, conflict, records, batch = 500) {
  let ok = 0;
  for (let i = 0; i < records.length; i += batch) {
    const chunk = records.slice(i, i + batch);
    await req(`${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: chunk,
    });
    ok += chunk.length;
    process.stdout.write(`\r   ${table}: ${ok}/${records.length}`);
  }
  if (records.length) process.stdout.write('\n');
  return ok;
}

/* ============================================================
   Main
   ============================================================ */
async function main() {
  console.log(`\n📥 DATA_CS historical import  ${DRY_RUN ? '(DRY RUN — no writes)' : ''}`);
  console.log(`   dir: ${DATA_DIR}\n`);

  const dsPath = findFile('DailySale');
  const boPath = findFile('Billonline');
  const cbPath = findFile('CheckBill');

  const ds = parseDailySale(dsPath);
  const bo = parseBillonline(boPath);
  const cb = parseCheckBill(cbPath);

  // Merge: DailySale is the authoritative daily ledger (it already contains
  // nearly all online bills). Billonline only ADDS bills DailySale is missing
  // and enriches an empty note with its pickup detail — it never overrides
  // DailySale's corrected channel/amount.
  const bills = new Map(ds.bills);
  let boAdded = 0, boEnriched = 0;
  for (const [k, v] of bo.bills) {
    if (!bills.has(k)) { bills.set(k, v); boAdded++; }
    else if (!bills.get(k).notes && v.notes) { bills.get(k).notes = v.notes; boEnriched++; }
  }
  const pays = new Map(ds.pays);
  for (const [k, v] of bo.pays) if (!pays.has(k)) pays.set(k, v);

  const billArr = [...bills.values()];
  const payArr = [...pays.values()];
  const recArr = [...cb.recs.values()];

  const dates = billArr.map(b => b.sale_date).sort();
  const branchCodes = [...new Set(billArr.map(b => b.branch))];

  console.log('── Parsed ──');
  console.log(`  DailySale : ${ds.bills.size} bills (skipped ${ds.skipped} non-data rows)`);
  console.log(`  Billonline: ${bo.bills.size} bills (skipped ${bo.skipped})`);
  console.log(`  CheckBill : ${cb.recs.size} reconcile rows (skipped ${cb.skipped})`);
  console.log(`  → merged  : ${billArr.length} unique bills · ${payArr.length} payments (Billonline added ${boAdded}, enriched ${boEnriched} notes)`);
  console.log(`  date range: ${dates[0]} … ${dates[dates.length - 1]}`);
  console.log(`  branches  : ${branchCodes.join(', ')}`);

  // Sanity: amount vs payment-parts sum (transfer+credit+cash+ewallet+gift+qr)
  let mismatch = 0;
  const sampleMis = [];
  for (const p of payArr) {
    const parts = p.cash + p.transfer + p.credit_card + p.ewallet + p.gift_voucher + p.qr_payment + p.arp_amount + p.commission_deduct;
    if (Math.abs(parts - p.amount) > 0.5) {
      mismatch++;
      if (sampleMis.length < 8) sampleMis.push(`${p.bill_no}: amount=${p.amount} parts=${parts}`);
    }
  }
  console.log(`\n── Sanity (amount vs Σ channels) ──`);
  console.log(`  mismatches: ${mismatch}/${payArr.length}` + (mismatch ? '  (channels not summing to Total — review below)' : '  ✓ all match'));
  sampleMis.forEach(s => console.log(`    ⚠ ${s}`));

  console.log('\n── Sample bill+payment (first 3) ──');
  billArr.slice(0, 3).forEach(b => {
    const p = pays.get(b.bill_no);
    console.log(`  ${b.bill_no} | ${b.sale_date} | ${b.member_code} ${b.member_name} | ฿${b.amount} | ${b.channel}/${b.branch}`);
    console.log(`     pay: cash=${p.cash} transfer=${p.transfer} credit=${p.credit_card} ewallet=${p.ewallet} qr=${p.qr_payment} comm=${p.commission_deduct} arp=${p.arp_amount} method=${p.payment_method || '-'}`);
  });
  console.log('\n── Sample reconcile (first 3) ──');
  recArr.slice(0, 3).forEach(r =>
    console.log(`  ${r.reconcile_date} | system ${r.system_count}฿${r.system_value} | counted ${r.bill_count}฿${r.bill_value} | remain ${r.remaining} | sig ${r.signature || '-'}`));

  console.log('\n── Preflight (required migrations live?) ──');
  await preflight();
  console.log('  ✓ daily_sale_payments.corrected/qr/comm/arp · bills.business_date/bill_type · reconcile ready');

  if (DRY_RUN) { console.log('\n✅ DRY RUN done — no data written. Remove DRY_RUN=1 to import.\n'); return; }

  console.log('\n── Writing to Supabase ──');
  await ensureBranches(branchCodes);
  console.log(`   branches ensured (${branchCodes.length})`);
  await upsert('daily_sale_bills', 'bill_no', billArr);
  await upsert('daily_sale_payments', 'bill_no', payArr);
  await upsert('daily_sale_reconcile', 'reconcile_date,branch', recArr);
  console.log('\n✅ Import complete.');
  console.log(`   ${billArr.length} bills · ${payArr.length} payments (corrected=true) · ${recArr.length} reconcile rows\n`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
