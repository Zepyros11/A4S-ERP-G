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
app.use(express.json({ limit: '20mb' }));

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
  console.log('');
});
