/* ============================================================
   supabase.js — Supabase REST API wrapper (Node)
   ใช้ service role key (เก็บใน GitHub Secret SUPABASE_SERVICE_KEY)
   ============================================================ */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

function _headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function _request(path, opts = {}) {
  if (!URL || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing');
  const { method = 'GET', body, headers = {} } = opts;
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: _headers(headers),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (method === 'DELETE') return null;
  // Safer JSON parse — PATCH/POST sometimes return empty (204) or text/plain
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

/* ── Get sync_config (id=1) ── */
export async function getConfig() {
  const rows = await _request('sync_config?id=eq.1&limit=1');
  return rows?.[0] || null;
}

/* ── Update sync_config ── */
export async function updateConfig(patch) {
  return _request('sync_config?id=eq.1', {
    method: 'PATCH',
    body: patch,
  });
}

/* ── Start a sync_log entry (returns id) ── */
export async function startLog({ source, triggered_by = 'github-actions' }) {
  const rows = await _request('sync_log', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      source,
      started_at: new Date().toISOString(),
      status: 'running',
      triggered_by,
    }],
  });
  return rows?.[0]?.id;
}

/* ── Finish sync_log ── */
export async function finishLog(id, { status, rows_inserted = 0, rows_updated = 0, rows_failed = 0, rows_total = 0, error_message = null, duration_sec = 0 }) {
  if (!id) return;
  return _request(`sync_log?id=eq.${id}`, {
    method: 'PATCH',
    body: {
      finished_at: new Date().toISOString(),
      duration_sec,
      rows_total,
      rows_inserted,
      rows_updated,
      rows_failed,
      status,
      error_message,
    },
  });
}

/* ── Batch upsert members (normalize keys + 500 rows/batch) ── */
export async function upsertMembers(records, batchSize = 500) {
  if (!records?.length) return { inserted: 0, failed: 0 };
  let ok = 0, failed = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    // Normalize keys (PGRST102 guard)
    const allKeys = new Set();
    chunk.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
    const normalized = chunk.map(r => {
      const out = {};
      allKeys.forEach(k => { out[k] = (k in r) ? r[k] : null; });
      return out;
    });
    try {
      await _request('members?on_conflict=member_code', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: normalized,
      });
      ok += chunk.length;
    } catch (e) {
      console.error(`  ❌ batch ${Math.floor(i/batchSize)+1} failed:`, e.message);
      failed += chunk.length;
    }
  }
  return { inserted: ok, failed };
}
