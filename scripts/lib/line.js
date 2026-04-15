/* ============================================================
   line.js — LINE Messaging API helper (Node)
   ส่ง notification ไป group/user/broadcast เมื่อ sync เสร็จ/fail
   ============================================================ */

/* ── Send LINE notification ──
   token: long-lived Channel Access Token
   targetType: 'group' | 'user' | 'broadcast'
   targetId: group ID or user ID (ignored if broadcast)
   message: text or Flex object
*/
export async function sendLineNotify(token, targetType, targetId, payload) {
  if (!token) return { ok: false, error: 'no token' };

  const messages = Array.isArray(payload) ? payload : [_textMessage(payload)];

  let url, body;
  if (targetType === 'broadcast') {
    url = 'https://api.line.me/v2/bot/message/broadcast';
    body = { messages };
  } else {
    if (!targetId) return { ok: false, error: 'no targetId' };
    url = 'https://api.line.me/v2/bot/message/push';
    body = { to: targetId, messages };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `${res.status}: ${err.slice(0, 150)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _textMessage(text) {
  return { type: 'text', text: String(text).slice(0, 5000) };
}

/* ── Build sync result message (Flex Message) ── */
export function buildSyncMessage({ status, durationSec, rowsInserted, rowsFailed, errorMessage, ranges }) {
  const isOk = status === 'success';
  const isPartial = status === 'partial';
  const color = isOk ? '#10B981' : (isPartial ? '#F59E0B' : '#EF4444');
  const icon = isOk ? '✅' : (isPartial ? '⚠️' : '❌');
  const titleText = isOk ? 'Sync สำเร็จ' : (isPartial ? 'Sync บางส่วนล้มเหลว' : 'Sync ล้มเหลว');

  const dur = durationSec >= 60
    ? `${Math.floor(durationSec/60)}m ${durationSec%60}s`
    : `${durationSec}s`;

  const flexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'vertical',
      backgroundColor: color,
      paddingAll: 'md',
      contents: [
        { type: 'text', text: `${icon} ${titleText}`, color: '#FFFFFF', weight: 'bold', size: 'lg' },
        { type: 'text', text: 'A4S-ERP Auto-Sync', color: '#FFFFFFCC', size: 'xs', margin: 'sm' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        _row('🕒 เวลา', new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })),
        _row('⏱️ ใช้เวลา', dur),
        _row('✅ Inserted', String(rowsInserted ?? 0)),
        _row('⚠️ Failed', String(rowsFailed ?? 0)),
        ...(ranges ? [_row('📅 ช่วงปี', ranges)] : []),
        ...(errorMessage ? [
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🚨 Error:', size: 'xs', color: '#EF4444', weight: 'bold', margin: 'md' },
          { type: 'text', text: String(errorMessage).slice(0, 300), wrap: true, size: 'xs', color: '#7F1D1D' },
        ] : []),
      ],
    },
  };

  return { type: 'flex', altText: `${icon} ${titleText} — A4S-ERP`, contents: flexBubble };
}

function _row(label, value) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#6B7280', size: 'sm', flex: 4 },
      { type: 'text', text: String(value), color: '#111827', size: 'sm', flex: 6, weight: 'bold', wrap: true },
    ],
  };
}
