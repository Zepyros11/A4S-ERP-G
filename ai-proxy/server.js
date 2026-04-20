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
  welcome:
    'ยินดีต้อนรับสู่ A4S 🎉\n\n' +
    '📱 สมาชิก: ส่ง "รหัสสมาชิก" (ตัวเลข 5-6 หลัก)\n' +
    '👤 พนักงาน: ส่ง "username" ของคุณ\n\n' +
    'ตัวอย่าง: 10271 หรือ somchai',
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
    const uid = ev?.source?.userId;
    if (!uid) continue;

    try {
      // === FOLLOW event: user added OA as friend ===
      if (ev.type === 'follow') {
        console.log(`[LINE webhook] follow from ${uid.slice(0, 10)}...`);
        await _lineReply(ev.replyToken, await _tpl('welcome'));
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

          if (sess.pending_type === 'member') {
            const members = await _sbGet(
              'members',
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
              await _sbUpsertMemberLine({
                memberCode: member.member_code,
                userId: uid,
                displayName: profile?.displayName || null,
                pictureUrl: profile?.pictureUrl || null,
              });
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

        // ── Step 2: session หมดอายุแล้ว (แต่ยังมี record) แจ้งเตือน + ล้าง ──
        if (sess?.pending_type && sess?.expires_at && new Date(sess.expires_at) <= now) {
          await _clearSession(uid);
        }

        // ── Step 3: ไม่มี session → user ส่ง code/username ครั้งแรก ──
        const expiresAt = new Date(now.getTime() + SESSION_TTL_MIN * 60000).toISOString();

        // Branch A: digits 3-8 → member
        const codeMatch = text.match(/^(\d{3,8})$/);
        if (codeMatch) {
          const memberCode = codeMatch[1];
          const members = await _sbGet(
            'members',
            `member_code=eq.${encodeURIComponent(memberCode)}&select=member_code,full_name,member_name,password_hash&limit=1`,
          );
          const member = members?.[0];
          if (!member) {
            await _lineReply(ev.replyToken, await _tpl('invalid_code'));
            continue;
          }
          if (!member.password_hash) {
            await _lineReply(ev.replyToken, await _tpl('no_password_set'));
            continue;
          }
          await _setSession(uid, {
            pending_type: 'member',
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

        // ไม่ match อะไรเลย → welcome
        await _lineReply(ev.replyToken, await _tpl('welcome'));
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
