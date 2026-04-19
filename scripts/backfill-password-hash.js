#!/usr/bin/env node
/* ============================================================
   backfill-password-hash.js — Populate password_hash for all members
   ไม่ง้อ browser — ทนต่อ refresh/reload และเร็วกว่า

   Usage (Windows PowerShell):
     $env:SB_URL="https://xxx.supabase.co"
     $env:SB_KEY="eyJxxx..."        # service_role หรือ anon (ถ้า RLS ยอม)
     $env:MASTER_KEY="passphrase"
     node scripts/backfill-password-hash.js

   Usage (macOS/Linux):
     SB_URL=... SB_KEY=... MASTER_KEY=... node scripts/backfill-password-hash.js

   Flags (optional):
     DRY_RUN=1          ตรวจสอบเท่านั้น ไม่ patch DB
     BATCH_SIZE=500     จำนวน rows ต่อ batch (default 1000)
     LIMIT=5000         จำกัดจำนวนรวม (สำหรับ test)
   ============================================================ */

import { decrypt, hash } from './lib/crypto.js';

const SB_URL      = process.env.SB_URL;
const SB_KEY      = process.env.SB_KEY;
const MASTER_KEY  = process.env.MASTER_KEY;
const DRY_RUN     = process.env.DRY_RUN === '1';
const BATCH_SIZE  = parseInt(process.env.BATCH_SIZE, 10) || 1000;
const LIMIT       = parseInt(process.env.LIMIT, 10) || 0;  // 0 = no limit

if (!SB_URL || !SB_KEY || !MASTER_KEY) {
  console.error('❌ ต้องตั้ง env: SB_URL, SB_KEY, MASTER_KEY');
  process.exit(1);
}

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

const fmtNum = (n) => n.toLocaleString('en-US');
const fmtDuration = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [
    h ? `${h}h` : '',
    m ? `${m}m` : '',
    `${sec}s`,
  ].filter(Boolean).join(' ');
};

async function fetchTotal() {
  const res = await fetch(
    `${SB_URL}/rest/v1/members?password_encrypted=not.is.null&password_hash=is.null&select=member_code`,
    { headers: { ...HEADERS, Prefer: 'count=exact', Range: '0-0' } },
  );
  const range = res.headers.get('content-range') || '*/0';
  return parseInt(range.split('/')[1], 10) || 0;
}

async function fetchBatch(limit) {
  const qs = `password_encrypted=not.is.null&password_hash=is.null&select=member_code,password_encrypted&limit=${limit}&order=member_code.asc`;
  const res = await fetch(`${SB_URL}/rest/v1/members?${qs}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function patchHash(memberCode, hashHex) {
  const res = await fetch(
    `${SB_URL}/rest/v1/members?member_code=eq.${encodeURIComponent(memberCode)}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ password_hash: hashHex }),
    },
  );
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}

async function main() {
  const startedAt = Date.now();
  console.log('');
  console.log('🔁 Backfill password_hash');
  console.log('─────────────────────────────────────────');
  console.log(`SB_URL:     ${SB_URL}`);
  console.log(`MASTER_KEY: ****${MASTER_KEY.slice(-3)}`);
  console.log(`DRY_RUN:    ${DRY_RUN ? 'yes (no DB writes)' : 'no'}`);
  console.log(`BATCH_SIZE: ${BATCH_SIZE}`);
  if (LIMIT) console.log(`LIMIT:      ${LIMIT}`);
  console.log('─────────────────────────────────────────');

  // Verify master key by decrypting a sample
  console.log('');
  console.log('🔑 Verifying master key...');
  const sampleBatch = await fetchBatch(1);
  if (!sampleBatch.length) {
    console.log('✅ ไม่มี row ที่ต้อง backfill — ทุกคนมี hash แล้ว');
    return;
  }
  try {
    const sample = await decrypt(sampleBatch[0].password_encrypted, MASTER_KEY);
    if (!sample) throw new Error('decrypt returned empty');
    console.log(`✅ Master key OK (sample decrypted: ${sample.length} chars)`);
  } catch (e) {
    console.error(`❌ Master key ผิด — decrypt failed: ${e.message}`);
    process.exit(1);
  }

  const total = await fetchTotal();
  const target = LIMIT ? Math.min(total, LIMIT) : total;
  console.log('');
  console.log(`📊 รวม ${fmtNum(total)} rows ที่ต้อง backfill`);
  if (LIMIT) console.log(`   (จำกัดรอบนี้ที่ ${fmtNum(LIMIT)})`);
  console.log('');

  let done = 0, ok = 0, fail = 0;
  const batchErrors = [];

  while (true) {
    if (LIMIT && done >= LIMIT) break;

    const remaining = LIMIT ? Math.min(BATCH_SIZE, LIMIT - done) : BATCH_SIZE;
    const rows = await fetchBatch(remaining);
    if (!rows.length) break;

    const batchStart = Date.now();
    for (const m of rows) {
      try {
        const plain = decrypt(m.password_encrypted, MASTER_KEY);
        if (!plain) { fail++; }
        else {
          const h = hash(plain);
          if (!DRY_RUN) await patchHash(m.member_code, h);
          ok++;
        }
      } catch (e) {
        fail++;
        if (batchErrors.length < 5) batchErrors.push({ member_code: m.member_code, error: e.message });
      }
      done++;
    }

    const batchMs = Date.now() - batchStart;
    const elapsed = Date.now() - startedAt;
    const avg = elapsed / done;
    const etaMs = avg * (target - done);
    const pct = target ? ((done / target) * 100).toFixed(1) : '?';
    process.stdout.write(
      `\r⏳ ${fmtNum(done)}/${fmtNum(target)} (${pct}%) · ok=${fmtNum(ok)} fail=${fail} · batch=${batchMs}ms · eta=${fmtDuration(etaMs)}   `,
    );
  }

  const totalMs = Date.now() - startedAt;
  console.log('');
  console.log('');
  console.log('─────────────────────────────────────────');
  console.log(`${fail ? '⚠️' : '✅'} Done in ${fmtDuration(totalMs)}`);
  console.log(`   ok:   ${fmtNum(ok)}`);
  console.log(`   fail: ${fmtNum(fail)}`);
  if (DRY_RUN) console.log(`   (DRY_RUN — ไม่ได้เขียน DB จริง)`);
  if (batchErrors.length) {
    console.log('   First errors:');
    batchErrors.forEach((e) => console.log(`     - ${e.member_code}: ${e.error}`));
  }
  console.log('─────────────────────────────────────────');
}

main().catch((e) => {
  console.error('');
  console.error('❌ Fatal:', e.message || e);
  process.exit(1);
});
