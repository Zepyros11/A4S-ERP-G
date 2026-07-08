/**
 * reorg-tour-seat-drive.cjs — รวมโฟลเดอร์ tour-seat-images ที่ซ้ำ + จัดไฟล์เข้า nested subfolder
 * ────────────────────────────────────────────────────────────
 * ปัญหา: migration (local) + proxy (Render) สร้างโฟลเดอร์ "tour-seat-images" คนละอัน (Drive ยอมชื่อซ้ำ)
 *   - โฟลเดอร์ migration : ไฟล์ flat ชื่อ "tour-seat-images/passport/xxx.jpeg"
 *   - โฟลเดอร์ proxy      : มี subfolder passport/ ซ้อน (ไฟล์ชื่อสะอาด)
 *
 * ทำ: เลือก canonical 1 อัน → ย้ายไฟล์ทุกอันเข้า canonical/{category} → trash โฟลเดอร์ซ้ำ/subfolder ว่าง
 *   category = passport | visa | visa-pdf | ticket (จากชื่อไฟล์ที่มี prefix หรือจากชื่อ subfolder แม่)
 *   move ไม่เปลี่ยน file id → URL /drive/file/{id} เดิมใช้ได้ต่อ · idempotent
 *
 * รัน:
 *   DRY_RUN=1 node scripts/reorg-tour-seat-drive.cjs
 *   node scripts/reorg-tour-seat-drive.cjs
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
const BUCKET = 'tour-seat-images';
const CATS = ['passport', 'visa-pdf', 'visa', 'ticket'];   // exact-segment match (visa-pdf ≠ visa)

function catOf(name, parentFolderName) {
  const segs = (name || '').split('/').filter(Boolean);
  for (const seg of segs) if (CATS.includes(seg)) return seg;
  if (CATS.includes(parentFolderName)) return parentFolderName;
  return null;
}

async function main() {
  if (!drive.isConfigured()) { console.error('❌ Drive ยังไม่ตั้งค่า'); process.exit(1); }
  console.log(`\n🗂️  Reorg tour-seat-images (merge dupes + nest)  ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}\n`);

  // 1) หา tour-seat-images ทุกอันใต้ root
  const rootItems = await drive.listFolder(drive.ROOT_FOLDER_ID);
  const tsFolders = rootItems.filter((f) => f.mimeType === FOLDER && f.name === BUCKET);
  if (!tsFolders.length) { console.log('ไม่พบโฟลเดอร์ tour-seat-images'); return; }
  // canonical = อันที่ ensureSubfolder resolve (ให้ตรงกับปลายทาง moveFile กันย้ายไปผิดอัน)
  const canonical = await drive.ensureSubfolder(BUCKET);
  console.log(`พบโฟลเดอร์ "${BUCKET}" : ${tsFolders.length} อัน  (canonical=${canonical})`);
  tsFolders.forEach((f) => console.log(`   [${f.id === canonical ? 'canonical' : 'dupe'}] ${f.id}`));
  console.log('');

  // 2) รวบไฟล์จากทุกโฟลเดอร์ (flat + subfolder 1 ชั้น)
  const jobs = [];      // { id, name, fromParent, cat }
  const unknown = [];
  const emptyFolderIds = [];   // subfolder/dupe ที่ควร trash หลังย้าย
  for (const ts of tsFolders) {
    const items = await drive.listFolder(ts.id);
    for (const f of items) {
      if (f.mimeType === FOLDER) {
        // subfolder เช่น passport/ → ไล่ไฟล์ข้างใน (cat = ชื่อ subfolder)
        const sub = await drive.listFolder(f.id);
        for (const sf of sub) {
          if (sf.mimeType === FOLDER) continue;
          const cat = catOf(sf.name, f.name);
          if (!cat) { unknown.push(sf.name); continue; }
          jobs.push({ id: sf.id, name: sf.name, fromParent: f.id, cat });
        }
        emptyFolderIds.push(f.id);   // subfolder เดิม (จะว่างหลังย้าย)
      } else {
        const cat = catOf(f.name, ts.name);
        if (!cat) { unknown.push(f.name); continue; }
        jobs.push({ id: f.id, name: f.name, fromParent: ts.id, cat });
      }
    }
    if (ts.id !== canonical) emptyFolderIds.push(ts.id);   // โฟลเดอร์ซ้ำ (จะว่างหลังย้าย)
  }

  const plan = {};
  jobs.forEach((j) => { plan[`${BUCKET}/${j.cat}`] = (plan[`${BUCKET}/${j.cat}`] || 0) + 1; });
  console.log(`ไฟล์ที่จะจัด: ${jobs.length}`);
  Object.entries(plan).sort().forEach(([k, v]) => console.log(`   → ${k} : ${v}`));
  if (unknown.length) console.log(`   ⚠️ ปล่อยไว้ (ไม่รู้ category): ${unknown.length} · ${unknown.slice(0, 3).join(', ')}`);
  console.log(`โฟลเดอร์ที่จะ trash หลังย้าย (ถ้าว่าง): ${emptyFolderIds.length}`);
  console.log('');

  if (DRY_RUN) { console.log('[dry] ไม่ย้าย/ไม่ลบ — เอา DRY_RUN ออกเพื่อทำจริง\n'); return; }

  // 3) ย้ายไฟล์เข้า canonical/{cat}
  let moved = 0, noop = 0, failed = 0, tested = false;
  for (const j of jobs) {
    try {
      const r = await drive.moveFile(j.id, `${BUCKET}/${j.cat}`, j.fromParent);
      if (r.status === 304) noop++;
      else if (r.ok) moved++;
      else {
        failed++;
        if (!tested) {
          console.error(`\n❌ move ไม่สำเร็จ (status ${r.status}) — service account อาจไม่มีสิทธิ์ย้าย`);
          process.exit(1);
        }
      }
    } catch (e) { failed++; console.warn(`  ⚠️ ${j.name}: ${e.message}`); }
    tested = true;
    if (moved && moved % 25 === 0) console.log(`  moved ${moved}...`);
  }

  // 4) trash โฟลเดอร์ที่ว่างแล้ว (ตรวจว่าว่างจริงก่อน กันลบไฟล์)
  let trashed = 0;
  for (const fid of emptyFolderIds) {
    try {
      const left = await drive.listFolder(fid);
      const files = left.filter((x) => x.mimeType !== FOLDER);
      if (files.length) { console.warn(`  ⚠️ ข้าม trash ${fid} (ยังมีไฟล์ ${files.length})`); continue; }
      const r = await drive.deleteFile(fid);   // = trash
      if (r.ok) trashed++;
    } catch (e) { console.warn(`  ⚠️ trash ${fid}: ${e.message}`); }
  }

  console.log('\n──────── สรุป ────────');
  console.log(`  ย้ายสำเร็จ   : ${moved}`);
  console.log(`  อยู่ที่แล้ว  : ${noop}`);
  console.log(`  ล้มเหลว     : ${failed}`);
  console.log(`  trash โฟลเดอร์ว่าง : ${trashed}`);
  console.log(`  ปล่อยไว้    : ${unknown.length}`);
  console.log('──────────────────────');
  console.log('ℹ️ file id ไม่เปลี่ยน → URL เดิมใช้ได้ทั้งหมด\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
