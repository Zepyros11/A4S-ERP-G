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

const WELCOME_MSG =
  "ยินดีต้อนรับสู่ A4S 🎉\n\n" +
  "📱 สมาชิก: ส่ง \"รหัสสมาชิก\" (ตัวเลข 5-6 หลัก)\n" +
  "👤 พนักงาน: ส่ง \"username\" ของคุณ\n\n" +
  "ตัวอย่าง: 10271 หรือ somchai";

const INVALID_CODE_MSG =
  "❌ ไม่พบข้อมูลนี้ในระบบ\n\n" +
  "• สมาชิก: ตัวเลข 5-6 หลัก\n" +
  "• พนักงาน: username ที่ใช้ login ERP\n\n" +
  "หากไม่ทราบข้อมูล ติดต่อแอดมิน";

function _buildLinkedReply(memberName, memberCode) {
  return (
    `✅ ผูก LINE สำเร็จ!\n\n` +
    `สมาชิก: ${memberName || memberCode}\n` +
    `รหัส: ${memberCode}\n\n` +
    `🔔 จากนี้คุณจะได้รับแจ้งเตือน event และข้อมูลสำคัญทาง LINE`
  );
}

function _buildStaffLinkedReply(fullName, username, role) {
  return (
    `✅ ผูก LINE พนักงานสำเร็จ!\n\n` +
    `ชื่อ: ${fullName || username}\n` +
    `Username: ${username}\n` +
    (role ? `Role: ${role}\n` : '') +
    `\n🔔 คุณจะได้รับแจ้งเตือนภายในองค์กรผ่าน LINE`
  );
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
    const uid = ev?.source?.userId;
    if (!uid) continue;

    try {
      // === FOLLOW event: user added OA as friend ===
      if (ev.type === 'follow') {
        console.log(`[LINE webhook] follow from ${uid.slice(0, 10)}...`);
        await _lineReply(ev.replyToken, WELCOME_MSG);
        continue;
      }

      // === MESSAGE event ===
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = (ev.message.text || '').trim();
        console.log(`[LINE webhook] message "${text}" from ${uid.slice(0, 10)}...`);

        // Update last_active_at for existing linked accounts
        await _sbPatch(
          'member_line_accounts',
          `line_user_id=eq.${encodeURIComponent(uid)}`,
          { last_active_at: nowIso },
        );

        // === Branch A: ตัวเลข 3-8 หลัก → member_code ===
        const codeMatch = text.match(/^(\d{3,8})$/);
        if (codeMatch) {
          const memberCode = codeMatch[1];
          const members = await _sbGet(
            'members',
            `member_code=eq.${encodeURIComponent(memberCode)}&select=member_code,full_name,member_name,line_user_id&limit=1`,
          );
          const member = members?.[0];
          if (!member) {
            await _lineReply(ev.replyToken, INVALID_CODE_MSG);
            continue;
          }
          const profile = await _getLineProfile(uid);
          await _sbUpsertMemberLine({
            memberCode,
            userId: uid,
            displayName: profile?.displayName || null,
            pictureUrl: profile?.pictureUrl || null,
          });
          const name = member.full_name || member.member_name || memberCode;
          await _lineReply(ev.replyToken, _buildLinkedReply(name, memberCode));
          continue;
        }

        // === Branch B: ตัวอักษร (มีตัวหนังสือ) → username พนักงาน ===
        const usernameMatch = text.match(/^[A-Za-z0-9_.\-]{2,40}$/);
        if (usernameMatch) {
          const username = text.toLowerCase();
          // ilike เพื่อ case-insensitive match กับ username (lower-cased index)
          const users = await _sbGet(
            'users',
            `username=ilike.${encodeURIComponent(username)}&select=user_id,username,full_name,role,is_active&limit=1`,
          );
          const user = users?.[0];
          if (!user) {
            await _lineReply(ev.replyToken, INVALID_CODE_MSG);
            continue;
          }
          if (user.is_active === false) {
            await _lineReply(ev.replyToken, '⚠️ บัญชีพนักงานนี้ถูกปิดใช้งาน — ติดต่อแอดมิน');
            continue;
          }
          const profile = await _getLineProfile(uid);
          await _sbUpdateUserLine({
            userRowId: user.user_id,
            userId: uid,
            displayName: profile?.displayName || null,
            pictureUrl: profile?.pictureUrl || null,
          });
          await _lineReply(
            ev.replyToken,
            _buildStaffLinkedReply(user.full_name, user.username, user.role),
          );
          continue;
        }

        // ไม่ match รูปแบบใดเลย
        await _lineReply(ev.replyToken, WELCOME_MSG);
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
  console.log(`  → http://localhost:${PORT}/line/webhook     (LINE webhook ${LINE_CHANNEL_SECRET ? '✅' : '❌ no secret'})`);
  if (SB_URL_WEBHOOK && SB_SERVICE_KEY) {
    console.log(`  ✅ Webhook will update Supabase on LINE events`);
  } else {
    console.log(`  ⚠️  Webhook DB updates disabled (set SB_URL + SB_SERVICE_KEY)`);
  }
  console.log('');
});
