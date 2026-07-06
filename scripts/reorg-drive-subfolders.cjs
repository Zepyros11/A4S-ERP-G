/**
 * reorg-drive-subfolders.cjs — จัดไฟล์ใน Drive เข้า nested subfolder (bucket/category)
 * ────────────────────────────────────────────────────────────
 * เป้าหมายโครงสร้าง:
 *   uploads/product-images/products/
 *   uploads/event-files/{posters,slips,documents,fb-posts,places,campaigns}/
 *
 * ไล่จาก root + product-images + event-files → ย้ายไฟล์เข้า nested folder ตาม prefix ชื่อไฟล์
 * move ไม่เปลี่ยน file id → URL /drive/file/{id} เดิมใช้ได้ต่อ · idempotent (รันซ้ำได้)
 *
 * รัน:
 *   DRY_RUN=1 node scripts/reorg-drive-subfolders.cjs
 *   node scripts/reorg-drive-subfolders.cjs
 */

const fs = require('fs');
const path = require('path');
const proxyEnv = path.join(__dirname, '..', 'ai-proxy', '.env');
if (fs.existsSync(proxyEnv)) {
  fs.readFileSync(proxyEnv, 'utf8').split('\n').forEach((line) => {
    const [k, ...rest] = line.split('=');
    if (k && rest.length && !process.env[k.trim()]) process.env[k.trim()] = rest.join('=').trim();
  });
}
const drive = require('../ai-proxy/drive');
const DRY_RUN = process.env.DRY_RUN === '1';
const FOLDER = 'application/vnd.google-apps.folder';

/* ชื่อไฟล์ → nested folder ปลายทาง (bucket/category) */
function targetOf(name) {
  const s = (name || '').split('/').filter(Boolean);
  if (s[0] === 'event-files' && s.length >= 3) return `event-files/${s[1]}`;   // event-files/posters ฯลฯ
  if (s[0] === 'products' || s[0] === 'product-images') return 'product-images/products';
  return null; // event-files/<file> ตรงๆ (เช่น qr) หรือไม่รู้จัก → ปล่อยไว้
}

async function main() {
  if (!drive.isConfigured()) { console.error('❌ Drive ยังไม่ตั้งค่า'); process.exit(1); }
  console.log(`\n🗂️  Reorg → nested subfolders  ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}\n`);

  // scan: root + 2 bucket folders (ที่ไฟล์อยู่ตอนนี้)
  const bases = ['', 'product-images', 'event-files'];
  const jobs = [];   // { id, name, fromParent, target }
  const unknown = [];
  for (const base of bases) {
    let folderId;
    try { folderId = base ? await drive.ensureSubfolder(base) : drive.ROOT_FOLDER_ID; }
    catch { continue; }
    const items = await drive.listFolder(folderId);
    for (const f of items) {
      if (f.mimeType === FOLDER) continue;
      const target = targetOf(f.name || '');
      if (!target) { unknown.push(f.name); continue; }
      jobs.push({ id: f.id, name: f.name, fromParent: folderId, target });
    }
  }

  const plan = {};
  jobs.forEach(j => { plan[j.target] = (plan[j.target] || 0) + 1; });
  console.log(`ไฟล์ที่จะจัด: ${jobs.length}`);
  Object.entries(plan).sort().forEach(([k, v]) => console.log(`   → ${k} : ${v}`));
  if (unknown.length) console.log(`   ⚠️ ปล่อยไว้ (ไม่มี category): ${unknown.length}`);
  console.log('');

  if (DRY_RUN) { console.log('[dry] ไม่ย้าย — เอา DRY_RUN ออกเพื่อย้ายจริง\n'); return; }

  let moved = 0, noop = 0, failed = 0, tested = false;
  for (const j of jobs) {
    try {
      const r = await drive.moveFile(j.id, j.target, j.fromParent);
      if (r.status === 304) noop++;
      else if (r.ok) moved++;
      else {
        failed++;
        if (!tested) {
          console.error(`\n❌ move ไม่สำเร็จ (status ${r.status}) — Content manager อาจย้ายไม่ได้`);
          console.error('   ทางแก้: เปลี่ยน service account เป็น "ผู้จัดการ (Manager)" ใน Manage members แล้วรันใหม่\n');
          process.exit(1);
        }
      }
    } catch (e) { failed++; console.warn(`  ⚠️ ${j.name}: ${e.message}`); }
    tested = true;
    if (moved && moved % 25 === 0) console.log(`  moved ${moved}...`);
  }

  console.log('\n──────── สรุป ────────');
  console.log(`  ย้ายสำเร็จ  : ${moved}`);
  console.log(`  อยู่ที่แล้ว : ${noop}`);
  console.log(`  ล้มเหลว    : ${failed}`);
  console.log(`  ปล่อยไว้   : ${unknown.length}`);
  console.log('──────────────────────');
  console.log('ℹ️ file id ไม่เปลี่ยน → URL เดิมใช้ได้ทั้งหมด\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
