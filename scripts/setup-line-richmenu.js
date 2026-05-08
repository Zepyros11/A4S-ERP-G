#!/usr/bin/env node
/* ============================================================
   setup-line-richmenu.js — สร้าง / แทนที่ rich menu ของ A4S-Bot-Assistant
   ปุ่ม "ผูกบัญชี" จะส่ง postback action=link_start ให้ webhook

   Usage (Windows PowerShell):
     $env:LINE_CHANNEL_TOKEN="eyJxxx..."     # long-lived token ของ Bot-Assistant
     node scripts/setup-line-richmenu.js path/to/menu.png

   Layout (2500 x 1686, 2 ปุ่ม):
     ┌────────────────┬────────────────┐
     │   ผูกบัญชี      │   ติดต่อแอดมิน  │
     │ (postback)     │ (uri tel:)     │
     └────────────────┴────────────────┘

   ถ้ามีรูปอยู่แล้ว: ใช้พาธรูปจริง (PNG/JPEG, อัตราส่วน 2500x1686 หรือ 2500x843)
   ถ้ายังไม่มี: ใช้ตัวอย่างเปล่าก็ได้ — ปุ่มยังคลิกได้แม้ไม่มีพื้นหลังสวย
   ============================================================ */

import fs from 'node:fs';

const TOKEN = process.env.LINE_CHANNEL_TOKEN;
const IMG_PATH = process.argv[2];
const ADMIN_TEL = process.env.ADMIN_TEL || '0800000000'; // เปลี่ยนเป็นเบอร์ admin จริง

if (!TOKEN) {
  console.error('❌ ต้องตั้ง env LINE_CHANNEL_TOKEN');
  console.error('   $env:LINE_CHANNEL_TOKEN="..." (long-lived token Bot-Assistant)');
  process.exit(1);
}

// ── Rich menu definition ──
const richMenu = {
  size: { width: 2500, height: 843 },   // half-height bar (ดูสะดวก ไม่บังแชท)
  selected: false,
  name: 'A4S Main Menu v1',
  chatBarText: 'เมนู',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 1250, height: 843 },
      action: { type: 'postback', label: 'ผูกบัญชี', data: 'action=link_start', displayText: 'ผูกบัญชี' },
    },
    {
      bounds: { x: 1250, y: 0, width: 1250, height: 843 },
      action: { type: 'uri', label: 'ติดต่อแอดมิน', uri: `tel:${ADMIN_TEL}` },
    },
  ],
};

async function _api(path, opts = {}) {
  const res = await fetch(`https://api.line.me${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': opts.body && !(opts.body instanceof Buffer) ? 'application/json' : 'image/png',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function _apiUploadImage(richMenuId, buf, contentType) {
  // ต้องใช้ data endpoint แยก
  const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': contentType },
    body: buf,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`upload image → ${res.status} ${t}`);
  }
}

async function main() {
  console.log('1. ลบ rich menu เก่า (ถ้ามี)...');
  const list = await _api('/v2/bot/richmenu/list', { method: 'GET' });
  for (const m of list?.richmenus || []) {
    if (m.name?.startsWith('A4S Main Menu')) {
      await _api(`/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' });
      console.log(`   ✓ ลบ ${m.richMenuId} (${m.name})`);
    }
  }

  console.log('2. สร้าง rich menu ใหม่...');
  const created = await _api('/v2/bot/richmenu', {
    method: 'POST',
    body: JSON.stringify(richMenu),
  });
  const richMenuId = created.richMenuId;
  console.log(`   ✓ richMenuId = ${richMenuId}`);

  if (IMG_PATH) {
    if (!fs.existsSync(IMG_PATH)) {
      console.error(`   ❌ ไม่พบไฟล์ภาพ: ${IMG_PATH}`);
      process.exit(1);
    }
    console.log(`3. อัปโหลดภาพพื้นหลัง: ${IMG_PATH}`);
    const buf = fs.readFileSync(IMG_PATH);
    const ct = IMG_PATH.toLowerCase().endsWith('.jpg') || IMG_PATH.toLowerCase().endsWith('.jpeg')
      ? 'image/jpeg' : 'image/png';
    await _apiUploadImage(richMenuId, buf, ct);
    console.log('   ✓ อัปโหลดสำเร็จ');
  } else {
    console.log('3. ⚠️  ข้ามการอัปโหลดภาพ — ส่ง path เป็น arg เพื่ออัปโหลด');
    console.log('       node scripts/setup-line-richmenu.js path/to/menu.png');
  }

  console.log('4. ตั้งเป็น default rich menu สำหรับทุก user...');
  await _api(`/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
  console.log('   ✓ ตั้งเป็น default แล้ว');

  console.log('\n✅ เสร็จสิ้น');
  console.log(`   richMenuId: ${richMenuId}`);
  console.log('   ทดสอบ: เปิดแชท Bot-Assistant → กดปุ่ม "ผูกบัญชี" → bot ตอบ ask_id template');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
