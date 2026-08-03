/**
 * drive-get-refresh-token.cjs — ขอ refresh token ของ a4scontent@gmail.com (ทำครั้งเดียว)
 * ────────────────────────────────────────────────────────────────────────────
 * ทำไมต้องมี: service account **เขียนลง My Drive ส่วนตัวไม่ได้** (SA ไม่มีโควต้าของตัวเอง
 * เขียนได้เฉพาะ Shared Drive) → พอย้ายไป My Drive ต้องยิง Drive API ในนาม a4scontent แทน
 *
 * scope = drive.file (ไม่ใช่ drive เต็ม) — เข้าถึงได้เฉพาะไฟล์ที่แอปนี้สร้างเอง
 *   → ไม่ต้องผ่าน Google verification, ตั้ง consent screen เป็น Production ได้เลย
 *   → ปลอดภัยกว่า: หลุดไปก็อ่านไฟล์ส่วนตัวอื่นใน Drive ไม่ได้
 *
 * ⚠️ ต้องใช้ OAuth client เดิมตลอดไป — drive.file ผูกสิทธิ์กับ client ID
 *    ถ้าสร้าง client ใหม่ จะอ่านไฟล์ที่ client เก่าอัปไว้ไม่ได้
 *
 * วิธีใช้:
 *   set GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
 *   set GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxx
 *   node scripts/drive-get-refresh-token.cjs
 *   → เปิดลิงก์ที่ขึ้นมา → ล็อกอินด้วย a4scontent@gmail.com → อนุญาต → ได้ refresh token
 */
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.argv[2] || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.argv[3] || '';
const PORT = 5175;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ต้องมี GOOGLE_OAUTH_CLIENT_ID และ GOOGLE_OAUTH_CLIENT_SECRET');
  console.error('  node scripts/drive-get-refresh-token.cjs <client_id> <client_secret>');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',      // ← ขอ refresh token
  prompt: 'consent',           // ← บังคับให้ออก refresh token ใหม่ทุกครั้ง
  state,
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (!u.searchParams.get('code')) { res.writeHead(404).end(); return; }
  if (u.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('state ไม่ตรง');
    return;
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: u.searchParams.get('code'),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const d = await r.json();
    if (!d.refresh_token) throw new Error(JSON.stringify(d).slice(0, 400));

    // ยืนยันว่าล็อกอินด้วยบัญชีถูกตัว
    const who = await (await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
      headers: { Authorization: `Bearer ${d.access_token}` },
    })).json();
    const email = who.user && who.user.emailAddress;
    const q = who.storageQuota || {};
    const GB = b => (Number(b || 0) / 1073741824).toFixed(2) + ' GB';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(`<h2>สำเร็จ — ปิดหน้านี้ได้เลย</h2><p>บัญชี: ${email}</p>`);

    console.log('\n──────────────────────────────────────────────');
    console.log('บัญชี      :', email);
    console.log('พื้นที่     :', GB(q.usageInDrive), 'ใช้ไป จาก', GB(q.limit), `(เหลือ ${GB(Number(q.limit || 0) - Number(q.usage || 0))})`);
    if (email !== 'a4scontent@gmail.com') console.log('⚠️  ไม่ใช่ a4scontent@gmail.com — รันใหม่แล้วเลือกบัญชีให้ถูก');
    console.log('\nGOOGLE_OAUTH_REFRESH_TOKEN=' + d.refresh_token);
    console.log('──────────────────────────────────────────────');
    console.log('เอา 3 ค่านี้ไปใส่ ai-proxy/.env และ Render env:');
    console.log('  GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN\n');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ผิดพลาด: ' + e.message);
    console.error('FAIL', e.message);
  }
  server.close();
});

server.listen(PORT, () => {
  console.log('เปิดลิงก์นี้ในเบราว์เซอร์ แล้วล็อกอินด้วย a4scontent@gmail.com:\n');
  console.log(authUrl + '\n');
  console.log('(รออยู่ที่ ' + REDIRECT + ' …)');
});
