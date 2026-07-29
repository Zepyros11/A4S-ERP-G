/**
 * rekey-master-key.cjs — เปลี่ยน Master Key แล้วเข้ารหัสข้อมูลเดิมใหม่ทั้งหมด
 * ────────────────────────────────────────────────────────────
 * ใช้ตอนต้องเปลี่ยน master key (เช่น คีย์เดิมเป็นข้อมูลส่วนตัวของคน หรือคีย์รั่ว)
 * ดู docs/MIGRATION-2026-08.md
 *
 * ทำงานกับไฟล์ CSV ที่ dump มาจาก psql (ไม่ยิง REST ทีละแถว — 115k แถวจะช้ามาก)
 *   1) psql \copy  ตาราง → in.csv
 *   2) สคริปต์นี้    in.csv → out.csv   (ถอดคีย์เก่า → เข้ารหัสคีย์ใหม่)
 *   3) psql \copy  out.csv → staging table → UPDATE ... FROM
 *
 * ปลอดภัย:
 *   - idempotent — ลองถอดด้วยคีย์ใหม่ก่อน ถ้าได้ = ทำไปแล้ว → ปล่อยค่าเดิม
 *   - แถวที่ถอดไม่ออกด้วยคีย์ไหนเลย → คงค่าเดิมไว้ ไม่เขียนทับ + บันทึกลง .skipped
 *   - ไม่ลบ ไม่แก้อะไรนอกจากคอลัมน์ที่ระบุ
 *
 * ใช้:
 *   OLD_KEY=xxx NEW_KEY=yyy node scripts/rekey-master-key.cjs in.csv out.csv col1[,col2...]
 *   (คอลัมน์แรกของ CSV ต้องเป็น primary key เสมอ — ไม่ถูกแตะ)
 */

const fs = require('fs');
const { pbkdf2Sync, createDecipheriv, createCipheriv, randomBytes } = require('node:crypto');

const SALT = 'A4S-ERP-salt-v1';
const ITERS = 100000;

const OLD_KEY = process.env.OLD_KEY || '';
const NEW_KEY = process.env.NEW_KEY || '';
const [inFile, outFile, colsArg] = process.argv.slice(2);

if (!OLD_KEY || !NEW_KEY || !inFile || !outFile || !colsArg) {
  console.error('ใช้: OLD_KEY=.. NEW_KEY=.. node rekey-master-key.cjs <in.csv> <out.csv> <col1,col2>');
  process.exit(1);
}
if (OLD_KEY === NEW_KEY) { console.error('❌ OLD_KEY เท่ากับ NEW_KEY'); process.exit(1); }

const oldK = pbkdf2Sync(OLD_KEY, SALT, ITERS, 32, 'sha256');
const newK = pbkdf2Sync(NEW_KEY, SALT, ITERS, 32, 'sha256');

function decrypt(b64, key) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 29) throw new Error('too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
function encrypt(plain, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}

/* ── CSV แบบง่าย (psql csv: คั่น , · ครอบ " · escape "" ) ── */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const csvCell = (s) => (s === null || s === undefined ? '' : `"${String(s).replace(/"/g, '""')}"`);

const cols = colsArg.split(',').map((s) => s.trim()).filter(Boolean);
const rows = parseCsv(fs.readFileSync(inFile, 'utf8')).filter((r) => r.length >= cols.length + 1);

const stat = { total: 0, rekeyed: 0, already: 0, empty: 0, failed: 0 };
const skipped = [];
const out = [];

for (const r of rows) {
  stat.total++;
  const pk = r[0];
  const newVals = [];
  for (let i = 0; i < cols.length; i++) {
    const val = r[i + 1];
    if (!val) { newVals.push(''); stat.empty++; continue; }
    try {
      decrypt(val, newK);           // ถอดด้วยคีย์ใหม่ได้ = ทำไปแล้ว
      newVals.push(val); stat.already++; continue;
    } catch { /* ยังไม่ได้ทำ — ไปต่อ */ }
    try {
      newVals.push(encrypt(decrypt(val, oldK), newK));
      stat.rekeyed++;
    } catch (e) {
      newVals.push(val);           // ถอดไม่ออกทั้งสองคีย์ → คงของเดิม
      stat.failed++;
      skipped.push(`${pk},${cols[i]},${e.message}`);
    }
  }
  out.push([pk, ...newVals].map(csvCell).join(','));
}

fs.writeFileSync(outFile, out.join('\n') + '\n');
if (skipped.length) fs.writeFileSync(outFile + '.skipped', skipped.join('\n') + '\n');

console.log(`  แถวทั้งหมด ${stat.total}`);
console.log(`  เข้ารหัสใหม่ ${stat.rekeyed} · ทำไปแล้ว(ข้าม) ${stat.already} · ว่าง ${stat.empty} · ถอดไม่ออก ${stat.failed}`);
if (skipped.length) console.log(`  ⚠️ รายการที่ถอดไม่ออกอยู่ใน ${outFile}.skipped (ค่าเดิมไม่ถูกแตะ)`);
process.exit(0);
