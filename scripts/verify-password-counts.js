#!/usr/bin/env node
/* ============================================================
   verify-password-counts.js — เช็คยอดจริงใน members table
   ============================================================ */

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;

if (!SB_URL || !SB_KEY) {
  console.error('❌ ต้องตั้ง env: SB_URL, SB_KEY');
  process.exit(1);
}

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  Prefer: 'count=exact',
  Range: '0-0',
};

async function count(filter, label) {
  const url = `${SB_URL}/rest/v1/members?select=member_code${filter ? '&' + filter : ''}`;
  const res = await fetch(url, { headers: HEADERS });
  const range = res.headers.get('content-range') || '*/0';
  const n = parseInt(range.split('/')[1], 10) || 0;
  console.log(`  ${label.padEnd(50)} ${n.toLocaleString('en-US').padStart(10)}`);
  return n;
}

async function main() {
  console.log('');
  console.log('🔍 Verify password counts');
  console.log('─────────────────────────────────────────────────────────────────');

  const total      = await count('',                                                          'total members');
  const hasHash    = await count('password_hash=not.is.null',                                 'มี password_hash');
  const noHash     = await count('password_hash=is.null',                                     'ไม่มี password_hash');
  const hasEnc     = await count('password_encrypted=not.is.null',                            'มี password_encrypted');
  const noEnc      = await count('password_encrypted=is.null',                                'ไม่มี password_encrypted');
  const needBack   = await count('password_encrypted=not.is.null&password_hash=is.null',      'ต้อง backfill (มี enc แต่ไม่มี hash)');
  const bothNull   = await count('password_encrypted=is.null&password_hash=is.null',          'ไม่มี password เลย (NULL ทั้งคู่)');
  const onlyHash   = await count('password_encrypted=is.null&password_hash=not.is.null',      'มี hash อย่างเดียว (ไม่มี enc)');

  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('📐 ตรวจสอบสมการ:');
  console.log(`   hasHash + noHash = ${(hasHash + noHash).toLocaleString()} (ควรเท่า total ${total.toLocaleString()})  ${hasHash + noHash === total ? '✅' : '❌'}`);
  console.log(`   hasEnc  + noEnc  = ${(hasEnc + noEnc).toLocaleString()} (ควรเท่า total ${total.toLocaleString()})  ${hasEnc + noEnc === total ? '✅' : '❌'}`);
  console.log('');

  if (needBack > 0) {
    console.log(`⚠️  ยังเหลือ ${needBack.toLocaleString()} rows ที่ต้อง backfill — ลอง run script ใหม่`);
  } else {
    console.log(`✅ ทุก row ที่มี password_encrypted ได้ hash ครบแล้ว`);
  }
}

main().catch((e) => {
  console.error('❌ Fatal:', e.message || e);
  process.exit(1);
});
