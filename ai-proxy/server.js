/**
 * AI Proxy Server — Passport OCR
 * ใช้สำหรับ check-seat.html
 *
 * รัน:  node server.js
 * หรือ: ANTHROPIC_API_KEY=sk-ant-xxx node server.js
 */

const express  = require('express');
const cors     = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

/* ── Load .env ─────────────────────────────────────────── */
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

/* ── Config ────────────────────────────────────────────── */
const PORT    = process.env.PORT || 3001;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/* OCR (Anthropic) is optional — only needed for /extract endpoint.
   LINE endpoints work without it. */
const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;
const app    = express();

app.use(cors({ origin: '*' }));
// Capture raw body for LINE webhook signature verification
app.use(express.json({
  limit: '20mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

/* ── Health check ──────────────────────────────────────── */
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'AI Proxy running ✅' });
});

/* ── Passport OCR Endpoint ─────────────────────────────── */
app.post('/extract', async (req, res) => {
  if (!client) {
    return res.status(503).json({ error: 'OCR ยังไม่เปิดใช้ — ตั้ง ANTHROPIC_API_KEY ก่อน' });
  }
  const { imageBase64, mediaType } = req.body;

  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'ต้องส่ง imageBase64 และ mediaType' });
  }

  try {
    console.log(`[${new Date().toLocaleTimeString()}] OCR request — ${mediaType}`);

    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',   // ถูก + เร็ว เหมาะกับ OCR
      max_tokens: 256,
      messages: [{
        role:    'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `You are a passport OCR assistant.
Extract the following fields from this passport image:
1. Passport number (the alphanumeric ID, e.g. AA1234567)
2. Expiry date in YYYY-MM-DD format

Respond with ONLY a JSON object, no explanation:
{"id": "<passport_number>", "exp": "<YYYY-MM-DD>"}

If you cannot read a field, use null for that field.`,
          },
        ],
      }],
    });

    const text = message.content[0].text.trim();
    console.log(`[${new Date().toLocaleTimeString()}] Result: ${text}`);

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI ไม่ส่งผลลัพธ์เป็น JSON');
    const result = JSON.parse(jsonMatch[0]);

    res.json(result);

  } catch (err) {
    // แสดง error จาก Anthropic ให้ชัดเจน
    const detail = err?.error?.error?.message || err?.message || 'Unknown error';
    console.error('OCR Error:', detail);
    console.error('Full error:', JSON.stringify(err?.error || err, null, 2));
    res.status(500).json({ error: detail });
  }
});

/* ══════════════════════════════════════════════════════════
   LINE Messaging API Proxy
   Browser can't call api.line.me directly (no CORS). This
   proxy forwards requests with the Channel Access Token
   provided in each request body (token stays in HTTPS traffic).
   ══════════════════════════════════════════════════════════ */

async function _forwardToLine(url, token, body, res) {
  try {
    const lineRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await lineRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!lineRes.ok) {
      console.error(`[LINE] ${url} → ${lineRes.status}:`, text.slice(0, 200));
      return res.status(lineRes.status).json({
        ok: false,
        status: lineRes.status,
        error: data.message || data.raw || `LINE API ${lineRes.status}`,
        details: data.details || null,
      });
    }
    console.log(`[LINE ✅] ${url} — sent`);
    return res.json({ ok: true, ...data });
  } catch (err) {
    console.error(`[LINE ❌] ${url}:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function _validateLineBody(req, res, { needTo = false, multi = false }) {
  const { token, to, messages } = req.body || {};
  if (!token) { res.status(400).json({ ok: false, error: 'missing token' }); return null; }
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ ok: false, error: 'missing messages[]' });
    return null;
  }
  if (messages.length > 5) {
    res.status(400).json({ ok: false, error: 'LINE อนุญาตสูงสุด 5 messages ต่อครั้ง' });
    return null;
  }
  if (needTo) {
    if (multi) {
      if (!Array.isArray(to) || !to.length) {
        res.status(400).json({ ok: false, error: 'missing to[]' });
        return null;
      }
      if (to.length > 500) {
        res.status(400).json({ ok: false, error: 'multicast รองรับ <= 500 ต่อครั้ง' });
        return null;
      }
    } else {
      if (!to || typeof to !== 'string') {
        res.status(400).json({ ok: false, error: 'missing to (userId)' });
        return null;
      }
    }
  }
  return { token, to, messages };
}

/* ── Push to single user ── */
app.post('/line/push', async (req, res) => {
  const v = _validateLineBody(req, res, { needTo: true });
  if (!v) return;
  await _forwardToLine(
    'https://api.line.me/v2/bot/message/push',
    v.token,
    { to: v.to, messages: v.messages },
    res,
  );
});

/* ── Multicast to up to 500 userIds ── */
app.post('/line/multicast', async (req, res) => {
  const v = _validateLineBody(req, res, { needTo: true, multi: true });
  if (!v) return;
  await _forwardToLine(
    'https://api.line.me/v2/bot/message/multicast',
    v.token,
    { to: v.to, messages: v.messages },
    res,
  );
});

/* ── Broadcast to all friends of the OA ── */
app.post('/line/broadcast', async (req, res) => {
  const v = _validateLineBody(req, res, { needTo: false });
  if (!v) return;
  await _forwardToLine(
    'https://api.line.me/v2/bot/message/broadcast',
    v.token,
    { messages: v.messages },
    res,
  );
});

/* ══════════════════════════════════════════════════════════
   LINE Webhook — receive events from LINE Platform
   Update member_line_accounts.last_active_at when user interacts
   (useful for picking the "current" LINE account when sending)
   ══════════════════════════════════════════════════════════ */

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_TOKEN  = process.env.LINE_CHANNEL_TOKEN || '';       // Bot-Assistant long-lived token (for webhook replies)
const SB_URL_WEBHOOK      = (process.env.SB_URL || '').replace(/\/+$/, '');
const SB_SERVICE_KEY      = process.env.SB_SERVICE_KEY || '';

function _verifyLineSignature(req) {
  if (!LINE_CHANNEL_SECRET) return { ok: false, reason: 'LINE_CHANNEL_SECRET not set' };
  const signature = req.get('x-line-signature') || '';
  if (!signature) return { ok: false, reason: 'missing x-line-signature header' };
  const expected = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(req.rawBody || '')
    .digest('base64');
  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok: match, expected, received: signature };
}

async function _sbPatch(table, query, body) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SB_URL_WEBHOOK}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`[webhook SB PATCH ${table}] ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`[webhook SB PATCH ${table}] ${e.message}`);
    return false;
  }
}

async function _sbGet(table, query) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SB_URL_WEBHOOK}/rest/v1/${table}?${query}`, {
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    if (!res.ok) { console.warn(`[webhook SB GET ${table}] ${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.warn(`[webhook SB GET ${table}] ${e.message}`);
    return null;
  }
}

/* ── Verify session helpers ── */
const SESSION_TTL_MIN = 5;
const MAX_ATTEMPTS = 3;
const BLOCK_MIN = 30;

// Noise filter: ข้อความสั้นมาก หรือเลขซ้ำตัวเดียว ("555", "5555", "7777") = หัวเราะ/สแปม
// ใช้เพื่อ "ไม่นับเป็น failed attempt" ตอนอยู่ในโหมดรอ password
function _looksLikeNoise(text) {
  if (!text) return true;
  const t = String(text).trim();
  if (t.length < 3) return true;
  if (/^(\d)\1+$/.test(t)) return true; // 555, 5555, 55555, 7777, 0000
  return false;
}

// Trigger keywords: เริ่ม flow ผูกบัญชีจากข้อความ (ทำงานคู่กับ rich menu postback)
// ต้องมีคำว่า "Line" ต่อท้ายเสมอ เพื่อกัน user พิมพ์ "ลงทะเบียน" / "ผูก" โดยไม่ตั้งใจ
function _isLinkTrigger(text) {
  if (!text) return false;
  const t = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  return t === 'ลงทะเบียน line' || t === 'ผูก line';
}

// SHA-256 hex (same scheme as ERPCrypto.hash in js/core/crypto.js)
function _sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

async function _getSession(uid) {
  const rows = await _sbGet(
    'line_verify_sessions',
    `line_user_id=eq.${encodeURIComponent(uid)}&select=*&limit=1`,
  );
  return rows?.[0] || null;
}

async function _setSession(uid, data) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return false;
  try {
    const res = await fetch(
      `${SB_URL_WEBHOOK}/rest/v1/line_verify_sessions?on_conflict=line_user_id`,
      {
        method: 'POST',
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ line_user_id: uid, ...data }),
      },
    );
    if (!res.ok) console.warn('[session upsert]', res.status);
    return res.ok;
  } catch (e) { console.warn('[session upsert]', e.message); return false; }
}

async function _clearSession(uid) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return;
  try {
    await fetch(
      `${SB_URL_WEBHOOK}/rest/v1/line_verify_sessions?line_user_id=eq.${encodeURIComponent(uid)}`,
      { method: 'DELETE', headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` } },
    );
  } catch (e) { console.warn('[session clear]', e.message); }
}

async function _sbUpdateUserLine({ userRowId, userId, displayName, pictureUrl }) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return false;
  const nowIso = new Date().toISOString();
  return _sbPatch(
    'users',
    `user_id=eq.${encodeURIComponent(userRowId)}`,
    {
      line_user_id: userId,
      line_display_name: displayName || null,
      line_picture_url: pictureUrl || null,
      line_linked_at: nowIso,
    },
  );
}

async function _fetchLineGroupSummary(groupId) {
  if (!LINE_CHANNEL_TOKEN || !groupId) return null;
  try {
    const r = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_TOKEN}` },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.warn(`[group summary] ${r.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    return r.json();   // { groupId, groupName, pictureUrl }
  } catch (e) {
    console.warn('[group summary]', e.message);
    return null;
  }
}

async function _sbUpsertLineGroup(groupId, fields) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) {
    console.warn('[upsert line_group] SKIPPED — SB_URL or SB_SERVICE_KEY not set in Render env');
    return false;
  }
  try {
    const payload = { group_id: groupId, ...fields };
    const r = await fetch(
      `${SB_URL_WEBHOOK}/rest/v1/line_groups?on_conflict=group_id`,
      {
        method: 'POST',
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error(`[upsert line_group] FAILED status=${r.status} body=${errText.slice(0, 400)} payload=${JSON.stringify(payload).slice(0, 200)}`);
      return false;
    }
    console.log(`[upsert line_group] OK group=${groupId.slice(0, 12)}... fields=${Object.keys(fields).join(',')}`);
    return true;
  } catch (e) {
    console.error('[upsert line_group] EXCEPTION', e.message);
    return false;
  }
}

async function _sbUpsertTestMemberLine({ memberCode, userId, displayName, pictureUrl }) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return false;
  const nowIso = new Date().toISOString();
  return _sbPatch(
    'test_members',
    `member_code=eq.${encodeURIComponent(memberCode)}`,
    {
      line_user_id: userId,
      line_display_name: displayName || null,
      line_picture_url: pictureUrl || null,
      line_linked_at: nowIso,
    },
  );
}

async function _sbUpsertMemberLine({ memberCode, userId, displayName, pictureUrl }) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return false;
  const nowIso = new Date().toISOString();
  // 1) Upsert history row
  try {
    const r1 = await fetch(
      `${SB_URL_WEBHOOK}/rest/v1/member_line_accounts?on_conflict=member_code,line_user_id`,
      {
        method: 'POST',
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          member_code: memberCode,
          line_user_id: userId,
          line_display_name: displayName || null,
          line_picture_url: pictureUrl || null,
          last_active_at: nowIso,
          is_active: true,
          source: 'webhook',
        }),
      },
    );
    if (!r1.ok) console.warn('[webhook] upsert mla failed:', r1.status);
  } catch (e) { console.warn('[webhook] upsert mla error:', e.message); }

  // 2) Update members (primary/current)
  await _sbPatch(
    'members',
    `member_code=eq.${encodeURIComponent(memberCode)}`,
    {
      line_user_id: userId,
      line_display_name: displayName || null,
      line_picture_url: pictureUrl || null,
      line_linked_at: nowIso,
    },
  );
  return true;
}

async function _lineReply(replyToken, text) {
  if (!LINE_CHANNEL_TOKEN || !replyToken) return false;
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text: String(text).slice(0, 5000) }],
      }),
    });
    if (!r.ok) console.warn('[webhook] reply failed:', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.warn('[webhook] reply error:', e.message);
    return false;
  }
}

async function _getLineProfile(userId) {
  if (!LINE_CHANNEL_TOKEN || !userId) return null;
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_TOKEN}` },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

/* ── Reply template loader (DB-backed with 60s cache) ── */
const DEFAULT_TEMPLATES = {
  group_joined:
    '✅ ผูกกลุ่มกับระบบ A4S-ERP สำเร็จ\n\n' +
    '📢 พร้อมส่ง promote กิจกรรมเข้ากลุ่มนี้แล้ว — ตั้งกำหนดการได้ที่หน้า "ตารางโพสต์ LINE"',
  welcome:
    'ยินดีต้อนรับสู่ A4S 🎉\n\n' +
    '🔗 พิมพ์ "ลงทะเบียน Line" เพื่อเริ่มผูก LINE กับระบบ\n' +
    '   (สมาชิก = รับแจ้งเตือน event / พนักงาน = แจ้งเตือนภายในองค์กร)',
  ask_id:
    '🔗 ผูกบัญชี LINE กับระบบ A4S\n\n' +
    '📱 สมาชิก: พิมพ์ "รหัสสมาชิก" (ตัวเลข 5-6 หลัก)\n' +
    '👤 พนักงาน: พิมพ์ "username" ของคุณ\n\n' +
    'ตัวอย่าง: 10271 หรือ somchai\n' +
    '⏱ หมดเวลาภายใน 5 นาที\n' +
    '💬 พิมพ์ "ยกเลิก" เพื่อออก',
  password_hint:
    '💡 ระบบรอ "รหัสผ่าน" เพื่อยืนยันตัวตน\n' +
    'พิมพ์รหัสผ่านที่ใช้ login ERP\n' +
    'หรือพิมพ์ "ยกเลิก" เพื่อออก',
  invalid_code:
    '❌ ไม่พบข้อมูลนี้ในระบบ\n\n' +
    '• สมาชิก: ตัวเลข 5-6 หลัก\n' +
    '• พนักงาน: username ที่ใช้ login ERP\n\n' +
    'หากไม่ทราบข้อมูล ติดต่อแอดมิน',
  linked_member:
    '✅ ผูก LINE สำเร็จ!\n\nสมาชิก: {name}\nรหัส: {code}\n\n' +
    '🔔 จากนี้คุณจะได้รับแจ้งเตือน event และข้อมูลสำคัญทาง LINE',
  linked_staff:
    '✅ ผูก LINE พนักงานสำเร็จ!\n\nชื่อ: {name}\nUsername: {username}\nRole: {role}\n\n' +
    '🔔 คุณจะได้รับแจ้งเตือนภายในองค์กรผ่าน LINE',
  staff_inactive: '⚠️ บัญชีพนักงานนี้ถูกปิดใช้งาน — ติดต่อแอดมิน',
};

let _tplCache = null;   // { key: text }
let _tplCacheAt = 0;
const TPL_TTL_MS = 60_000;

async function _loadTemplates() {
  const now = Date.now();
  if (_tplCache && now - _tplCacheAt < TPL_TTL_MS) return _tplCache;
  try {
    const rows = await _sbGet('line_reply_templates', 'select=key,text');
    if (Array.isArray(rows) && rows.length) {
      const map = {};
      rows.forEach((r) => { if (r.key) map[r.key] = r.text || ''; });
      _tplCache = { ...DEFAULT_TEMPLATES, ...map };
      _tplCacheAt = now;
      return _tplCache;
    }
  } catch (e) { console.warn('[tpl load]', e.message); }
  _tplCache = { ...DEFAULT_TEMPLATES };
  _tplCacheAt = now;
  return _tplCache;
}

function _fillTemplate(text, vars) {
  if (!text) return '';
  let out = String(text);
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.split(`{${k}}`).join(v ?? '');
  }
  return out;
}

async function _tpl(key, vars) {
  const all = await _loadTemplates();
  return _fillTemplate(all[key] || DEFAULT_TEMPLATES[key] || '', vars);
}

app.post('/line/webhook', async (req, res) => {
  const verify = _verifyLineSignature(req);
  if (!verify.ok) {
    console.warn('[LINE webhook] signature invalid:', verify.reason || 'mismatch');
    return res.status(200).json({ ok: false, error: verify.reason || 'invalid signature' });
  }

  const events = req.body?.events || [];
  const nowIso = new Date().toISOString();

  for (const ev of events) {
    // === GROUP/ROOM events (no userId required) ===
    const groupId = ev?.source?.groupId || ev?.source?.roomId;
    if (groupId) {
      // ALWAYS log groupId — ทำให้ admin หา groupId ได้จาก Render logs ได้ง่าย
      console.log(`[LINE webhook] event=${ev.type} groupId=${groupId}`);
      try {
        // leave: bot was removed → mark inactive
        if (ev.type === 'leave') {
          console.log(`[LINE webhook] leave group ${groupId.slice(0, 10)}...`);
          await _sbPatch(
            'line_groups',
            `group_id=eq.${encodeURIComponent(groupId)}`,
            { is_active: false },
          );
          continue;
        }
        // join (or any other event in group) → upsert + ensure active
        // ใช้ upsert เผื่อกรณี 'join' webhook พลาด (เช่น ตอน deploy ใหม่) — ทุก event ที่มี groupId จะ ensure row
        const fields = { last_seen_at: nowIso, is_active: true };
        if (ev.type === 'join') {
          fields.joined_at = nowIso;
          // Auto-fetch ชื่อกลุ่มจาก LINE API (เฉพาะตอน join เพื่อกัน rate limit)
          const summary = await _fetchLineGroupSummary(groupId);
          if (summary?.groupName) {
            fields.group_name = summary.groupName;
            console.log(`[LINE webhook] auto-fill group_name: ${summary.groupName}`);
          }
        }
        await _sbUpsertLineGroup(groupId, fields);
        if (ev.type === 'join') {
          console.log(`[LINE webhook] join group ${groupId.slice(0, 10)}...`);
          await _lineReply(ev.replyToken, await _tpl('group_joined'));
          continue;
        }
      } catch (e) {
        console.warn('[webhook group event]', ev.type, e.message);
      }
      // ไม่ต้อง handle register flow ในกลุ่ม — สมาชิก/พนักงานต้องลงทะเบียนผ่าน 1-on-1 chat กับ OA เท่านั้น
      // (กันกรณีคนพิมพ์ "555" หัวเราะ หรือเลขอื่นในกลุ่มแล้ว bot ไปตอบ "ไม่พบข้อมูลนี้ในระบบ")
      continue;
    }

    const uid = ev?.source?.userId;
    if (!uid) continue;

    try {
      // === FOLLOW event: user added OA as friend ===
      if (ev.type === 'follow') {
        console.log(`[LINE webhook] follow from ${uid.slice(0, 10)}...`);
        await _lineReply(ev.replyToken, await _tpl('welcome'));
        continue;
      }

      // === POSTBACK event (rich menu / template button) ===
      if (ev.type === 'postback') {
        const data = ev.postback?.data || '';
        console.log(`[LINE webhook] postback from ${uid.slice(0, 10)}... data="${data}"`);

        // Parse "key=value&key=value" style
        const params = new URLSearchParams(data);
        const action = params.get('action');

        if (action === 'link_start') {
          const now = new Date();
          const sess = await _getSession(uid);

          // ถ้าโดน block อยู่ → แจ้งและไม่เปิด session ใหม่
          if (sess?.blocked_until && new Date(sess.blocked_until) > now) {
            const mins = Math.max(1, Math.ceil((new Date(sess.blocked_until) - now) / 60000));
            await _lineReply(ev.replyToken, await _tpl('rate_limited', { minutes: mins }));
            continue;
          }

          const expiresAt = new Date(now.getTime() + SESSION_TTL_MIN * 60000).toISOString();
          await _setSession(uid, {
            pending_type: 'await_id',
            pending_id: null,
            attempts: 0,
            expires_at: expiresAt,
            blocked_until: null,
          });
          await _lineReply(ev.replyToken, await _tpl('ask_id'));
          continue;
        }

        if (action === 'cancel') {
          await _clearSession(uid);
          await _lineReply(ev.replyToken, await _tpl('cancelled'));
          continue;
        }

        // postback อื่น ๆ ที่ยังไม่รู้จัก → เงียบ
        continue;
      }

      // === MESSAGE event ===
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();
        console.log(`[LINE webhook] message from ${uid.slice(0, 10)}... len=${text.length}`);

        await _sbPatch(
          'member_line_accounts',
          `line_user_id=eq.${encodeURIComponent(uid)}`,
          { last_active_at: nowIso },
        );

        const now = new Date();
        const sess = await _getSession(uid);

        // ── Step 0: ถ้ายัง block อยู่ — ปฏิเสธก่อน ──
        if (sess?.blocked_until && new Date(sess.blocked_until) > now) {
          const mins = Math.max(1, Math.ceil((new Date(sess.blocked_until) - now) / 60000));
          await _lineReply(ev.replyToken, await _tpl('rate_limited', { minutes: mins }));
          continue;
        }

        // ── Step 0.5: trigger keyword ("ลงทะเบียน"/"ผูก"/...) → เปิด await_id session ──
        // วางก่อน sessionAlive check เพื่อให้ user "เริ่มใหม่" ได้แม้มี session ค้าง
        if (_isLinkTrigger(text)) {
          const expiresAt = new Date(now.getTime() + SESSION_TTL_MIN * 60000).toISOString();
          await _setSession(uid, {
            pending_type: 'await_id',
            pending_id: null,
            attempts: 0,
            expires_at: expiresAt,
            blocked_until: null,
          });
          await _lineReply(ev.replyToken, await _tpl('ask_id'));
          continue;
        }

        // ── Step 1: มี session pending — รับ password (หรือ "ยกเลิก") ──
        const sessionAlive =
          sess?.pending_type && sess?.expires_at && new Date(sess.expires_at) > now;

        if (sessionAlive) {
          // user cancel
          if (text === 'ยกเลิก' || text.toLowerCase() === 'cancel') {
            await _clearSession(uid);
            await _lineReply(ev.replyToken, await _tpl('cancelled'));
            continue;
          }

          // ── await_id mode: รอรหัสสมาชิก/username (เริ่มจาก postback "ผูกบัญชี") ──
          if (sess.pending_type === 'await_id') {
            // กรอง noise: เลขซ้ำ/ข้อความสั้น → ส่ง hint ซ้ำ ไม่ปิด session
            if (_looksLikeNoise(text)) {
              await _lineReply(ev.replyToken, await _tpl('ask_id'));
              continue;
            }

            const expiresAt = new Date(now.getTime() + SESSION_TTL_MIN * 60000).toISOString();

            // Branch A: digits 3-8 → member (prefer real members, fallback to test_members for QA)
            const codeMatch = text.match(/^(\d{3,8})$/);
            if (codeMatch) {
              const memberCode = codeMatch[1];
              const cols = 'member_code,full_name,member_name,password_hash';
              const [members, testMembers] = await Promise.all([
                _sbGet('members', `member_code=eq.${encodeURIComponent(memberCode)}&select=${cols}&limit=1`),
                _sbGet('test_members', `member_code=eq.${encodeURIComponent(memberCode)}&select=${cols}&limit=1`).catch(() => []),
              ]);
              const member = members?.[0] || testMembers?.[0];
              const isTest = !members?.[0] && !!testMembers?.[0];
              if (!member) {
                await _lineReply(ev.replyToken, await _tpl('invalid_code'));
                continue;
              }
              if (!member.password_hash) {
                await _lineReply(ev.replyToken, await _tpl('no_password_set'));
                continue;
              }
              await _setSession(uid, {
                pending_type: isTest ? 'test_member' : 'member',
                pending_id: memberCode,
                attempts: 0,
                expires_at: expiresAt,
                blocked_until: null,
              });
              await _lineReply(
                ev.replyToken,
                await _tpl('ask_password_member', {
                  name: member.full_name || member.member_name || memberCode,
                  code: memberCode,
                }),
              );
              continue;
            }

            // Branch B: text → staff username
            const usernameMatch = text.match(/^[A-Za-z0-9_.\-]{2,40}$/);
            if (usernameMatch) {
              const username = text.toLowerCase();
              const users = await _sbGet(
                'users',
                `username=ilike.${encodeURIComponent(username)}&select=user_id,username,full_name,role,is_active,password,password_hash&limit=1`,
              );
              const user = users?.[0];
              if (!user) {
                await _lineReply(ev.replyToken, await _tpl('invalid_code'));
                continue;
              }
              if (user.is_active === false) {
                await _lineReply(ev.replyToken, await _tpl('staff_inactive'));
                continue;
              }
              if (!user.password_hash && !user.password) {
                await _lineReply(ev.replyToken, await _tpl('no_password_set'));
                continue;
              }
              await _setSession(uid, {
                pending_type: 'staff',
                pending_id: String(user.user_id),
                attempts: 0,
                expires_at: expiresAt,
                blocked_until: null,
              });
              await _lineReply(
                ev.replyToken,
                await _tpl('ask_password_staff', {
                  name: user.full_name || user.username,
                  username: user.username,
                }),
              );
              continue;
            }

            // ใน await_id mode แต่ format ไม่เข้า → ส่ง hint อีกครั้ง
            await _lineReply(ev.replyToken, await _tpl('ask_id'));
            continue;
          }

          // ── password mode: noise filter ก่อนนับ failed attempt ──
          if (
            (sess.pending_type === 'member' || sess.pending_type === 'test_member' || sess.pending_type === 'staff') &&
            _looksLikeNoise(text)
          ) {
            await _lineReply(ev.replyToken, await _tpl('password_hint'));
            continue;
          }

          if (sess.pending_type === 'member' || sess.pending_type === 'test_member') {
            const sourceTable = sess.pending_type === 'test_member' ? 'test_members' : 'members';
            const members = await _sbGet(
              sourceTable,
              `member_code=eq.${encodeURIComponent(sess.pending_id)}&select=member_code,full_name,member_name,password_hash,line_user_id&limit=1`,
            );
            const member = members?.[0];
            if (!member) {
              await _clearSession(uid);
              await _lineReply(ev.replyToken, await _tpl('invalid_code'));
              continue;
            }
            const match = !!member.password_hash && _sha256Hex(text) === member.password_hash;
            if (match) {
              const profile = await _getLineProfile(uid);
              if (sess.pending_type === 'test_member') {
                await _sbUpsertTestMemberLine({
                  memberCode: member.member_code,
                  userId: uid,
                  displayName: profile?.displayName || null,
                  pictureUrl: profile?.pictureUrl || null,
                });
              } else {
                await _sbUpsertMemberLine({
                  memberCode: member.member_code,
                  userId: uid,
                  displayName: profile?.displayName || null,
                  pictureUrl: profile?.pictureUrl || null,
                });
              }
              await _clearSession(uid);
              const name = member.full_name || member.member_name || member.member_code;
              await _lineReply(
                ev.replyToken,
                await _tpl('linked_member', { name, code: member.member_code }),
              );
            } else {
              const attempts = (sess.attempts || 0) + 1;
              if (attempts >= MAX_ATTEMPTS) {
                const blockedUntil = new Date(now.getTime() + BLOCK_MIN * 60000).toISOString();
                await _setSession(uid, {
                  pending_type: null, pending_id: null,
                  attempts: 0, expires_at: null, blocked_until: blockedUntil,
                });
                await _lineReply(ev.replyToken, await _tpl('rate_limited', { minutes: BLOCK_MIN }));
              } else {
                await _setSession(uid, { attempts });
                await _lineReply(
                  ev.replyToken,
                  await _tpl('wrong_password', { attempts_left: MAX_ATTEMPTS - attempts }),
                );
              }
            }
            continue;
          }

          if (sess.pending_type === 'staff') {
            const users = await _sbGet(
              'users',
              `user_id=eq.${encodeURIComponent(sess.pending_id)}&select=user_id,username,full_name,role,is_active,password,password_hash&limit=1`,
            );
            const user = users?.[0];
            if (!user) {
              await _clearSession(uid);
              await _lineReply(ev.replyToken, await _tpl('invalid_code'));
              continue;
            }
            if (user.is_active === false) {
              await _clearSession(uid);
              await _lineReply(ev.replyToken, await _tpl('staff_inactive'));
              continue;
            }
            const hashMatch = !!user.password_hash && _sha256Hex(text) === user.password_hash;
            const plainMatch = !user.password_hash && user.password && text === user.password;
            if (hashMatch || plainMatch) {
              const profile = await _getLineProfile(uid);
              await _sbUpdateUserLine({
                userRowId: user.user_id,
                userId: uid,
                displayName: profile?.displayName || null,
                pictureUrl: profile?.pictureUrl || null,
              });
              await _clearSession(uid);
              await _lineReply(
                ev.replyToken,
                await _tpl('linked_staff', {
                  name: user.full_name || user.username,
                  username: user.username,
                  role: user.role || '',
                }),
              );
            } else {
              const attempts = (sess.attempts || 0) + 1;
              if (attempts >= MAX_ATTEMPTS) {
                const blockedUntil = new Date(now.getTime() + BLOCK_MIN * 60000).toISOString();
                await _setSession(uid, {
                  pending_type: null, pending_id: null,
                  attempts: 0, expires_at: null, blocked_until: blockedUntil,
                });
                await _lineReply(ev.replyToken, await _tpl('rate_limited', { minutes: BLOCK_MIN }));
              } else {
                await _setSession(uid, { attempts });
                await _lineReply(
                  ev.replyToken,
                  await _tpl('wrong_password', { attempts_left: MAX_ATTEMPTS - attempts }),
                );
              }
            }
            continue;
          }
        }

        // ── Step 2: session หมดอายุแล้ว (แต่ยังมี record) → ล้าง ──
        if (sess?.pending_type && sess?.expires_at && new Date(sess.expires_at) <= now) {
          await _clearSession(uid);
        }

        // ── Step 3: ไม่มี session active → เงียบ ──
        // การผูก LINE ต้องเริ่มจาก postback "ผูกบัญชี" (rich menu) เท่านั้น
        // เพื่อกัน "555/หัวเราะ" หรือเลขสุ่มอื่น ๆ ไป trigger flow ผูกบัญชีโดยไม่ตั้งใจ
        continue;
      }

      // === Other events (sticker, image, etc.) — just update last_active ===
      await _sbPatch(
        'member_line_accounts',
        `line_user_id=eq.${encodeURIComponent(uid)}`,
        { last_active_at: nowIso },
      );
    } catch (e) {
      console.error('[webhook event error]', ev.type, e.message);
    }
  }

  return res.status(200).json({ ok: true, events: events.length });
});

/* ── Force-reload templates (call after UI saves a template) ── */
app.post('/line/templates/reload', async (_req, res) => {
  _tplCache = null;
  _tplCacheAt = 0;
  const tpls = await _loadTemplates();
  return res.json({ ok: true, keys: Object.keys(tpls) });
});

/* ── Get LINE group summary (groupName, pictureUrl) — for UI auto-fill ── */
app.post('/line/group-summary', async (req, res) => {
  const { groupId } = req.body || {};
  if (!groupId) return res.status(400).json({ ok: false, error: 'missing groupId' });
  if (!LINE_CHANNEL_TOKEN) return res.status(503).json({ ok: false, error: 'LINE_CHANNEL_TOKEN not set' });
  const summary = await _fetchLineGroupSummary(groupId);
  if (!summary) return res.status(404).json({ ok: false, error: 'group not found / bot not in group / no permission' });
  return res.json({ ok: true, ...summary });
});

/* ── Diagnostic — เช็คว่า env + table + permissions พร้อมส่ง LINE หรือไม่ ── */
app.get('/line/diag', async (_req, res) => {
  const result = {
    server_time: new Date().toISOString(),
    env: {
      SB_URL: !!SB_URL_WEBHOOK,
      SB_SERVICE_KEY: !!SB_SERVICE_KEY,
      LINE_CHANNEL_SECRET: !!LINE_CHANNEL_SECRET,
      LINE_CHANNEL_TOKEN: !!LINE_CHANNEL_TOKEN,
      CRON_SECRET: !!CRON_SECRET,
    },
    tables: {},
  };

  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) {
    result.error = 'SB_URL or SB_SERVICE_KEY not set in Render env vars';
    return res.json(result);
  }

  // เช็คว่าตารางมีอยู่ไหม (lookup _คอลัมน์_ count via PostgREST HEAD-like)
  const checkTable = async (table) => {
    try {
      const r = await fetch(`${SB_URL_WEBHOOK}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`,
        },
      });
      if (r.ok) {
        const rows = await r.json().catch(() => []);
        return { exists: true, status: r.status, rows: Array.isArray(rows) ? rows.length : 0 };
      }
      const errText = await r.text().catch(() => '');
      let parsed = {};
      try { parsed = JSON.parse(errText); } catch {}
      return {
        exists: false,
        status: r.status,
        error: parsed.message || errText.slice(0, 300),
        hint: r.status === 404 || (parsed.message || '').includes('does not exist')
          ? 'ตารางยังไม่มี — รัน migration sql/051_line_promote.sql ใน Supabase SQL Editor'
          : null,
      };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  };

  result.tables.line_groups = await checkTable('line_groups');
  result.tables.line_scheduled_posts = await checkTable('line_scheduled_posts');
  result.tables.line_channels = await checkTable('line_channels');
  result.tables.events = await checkTable('events');

  // สรุปสถานะ
  const allTablesOk = Object.values(result.tables).every((t) => t.exists);
  const allEnvOk = result.env.SB_URL && result.env.SB_SERVICE_KEY && result.env.LINE_CHANNEL_TOKEN;
  result.ready_for_webhook_insert = allTablesOk && allEnvOk;
  result.ready_for_cron_send = result.ready_for_webhook_insert;

  if (!result.ready_for_webhook_insert) {
    const issues = [];
    if (!result.env.SB_URL) issues.push('SB_URL env missing');
    if (!result.env.SB_SERVICE_KEY) issues.push('SB_SERVICE_KEY env missing');
    if (!result.env.LINE_CHANNEL_TOKEN) issues.push('LINE_CHANNEL_TOKEN env missing');
    Object.entries(result.tables).forEach(([t, info]) => {
      if (!info.exists) issues.push(`table "${t}" missing — ${info.hint || info.error || 'unknown'}`);
    });
    result.issues = issues;
  }

  return res.json(result);
});

/* ── Get OA info (bot name, picture) — quick health check ── */
app.post('/line/info', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'missing token' });
  try {
    const r = await fetch('https://api.line.me/v2/bot/info', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, ...data });
    return res.json({ ok: true, ...data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ── Get LINE message quota + consumption (this month) ──────
   Uses server-side LINE_CHANNEL_TOKEN env (same OA used by cron sender),
   so frontend doesn't need to pass token — matches what scheduler actually consumes.
   GET /line/quota → { ok, type, value (limit), totalUsage, remaining, percent }
   ─────────────────────────────────────────────────────────── */
app.get('/line/quota', async (_req, res) => {
  if (!LINE_CHANNEL_TOKEN) {
    return res.status(503).json({ ok: false, error: 'LINE_CHANNEL_TOKEN not configured' });
  }
  try {
    const headers = { Authorization: `Bearer ${LINE_CHANNEL_TOKEN}` };
    const [qRes, cRes] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers }),
    ]);
    const q = await qRes.json().catch(() => ({}));
    const c = await cRes.json().catch(() => ({}));
    if (!qRes.ok) return res.status(qRes.status).json({ ok: false, source: 'quota', ...q });
    if (!cRes.ok) return res.status(cRes.status).json({ ok: false, source: 'consumption', ...c });

    const type = q.type || 'none';                    // 'none' | 'limited'
    const value = type === 'limited' ? (q.value || 0) : null;   // null = unlimited
    const totalUsage = c.totalUsage || 0;
    const remaining = value == null ? null : Math.max(0, value - totalUsage);
    const percent = value && value > 0 ? Math.min(100, Math.round((totalUsage / value) * 100)) : null;

    return res.json({ ok: true, type, value, totalUsage, remaining, percent });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   Scheduled Notifications (cron-driven)
   ──────────────────────────────────────────────────────────
   POST /cron/notifications
     Triggered every ~15 min by GitHub Actions.
     Reads notification_rules where schedule_anchor IS NOT NULL,
     finds events/bookings whose anchor time matches "now ± 15 min",
     resolves staff targets, sends LINE multicast, logs.

   Limitation: Uses LINE_CHANNEL_TOKEN env var (single OA) for ALL
   scheduled sends — rule.channel_id is ignored because per-channel
   tokens are encrypted with browser-side master key (not available here).
   ══════════════════════════════════════════════════════════ */

const CRON_WINDOW_MIN = 15;
const CRON_SECRET = process.env.CRON_SECRET || '';

function _bangkokNow() {
  const d = new Date();
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = bkk.getUTCFullYear();
  const mm = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(bkk.getUTCDate()).padStart(2, '0');
  const hh = bkk.getUTCHours();
  const min = bkk.getUTCMinutes();
  return {
    date: `${yyyy}-${mm}-${dd}`,
    hh, mm: min,
    totalMinutes: hh * 60 + min,
    iso: `${yyyy}-${mm}-${dd}T${String(hh).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+07:00`,
  };
}

function _addDays(yyyymmdd, days) {
  const [y, m, d] = String(yyyymmdd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function _formatDMY(yyyymmdd) {
  if (!yyyymmdd) return '';
  const m = String(yyyymmdd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return yyyymmdd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function _renderTpl(template, payload) {
  if (!template) return '';
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const v = payload?.[key];
    return v == null ? '' : String(v);
  });
}

// ตรวจว่า want time (HH:MM) อยู่ใน window [now, now-windowMin) ของวันนั้น
function _timeInWindow(wantTimeStr, now, windowMin) {
  if (!wantTimeStr) return false;
  const m = String(wantTimeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const wantMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  // fire if now ∈ [wantMin, wantMin + windowMin)
  return now.totalMinutes >= wantMin && now.totalMinutes < wantMin + windowMin;
}

async function _resolveRuleTargets(rule) {
  const type = rule.target_type;
  const values = Array.isArray(rule.target_value) ? rule.target_value : [];
  if (!values.length) return [];

  let filter = '';
  if (type === 'role') {
    const list = values.map(v => encodeURIComponent(v)).join(',');
    filter = `role=in.(${list})`;
  } else if (type === 'group') {
    const list = values.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',');
    filter = `notification_groups=ov.{${list}}`;
  } else if (type === 'user') {
    const ids = values.filter(v => v != null).join(',');
    if (!ids) return [];
    filter = `user_id=in.(${ids})`;
  } else {
    return [];
  }

  // คืน user ทุกคนที่ตรง rule (รวมคนที่ยังไม่ผูก LINE) — ฝั่ง LINE callsite filter line_user_id เอง
  // เพื่อให้ inbox (user_notifications) ได้ row ของทุกคน ไม่ใช่เฉพาะคนผูก LINE
  const rows = await _sbGet('users',
    `select=user_id,line_user_id&is_active=eq.true&${filter}`);
  return rows || [];
}

/* ── In-app inbox (user_notifications) ──
   เขียน 1 row ต่อ recipient — สำหรับกระดิ่งใน topbar + หน้า inbox
   เรียกจาก /ibd/notify และ _processRule (cron) หลัง LINE multicast
*/
function _titleForTrigger(triggerKey, payload) {
  // หัวข้อสั้น 1 บรรทัดสำหรับแสดงใน list (ไม่เกิน ~80 ตัวอักษร)
  const p = payload || {};
  switch (triggerKey) {
    case 'ibd.complaint.created':
      return `📋 IBD: Complaint ใหม่ — ${p.member_name || p.member_code || '—'}`;
    case 'ibd.ewallet.created':
      return `💳 IBD: คำขอโอน E-Wallet — ${p.member_full_name || p.member_code || '—'}`;
    case 'ibd.relocation.created':
      return `🌐 IBD: คำขอย้ายฐาน — ${p.member_name || p.member_code || '—'} (${p.from_country_label || ''}→${p.to_country_label || ''})`;
    case 'event.confirmed':
      return `📌 Event ยืนยันแล้ว — ${p.event_name || p.event_code || '—'}`;
    case 'event.scheduled':
      return `⏰ Event ใกล้ถึง — ${p.event_name || p.event_code || '—'}`;
    case 'booking.approved':
      return `🏢 จองห้องอนุมัติแล้ว — ${p.room_name || p.request_code || '—'}`;
    case 'booking.scheduled':
      return `⏰ Booking ใกล้ถึง — ${p.room_name || p.request_code || '—'}`;
    case 'booking.before_start':
      return `⏰ Booking กำลังจะเริ่ม — ${p.room_name || p.request_code || '—'}`;
    case 'daily.event_booking_summary':
      return `📊 สรุปงาน ${p.date || ''} — ${p.total_events||0} events + ${p.total_bookings||0} bookings`;
    default:
      return `🔔 ${triggerKey}`;
  }
}

function _linkForTrigger(triggerKey) {
  // path สำหรับเปิดเมื่อคลิก notification (relative path — frontend prepend BASE_PATH)
  if (triggerKey.startsWith('ibd.complaint'))  return '/modules/ibd/ibd-complaints.html';
  if (triggerKey.startsWith('ibd.ewallet'))    return '/modules/ibd/ibd-ewallet.html';
  if (triggerKey.startsWith('ibd.relocation')) return '/modules/ibd/ibd-relocation.html';
  if (triggerKey.startsWith('event.'))         return '/modules/event/events.html';
  if (triggerKey.startsWith('booking.'))       return '/modules/event/booking-room.html';
  if (triggerKey.startsWith('daily.'))         return '/modules/event/events-dashboard.html';
  return '';
}

async function _writeInbox(rule, triggerKey, payload, body, recipients, refKey, refId) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return;
  if (!recipients?.length) return;
  const title = _titleForTrigger(triggerKey, payload);
  const link  = _linkForTrigger(triggerKey);
  const ref   = refId != null ? { [refKey]: refId } : null;
  const entries = recipients
    .filter(r => r.user_id != null)
    .map(r => ({
      user_id:     r.user_id,
      rule_id:     rule?.id || null,
      trigger_key: triggerKey,
      title,
      body:        body || '',
      link_url:    link,
      payload_ref: ref,
    }));
  if (!entries.length) return;
  try {
    await fetch(`${SB_URL_WEBHOOK}/rest/v1/user_notifications`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(entries),
    });
  } catch (e) {
    console.warn('[inbox]', e.message);
  }
}

async function _checkDedupe(ruleId, refKey, refId) {
  if (refId == null) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // PostgREST JSONB filter: payload_ref->>event_id=eq.123
  const rows = await _sbGet('notification_log',
    `select=id&rule_id=eq.${ruleId}&status=eq.sent&sent_at=gte.${encodeURIComponent(since)}&payload_ref->>${encodeURIComponent(refKey)}=eq.${encodeURIComponent(String(refId))}&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
}

async function _logBatch(rule, refKey, refId, recipients, status, error) {
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return;
  const payload_ref = refId != null ? { [refKey]: refId } : null;
  const entries = (recipients?.length ? recipients : [{ user_id: null, line_user_id: null }]).map(r => ({
    rule_id: rule.id,
    trigger_key: rule.trigger_key,
    payload_ref,
    recipient_user_id: r.user_id || null,
    recipient_line_id: r.line_user_id || null,
    channel_id: null,
    status,
    error: error || null,
  }));
  try {
    await fetch(`${SB_URL_WEBHOOK}/rest/v1/notification_log`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(entries),
    });
  } catch (e) {
    console.warn('[cron log]', e.message);
  }
}

async function _multicastViaCronToken(lineIds, text) {
  if (!LINE_CHANNEL_TOKEN) throw new Error('LINE_CHANNEL_TOKEN not set');
  if (!lineIds?.length) return;
  for (let i = 0; i < lineIds.length; i += 500) {
    const chunk = lineIds.slice(i, i + 500);
    const r = await fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: chunk,
        messages: [{ type: 'text', text: String(text).slice(0, 5000) }],
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text().catch(() => '');
      throw new Error(`LINE ${r.status}: ${errTxt.slice(0, 200)}`);
    }
  }
}

function _payloadFromEvent(rec) {
  return {
    event_id:        rec.event_id,
    event_code:      rec.event_code || '',
    event_name:      rec.event_name || '',
    event_type:      rec.event_type || '',
    event_date:      _formatDMY(rec.event_date),
    end_date:        _formatDMY(rec.end_date),
    location:        rec.location || '',
    attendees_count: rec.max_attendees || '',
    start_time:      (rec.start_time || '').slice(0, 5),
    end_time:        (rec.end_time || '').slice(0, 5),
  };
}

function _payloadFromBooking(rec) {
  return {
    request_id:     rec.request_id,
    request_code:   rec.request_code || '',
    room_name:      rec.room_name || '',
    place_name:     rec.place_name || '',
    booking_date:   _formatDMY(rec.booking_date),
    start_time:     (rec.start_time || '').slice(0, 5),
    end_time:       rec.end_time === 'ALLDAY' ? 'ทั้งวัน' : (rec.end_time || '').slice(0, 5),
    booked_by_name: rec.booked_by_name || '',
    cs_name:        rec.cs_name || '',
  };
}

async function _processRule(rule, now) {
  const offsetDays = rule.schedule_offset_days || 0;
  const offsetMin  = rule.schedule_offset_minutes || 0;
  const result = { rule_id: rule.id, sent: 0, skipped: 0, failed: 0, matched: 0, reason: null };

  // 1) เลือก records + เช็ค time window
  let records = [];
  let refKey;

  if (rule.schedule_anchor === 'event_date') {
    if (!_timeInWindow(rule.schedule_time, now, CRON_WINDOW_MIN)) {
      result.reason = 'time-window';
      return result;
    }
    // event_date = today - offset_days  (เช่น offset=-1 → event_date = today + 1)
    const targetDate = _addDays(now.date, -offsetDays);
    records = (await _sbGet('events',
      `select=*&event_date=eq.${targetDate}&status=eq.CONFIRMED`)) || [];
    refKey = 'event_id';
  } else if (rule.schedule_anchor === 'booking_date') {
    if (!_timeInWindow(rule.schedule_time, now, CRON_WINDOW_MIN)) {
      result.reason = 'time-window';
      return result;
    }
    const targetDate = _addDays(now.date, -offsetDays);
    records = (await _sbGet('room_booking_requests',
      `select=*&booking_date=eq.${targetDate}&status=eq.APPROVED`)) || [];
    refKey = 'request_id';
  } else if (rule.schedule_anchor === 'booking_start_time') {
    // วันที่อ้างอิง = today (offset_days อาจเป็น -1 ถ้าอยากเทียบเมื่อวาน)
    const targetDate = _addDays(now.date, -offsetDays);
    const all = (await _sbGet('room_booking_requests',
      `select=*&booking_date=eq.${targetDate}&status=eq.APPROVED&start_time=not.is.null`)) || [];
    records = all.filter(b => {
      const m = String(b.start_time || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m) return false;
      const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const fireMin = startMin + offsetMin;  // offset อาจเป็น negative
      return fireMin >= now.totalMinutes && fireMin < now.totalMinutes + CRON_WINDOW_MIN;
    });
    refKey = 'request_id';
  } else if (rule.schedule_anchor === 'daily_summary') {
    // รวม events + bookings ของวัน → 1 record summary → 1 message
    if (!_timeInWindow(rule.schedule_time, now, CRON_WINDOW_MIN)) {
      result.reason = 'time-window';
      return result;
    }
    const targetDate = _addDays(now.date, -offsetDays);
    const events = (await _sbGet('events',
      `select=*&event_date=eq.${targetDate}&status=eq.CONFIRMED&order=start_time.asc.nullsfirst`)) || [];
    const bookings = (await _sbGet('room_booking_requests',
      `select=*&booking_date=eq.${targetDate}&status=eq.APPROVED&order=start_time.asc.nullsfirst`)) || [];

    if (!events.length && !bookings.length) {
      result.reason = 'empty day — skip';
      return result;
    }

    const fmtTime = (s) => (s ? String(s).slice(0, 5) : '');
    const eventList = events.length
      ? events.map(e => {
          const st = fmtTime(e.start_time);
          const et = fmtTime(e.end_time);
          const time = (st && et) ? `${st}-${et}` : (st || 'ทั้งวัน');
          const loc = e.location ? ` @ ${e.location}` : '';
          return `• ${time} | ${e.event_name || '-'}${loc}`;
        }).join('\n')
      : '(ไม่มี)';

    const bookingList = bookings.length
      ? bookings.map(b => {
          const st = fmtTime(b.start_time);
          const et = b.end_time === 'ALLDAY' ? 'ทั้งวัน' : fmtTime(b.end_time);
          const time = (st && et) ? `${st}-${et}` : (st || 'ทั้งวัน');
          const by = b.booked_by_name ? ` (${b.booked_by_name})` : '';
          return `• ${time} | ${b.room_name || '-'}${by}`;
        }).join('\n')
      : '(ไม่มี)';

    const summaryPayload = {
      date:               _formatDMY(targetDate),
      total_events:       events.length,
      total_bookings:     bookings.length,
      event_count_text:   events.length   ? `${events.length} events`     : '',
      booking_count_text: bookings.length ? `${bookings.length} bookings` : '',
      event_list:         eventList,
      booking_list:       bookingList,
    };

    // ใช้ targetDate เป็น refId → กันส่งซ้ำในวันเดียวกัน (ภายใน 24 ชม.)
    records = [{ summary_date: targetDate, _payload: summaryPayload }];
    refKey = 'summary_date';
  } else {
    result.reason = 'unknown anchor';
    return result;
  }

  result.matched = records.length;
  if (!records.length) return result;

  // 2) Resolve recipients ครั้งเดียว (ใช้ทุก record ของ rule นี้)
  const recipients = await _resolveRuleTargets(rule);
  if (!recipients.length) {
    result.reason = 'no recipients';
    for (const rec of records) {
      const refId = rec[refKey];
      const dup = await _checkDedupe(rule.id, refKey, refId);
      if (!dup) await _logBatch(rule, refKey, refId, [], 'skipped', 'no recipients');
      result.skipped++;
    }
    return result;
  }
  const lineRecipients = recipients.filter(r => r.line_user_id);
  const lineIds = lineRecipients.map(r => r.line_user_id);

  // 3) ส่งทีละ record (กัน dedupe + log แยก)
  for (const rec of records) {
    const refId = rec[refKey];
    if (await _checkDedupe(rule.id, refKey, refId)) {
      result.skipped++;
      continue;
    }
    const payload = rule.schedule_anchor === 'event_date'    ? _payloadFromEvent(rec)
                  : rule.schedule_anchor === 'daily_summary' ? rec._payload
                  : _payloadFromBooking(rec);
    const text = _renderTpl(rule.message_template, payload);
    try {
      if (lineIds.length) await _multicastViaCronToken(lineIds, text);
      // log only LINE recipients ใน notification_log (รักษา semantic เดิม)
      // แต่ inbox เขียน "ทุก" recipient (รวมคนยังไม่ผูก LINE)
      await _logBatch(rule, refKey, refId, lineRecipients, 'sent');
      await _writeInbox(rule, rule.trigger_key, payload, text, recipients, refKey, refId);
      result.sent += recipients.length;
    } catch (e) {
      await _logBatch(rule, refKey, refId, lineRecipients, 'failed', e.message);
      result.failed += recipients.length;
    }
  }
  return result;
}

app.post('/cron/notifications', async (req, res) => {
  // Optional shared-secret auth
  if (CRON_SECRET) {
    const got = req.get('x-cron-secret') || (req.body && req.body.secret) || '';
    if (got !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) {
    return res.status(503).json({ error: 'SB_URL/SB_SERVICE_KEY not configured' });
  }
  if (!LINE_CHANNEL_TOKEN) {
    return res.status(503).json({ error: 'LINE_CHANNEL_TOKEN not configured' });
  }

  const now = _bangkokNow();
  console.log(`[cron] notifications tick @ ${now.iso}`);

  const rules = await _sbGet('notification_rules',
    `select=*&is_active=eq.true&schedule_anchor=not.is.null`);
  if (!rules?.length) {
    return res.json({ ok: true, now: now.iso, processed: 0, message: 'no scheduled rules' });
  }

  const summary = { ok: true, now: now.iso, window_min: CRON_WINDOW_MIN, processed: rules.length, sent: 0, skipped: 0, failed: 0, details: [] };
  for (const rule of rules) {
    try {
      const r = await _processRule(rule, now);
      summary.sent    += r.sent;
      summary.skipped += r.skipped;
      summary.failed  += r.failed;
      summary.details.push(r);
    } catch (e) {
      console.warn(`[cron rule ${rule.id}]`, e.message);
      summary.failed++;
      summary.details.push({ rule_id: rule.id, error: e.message });
    }
  }

  console.log(`[cron] done — sent=${summary.sent} skipped=${summary.skipped} failed=${summary.failed}`);
  return res.json(summary);
});

/* ══════════════════════════════════════════════════════════
   Cron: LINE Promote Posts (line_scheduled_posts)
   ──────────────────────────────────────────────────────────
   POST /cron/line-promote
     Triggered every ~15 min by GitHub Actions.
     Reads line_scheduled_posts WHERE status='SCHEDULED' AND scheduled_at <= now+15min
     Sends via LINE push API (works for both userId and groupId targets).
     Substitutes {{event_name}}, {{event_date}}, {{location}}, {{start_time}},
                 {{end_time}}, {{event_code}}, {{days_left}} placeholders.

   Limitation: Uses LINE_CHANNEL_TOKEN env var (single OA) for ALL sends —
   line_scheduled_posts.channel_id is informational only.
   ══════════════════════════════════════════════════════════ */

async function _pushLineMessages(to, messages) {
  if (!LINE_CHANNEL_TOKEN) throw new Error('LINE_CHANNEL_TOKEN not set');
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!r.ok) {
    const errTxt = await r.text().catch(() => '');
    throw new Error(`LINE ${r.status}: ${errTxt.slice(0, 300)}`);
  }
  return true;
}

async function _broadcastLineMessages(messages) {
  if (!LINE_CHANNEL_TOKEN) throw new Error('LINE_CHANNEL_TOKEN not set');
  const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    const errTxt = await r.text().catch(() => '');
    throw new Error(`LINE ${r.status}: ${errTxt.slice(0, 300)}`);
  }
  return true;
}

// Build messages: text + poster หลักรูปเดียวตามหลัง
function _buildMessagesWithPoster(text, eventRow) {
  const messages = [{ type: 'text', text: String(text).slice(0, 5000) }];
  if (!eventRow) return messages;

  // ใช้ poster_url ก่อน — ถ้าไม่มีค่อย fallback image_urls[0]
  let url = eventRow.poster_url;
  if (!url && Array.isArray(eventRow.image_urls) && eventRow.image_urls.length) {
    url = eventRow.image_urls.find(Boolean);
  }
  if (url && /^https:\/\//i.test(url)) {
    messages.push({
      type: 'image',
      originalContentUrl: url,
      previewImageUrl: url,
    });
  }
  return messages;
}

function _daysBetween(yyyymmdd, refDate) {
  if (!yyyymmdd) return null;
  const m = String(yyyymmdd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const target = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
  const now = new Date(refDate);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((target - today) / 86400000);
}

function _renderLinePostText(post, eventRow) {
  const ev = eventRow || {};
  const daysLeft = _daysBetween(ev.event_date, new Date());
  const payload = {
    event_id:    ev.event_id ?? '',
    event_code:  ev.event_code || '',
    event_name:  ev.event_name || '',
    event_date:  _formatDMY(ev.event_date),
    end_date:    _formatDMY(ev.end_date),
    start_time:  (ev.start_time || '').slice(0, 5),
    end_time:    (ev.end_time || '').slice(0, 5),
    location:    ev.location || '',
    days_left:   daysLeft != null ? String(daysLeft) : '',
    promote_offset: post.promote_offset != null ? String(post.promote_offset) : '',
  };
  return _renderTpl(post.message_text || '', payload);
}

/* ── Send a single scheduled post NOW (bypass cron) ──
   Frontend ใช้ปุ่ม "📤 ส่งทันที" — ส่ง post id ที่เลือก ไม่กระทบ post อื่น */
app.post('/line/send-scheduled-post', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) return res.status(503).json({ ok: false, error: 'SB env not set' });
  if (!LINE_CHANNEL_TOKEN) return res.status(503).json({ ok: false, error: 'LINE_CHANNEL_TOKEN not set' });

  const posts = await _sbGet('line_scheduled_posts', `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  const post = posts?.[0];
  if (!post) return res.status(404).json({ ok: false, error: 'post not found' });
  if (post.status === 'SENT') return res.status(400).json({ ok: false, error: 'post already SENT', status: 'SENT' });

  // โหลด event เพื่อ render placeholders + ดึง poster
  let evtRow = null;
  if (post.event_id) {
    const ev = await _sbGet('events',
      `event_id=eq.${post.event_id}&select=event_id,event_code,event_name,event_date,end_date,start_time,end_time,location,poster_url,image_urls&limit=1`);
    evtRow = ev?.[0] || null;
  }

  const text = _renderLinePostText(post, evtRow);
  if (!text || !text.trim()) {
    await _sbPatch('line_scheduled_posts', `id=eq.${id}`, {
      status: 'FAILED',
      error_message: 'rendered text is empty',
    });
    return res.status(400).json({ ok: false, status: 'FAILED', error: 'rendered text is empty' });
  }

  const messages = _buildMessagesWithPoster(text, evtRow);

  try {
    if (post.target_type === 'broadcast') {
      await _broadcastLineMessages(messages);
    } else {
      if (!post.target_id) throw new Error('missing target_id');
      await _pushLineMessages(post.target_id, messages);
    }
    await _sbPatch('line_scheduled_posts', `id=eq.${id}`, {
      status: 'SENT',
      sent_at: new Date().toISOString(),
      error_message: null,
    });
    console.log(`[send-now ${id}] OK target=${post.target_type}/${(post.target_id || '').slice(0, 12)}`);
    return res.json({ ok: true, status: 'SENT', id: post.id });
  } catch (e) {
    console.warn(`[send-now ${id}] FAILED:`, e.message);
    await _sbPatch('line_scheduled_posts', `id=eq.${id}`, {
      status: 'FAILED',
      error_message: e.message.slice(0, 500),
      retry_count: (post.retry_count || 0) + 1,
    });
    return res.json({ ok: false, status: 'FAILED', error: e.message, id: post.id });
  }
});

// Throttle: prevent stampede when multiple browser tabs ping at once.
// GitHub Actions cron + cron-job.org + ERP keepalive all hit the same endpoint —
// throttle to 30s minimum spacing. Idempotent anyway (status filter), but saves DB calls.
let _lastLpTickAt = 0;
const LP_THROTTLE_MS = 30 * 1000;

app.post('/cron/line-promote', async (req, res) => {
  if (CRON_SECRET) {
    const got = req.get('x-cron-secret') || (req.body && req.body.secret) || '';
    if (got !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }
  if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) {
    return res.status(503).json({ error: 'SB_URL/SB_SERVICE_KEY not configured' });
  }
  if (!LINE_CHANNEL_TOKEN) {
    return res.status(503).json({ error: 'LINE_CHANNEL_TOKEN not configured' });
  }

  const now = Date.now();
  const sinceLast = now - _lastLpTickAt;
  if (sinceLast < LP_THROTTLE_MS) {
    return res.json({ ok: true, throttled: true, retry_after_ms: LP_THROTTLE_MS - sinceLast });
  }
  _lastLpTickAt = now;

  // Window: ดึง posts ที่ scheduled_at <= now + window (จะส่งแม้ overdue)
  const windowEnd = new Date(Date.now() + CRON_WINDOW_MIN * 60000).toISOString();
  console.log(`[cron line-promote] tick — fetching posts due before ${windowEnd}`);

  const posts = await _sbGet(
    'line_scheduled_posts',
    `select=*&status=eq.SCHEDULED&scheduled_at=lte.${encodeURIComponent(windowEnd)}&order=scheduled_at.asc&limit=200`,
  );
  if (!posts?.length) {
    return res.json({ ok: true, processed: 0, message: 'no due posts' });
  }

  // Load events ครั้งเดียว (cache by event_id) — รวม poster_url + image_urls สำหรับแนบรูป
  const eventIds = [...new Set(posts.map(p => p.event_id).filter(Boolean))];
  const eventCache = {};
  if (eventIds.length) {
    const evRows = await _sbGet('events',
      `select=event_id,event_code,event_name,event_date,end_date,start_time,end_time,location,poster_url,image_urls&event_id=in.(${eventIds.join(',')})`);
    (evRows || []).forEach(e => { eventCache[e.event_id] = e; });
  }

  const summary = { ok: true, processed: posts.length, sent: 0, failed: 0, details: [] };

  for (const post of posts) {
    const detail = { id: post.id, event_id: post.event_id, target_type: post.target_type, target_id: post.target_id };
    try {
      const eventRow = post.event_id ? eventCache[post.event_id] : null;
      const text = _renderLinePostText(post, eventRow);
      if (!text || !text.trim()) throw new Error('rendered text is empty');

      const messages = _buildMessagesWithPoster(text, eventRow);

      if (post.target_type === 'broadcast') {
        await _broadcastLineMessages(messages);
      } else {
        if (!post.target_id) throw new Error('missing target_id');
        await _pushLineMessages(post.target_id, messages);
      }

      // Mark SENT
      await _sbPatch('line_scheduled_posts', `id=eq.${post.id}`, {
        status: 'SENT',
        sent_at: new Date().toISOString(),
        error_message: null,
      });
      summary.sent++;
      detail.status = 'SENT';
    } catch (e) {
      console.warn(`[cron line-promote ${post.id}]`, e.message);
      await _sbPatch('line_scheduled_posts', `id=eq.${post.id}`, {
        status: 'FAILED',
        error_message: e.message.slice(0, 500),
        retry_count: (post.retry_count || 0) + 1,
      });
      summary.failed++;
      detail.status = 'FAILED';
      detail.error = e.message;
    }
    summary.details.push(detail);
  }

  console.log(`[cron line-promote] done — sent=${summary.sent} failed=${summary.failed}`);
  return res.json(summary);
});

/* ══════════════════════════════════════════════════════════
   IBD: instant notification when a new submission arrives
   ──────────────────────────────────────────────────────────
   POST /ibd/notify
     body: { trigger_key, payload }
     trigger_key whitelist:
       'ibd.complaint.created'
       'ibd.ewallet.created'
       'ibd.relocation.created'

   Looks up active notification_rules with matching trigger_key,
   resolves staff targets (line_user_id), renders message, multicasts.

   Called from member-facing portal (anon role) — security limited to
   the whitelist; rule must be ACTIVE for any message to go out.
   ══════════════════════════════════════════════════════════ */
const IBD_TRIGGER_WHITELIST = new Set([
  'ibd.complaint.created',
  'ibd.ewallet.created',
  'ibd.relocation.created',
]);

app.post('/ibd/notify', async (req, res) => {
  try {
    const { trigger_key, payload } = req.body || {};
    if (!trigger_key || !IBD_TRIGGER_WHITELIST.has(trigger_key)) {
      return res.status(400).json({ error: 'invalid trigger_key' });
    }
    if (!SB_URL_WEBHOOK || !SB_SERVICE_KEY) {
      return res.status(503).json({ error: 'SB_URL/SB_SERVICE_KEY not configured' });
    }
    if (!LINE_CHANNEL_TOKEN) {
      return res.status(503).json({ error: 'LINE_CHANNEL_TOKEN not configured' });
    }

    const rules = await _sbGet('notification_rules',
      `select=*&is_active=eq.true&trigger_key=eq.${encodeURIComponent(trigger_key)}`);
    if (!rules?.length) return res.json({ ok: true, sent: 0, message: 'no active rules' });

    const summary = { ok: true, trigger_key, processed: 0, sent: 0, failed: 0, skipped: 0 };
    const refKey = 'submission_id';
    const refId  = payload?.submission_id ?? payload?.id ?? null;

    for (const rule of rules) {
      summary.processed++;
      try {
        const recipients = await _resolveRuleTargets(rule);
        if (!recipients.length) {
          await _logBatch(rule, refKey, refId, [], 'skipped', 'no recipients');
          summary.skipped++;
          continue;
        }
        const lineRecipients = recipients.filter(r => r.line_user_id);
        const lineIds = lineRecipients.map(r => r.line_user_id);
        const text = _renderTpl(rule.message_template, payload || {});
        if (lineIds.length) await _multicastViaCronToken(lineIds, text);
        await _logBatch(rule, refKey, refId, lineRecipients, 'sent');
        await _writeInbox(rule, trigger_key, payload || {}, text, recipients, refKey, refId);
        summary.sent += recipients.length;
      } catch (e) {
        console.warn(`[ibd/notify rule ${rule.id}]`, e.message);
        await _logBatch(rule, refKey, refId, [], 'failed', e.message);
        summary.failed++;
      }
    }
    return res.json(summary);
  } catch (e) {
    console.warn('[ibd/notify]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/* ── Start ─────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log('');
  console.log('  ✅  AI Proxy พร้อมใช้งาน');
  console.log(`  🌐  URL: http://localhost:${PORT}`);
  if (API_KEY) {
    console.log(`  🔑  Anthropic API Key: sk-ant-...${API_KEY.slice(-6)} (OCR: ON)`);
  } else {
    console.log(`  ⚠️   ANTHROPIC_API_KEY ไม่ได้ตั้ง — /extract (OCR) จะ disable`);
  }
  console.log('');
  console.log('  Endpoints:');
  if (API_KEY) console.log(`  → http://localhost:${PORT}/extract          (Passport OCR)`);
  console.log(`  → http://localhost:${PORT}/line/push        (LINE push)`);
  console.log(`  → http://localhost:${PORT}/line/multicast   (LINE multicast)`);
  console.log(`  → http://localhost:${PORT}/line/broadcast   (LINE broadcast)`);
  console.log(`  → http://localhost:${PORT}/line/info        (LINE bot info — test token)`);
  console.log(`  → http://localhost:${PORT}/line/quota       (LINE quota + usage this month)`);
  console.log(`  → http://localhost:${PORT}/line/webhook     (LINE webhook ${LINE_CHANNEL_SECRET ? '✅' : '❌ no secret'})`);
  console.log(`  → http://localhost:${PORT}/cron/notifications (Scheduled LINE — every 15 min)${CRON_SECRET ? ' 🔒' : ''}`);
  console.log(`  → http://localhost:${PORT}/cron/line-promote  (LINE Promote scheduler — every 15 min)${CRON_SECRET ? ' 🔒' : ''}`);
  if (SB_URL_WEBHOOK && SB_SERVICE_KEY) {
    console.log(`  ✅ Webhook + cron will update Supabase`);
  } else {
    console.log(`  ⚠️  Webhook + cron DB updates disabled (set SB_URL + SB_SERVICE_KEY)`);
  }
  console.log('');
});
