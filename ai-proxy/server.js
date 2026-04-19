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

app.post('/line/webhook', async (req, res) => {
  // LINE will send a verification request from Developers Console — always 200
  const verify = _verifyLineSignature(req);
  if (!verify.ok) {
    console.warn('[LINE webhook] signature invalid:', verify.reason || 'mismatch');
    // Still return 200 to avoid LINE retries, but log for debug
    return res.status(200).json({ ok: false, error: verify.reason || 'invalid signature' });
  }

  const events = req.body?.events || [];
  const userIds = new Set();
  for (const ev of events) {
    const uid = ev?.source?.userId;
    if (!uid) continue;
    userIds.add(uid);
    console.log(`[LINE webhook] ${ev.type} from ${uid.slice(0, 10)}...`);
  }

  if (!userIds.size) return res.status(200).json({ ok: true, events: 0 });

  // Update last_active_at for each user
  const nowIso = new Date().toISOString();
  for (const uid of userIds) {
    await _sbPatch(
      'member_line_accounts',
      `line_user_id=eq.${encodeURIComponent(uid)}`,
      { last_active_at: nowIso },
    );
    await _sbPatch(
      'members',
      `line_user_id=eq.${encodeURIComponent(uid)}`,
      { line_linked_at: nowIso },
    );
  }

  return res.status(200).json({ ok: true, events: events.length, users: userIds.size });
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
