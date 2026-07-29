/**
 * set-sync-credentials.cjs — เปลี่ยนบัญชี answerforsuccess ที่ใช้ sync
 * ────────────────────────────────────────────────────────────
 * บัญชีเก็บเข้ารหัส (AES-GCM + master key) ในตาราง sync_config
 * ใช้ตอนบัญชีเดิมโดนระงับ/ลาออก แล้วต้องสลับไปใช้บัญชีอื่น
 *
 * ทำแบบเดียวกันผ่านหน้าเว็บได้ที่ CRM → ซิงค์สมาชิก (members-sync)
 * สคริปต์นี้มีไว้เผื่อเข้าหน้าเว็บไม่ได้ หรืออยากทำแบบ batch
 *
 * env:
 *   SB_URL, SB_SERVICE_KEY   Supabase ปลายทาง
 *   MASTER_KEY               master key ปัจจุบัน (ต้องตรงกับที่ใช้เข้ารหัสข้อมูลอื่น)
 *   AFS_USERNAME, AFS_PASSWORD   บัญชีใหม่
 *   DRY_RUN=1                แสดงอย่างเดียว ไม่เขียน
 *
 * รัน:  node scripts/set-sync-credentials.cjs
 */

const { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

const SALT = 'A4S-ERP-salt-v1';
const ITERS = 100000;

const SB_URL = (process.env.SB_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SB_SERVICE_KEY || '';
const MASTER_KEY = process.env.MASTER_KEY || '';
const USERNAME = process.env.AFS_USERNAME || '';
const PASSWORD = process.env.AFS_PASSWORD || '';
const DRY = process.env.DRY_RUN === '1';

if (!SB_URL || !SB_KEY || !MASTER_KEY || !USERNAME || !PASSWORD) {
  console.error('❌ ต้องมี SB_URL, SB_SERVICE_KEY, MASTER_KEY, AFS_USERNAME, AFS_PASSWORD');
  process.exit(1);
}

const key = pbkdf2Sync(MASTER_KEY, SALT, ITERS, 32, 'sha256');

function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
}
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

(async () => {
  /* ── ตรวจ master key ให้แน่ใจก่อนเขียนทับ ── */
  const cur = await (await fetch(`${SB_URL}/rest/v1/sync_config?id=eq.1&select=username_encrypted`, { headers: H })).json();
  const curBlob = cur?.[0]?.username_encrypted;
  if (curBlob) {
    try {
      console.log(`  บัญชีเดิม: ${decrypt(curBlob)}`);
    } catch {
      console.error('❌ MASTER_KEY ถอดค่าเดิมไม่ออก — คีย์ผิด ยกเลิกเพื่อกันข้อมูลเสียหาย');
      process.exit(1);
    }
  }

  console.log(`  บัญชีใหม่: ${USERNAME}`);
  if (DRY) { console.log('  [DRY_RUN] ไม่เขียนอะไร'); return; }

  const body = { username_encrypted: encrypt(USERNAME), password_encrypted: encrypt(PASSWORD) };
  const res = await fetch(`${SB_URL}/rest/v1/sync_config?id=eq.1`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error(`❌ update ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }

  /* ── อ่านกลับมาถอดรหัสยืนยัน ── */
  const back = await (await fetch(`${SB_URL}/rest/v1/sync_config?id=eq.1&select=username_encrypted,password_encrypted`, { headers: H })).json();
  const u = decrypt(back[0].username_encrypted);
  const pOk = decrypt(back[0].password_encrypted) === PASSWORD;
  console.log(`  ✅ บันทึกแล้ว — อ่านกลับได้: ${u} · รหัสผ่านตรง: ${pOk ? 'ใช่' : 'ไม่ใช่'}`);
  process.exit(u === USERNAME && pOk ? 0 : 1);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
