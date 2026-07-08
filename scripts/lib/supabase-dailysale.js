/* ============================================================
   supabase-dailysale.js — Daily Sale upsert helpers
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
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  if (method === 'DELETE') return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function _normalizeBatch(chunk) {
  const allKeys = new Set();
  chunk.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  return chunk.map(r => {
    const out = {};
    allKeys.forEach(k => { out[k] = (k in r) ? r[k] : null; });
    return out;
  });
}

async function _batchUpsert(table, records, conflictKey, batchSize = 500) {
  if (!records?.length) return { inserted: 0, failed: 0 };
  let ok = 0, failed = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    const normalized = _normalizeBatch(chunk);
    try {
      await _request(`${table}?on_conflict=${conflictKey}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: normalized,
      });
      ok += chunk.length;
    } catch (e) {
      console.error(`  ❌ ${table} batch ${Math.floor(i/batchSize)+1} failed:`, e.message);
      failed += chunk.length;
    }
  }
  return { inserted: ok, failed };
}

/* ── Ensure branch codes exist (prevent FK fail) ── */
export async function ensureBranches(codes) {
  if (!codes?.length) return;
  const records = codes.map(c => ({
    branch_code: c,
    branch_name: c,          // fallback name if unknown (can edit later in UI)
    country_code: 'TH',
    display_order: 99,
    active: true,
  }));
  await _request('branches?on_conflict=branch_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: records,
  });
}

/* ── Delete existing rows in date range (before inserting fresh data) ── */
export async function deleteByDateRange(table, dateField, from, to) {
  const query = `${table}?${dateField}=gte.${from}&${dateField}=lte.${to}`;
  await _request(query, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

/* ── Upsert wrappers per table ── */
export async function upsertBills(records) {
  return _batchUpsert('daily_sale_bills', records, 'bill_no', 500);
}

/* Fetch bill_no's whose payment CS has manually corrected in ERP.
   Queried in slices of 200 so the in.(...) list stays a reasonable URL length. */
async function fetchCorrectedBillNos(billNos) {
  const set = new Set();
  const uniq = [...new Set((billNos || []).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const inList = uniq.slice(i, i + 200).map(b => `"${b}"`).join(',');
    const rows = await _request(
      `daily_sale_payments?corrected=eq.true&bill_no=in.(${inList})&select=bill_no`
    );
    (rows || []).forEach(r => set.add(r.bill_no));
  }
  return set;
}

export async function upsertPayments(records) {
  if (!records?.length) return { inserted: 0, failed: 0, skipped: 0 };
  // Guard: never overwrite payment rows CS has corrected in ERP (migration 025).
  // answerforsuccess channels are the "raw/wrong" values; corrected=true means
  // the ERP row is the source of truth — sync must leave its channels untouched.
  const skip = await fetchCorrectedBillNos(records.map(r => r.bill_no));
  const fresh = skip.size ? records.filter(r => !skip.has(r.bill_no)) : records;
  const skipped = records.length - fresh.length;
  if (skipped) console.log(`   🔒 payments: skipped ${skipped} corrected bill(s) (kept ERP values)`);
  const res = await _batchUpsert('daily_sale_payments', fresh, 'bill_no', 500);
  return { ...res, skipped };
}

export async function upsertTopupBills(records) {
  return _batchUpsert('daily_sale_topup_bills', records, 'bill_no', 500);
}

/* topup_details is N:1 — has no unique bill_no; we delete-then-insert by date range */
export async function insertTopupDetails(records, fromDate, toDate) {
  if (!records?.length) return { inserted: 0, failed: 0 };
  // Clean existing details in range (prevent dupes on re-sync)
  await deleteByDateRange('daily_sale_topup_details', 'sale_date', fromDate, toDate);

  let ok = 0, failed = 0;
  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    try {
      await _request('daily_sale_topup_details', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: _normalizeBatch(chunk),
      });
      ok += chunk.length;
    } catch (e) {
      console.error(`  ❌ topup_details batch ${Math.floor(i/batchSize)+1} failed:`, e.message);
      failed += chunk.length;
    }
  }
  return { inserted: ok, failed };
}
