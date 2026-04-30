/* ============================================================
   ibd-storage.js — Signed URL helper for ibd-attachments bucket
   Used by ibd-complaints.js + ibd-ewallet.js (backend report modals)
   ============================================================ */

(function () {
  const SB_URL = localStorage.getItem('sb_url') || '';
  const SB_KEY = localStorage.getItem('sb_key') || '';
  const BUCKET = 'ibd-attachments';
  const DEFAULT_EXPIRES = 3600; // 1 hour

  /* In-memory cache: key → { url, expiresAt } */
  const cache = new Map();

  async function getSignedUrl(key, expiresIn = DEFAULT_EXPIRES) {
    if (!key) return null;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.url;

    const res = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${key}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`sign ${key} → ${res.status}: ${txt.slice(0, 120)}`);
    }
    const data = await res.json();
    // signedURL relative path → prepend SB_URL+/storage/v1
    const fullUrl = data.signedURL ? `${SB_URL}/storage/v1${data.signedURL}` : (data.signedUrl || '');
    cache.set(key, { url: fullUrl, expiresAt: Date.now() + expiresIn * 1000 });
    return fullUrl;
  }

  async function getSignedUrls(keys, expiresIn = DEFAULT_EXPIRES) {
    if (!Array.isArray(keys) || !keys.length) return [];
    return Promise.all(keys.map(k => getSignedUrl(k, expiresIn).catch(() => null)));
  }

  /* Determine if key is image (for inline preview) */
  function isImage(key) {
    if (!key) return false;
    return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(key);
  }
  function isPdf(key) {
    if (!key) return false;
    return /\.pdf$/i.test(key);
  }
  function fileIcon(key) {
    if (!key) return '📎';
    if (isImage(key)) return '🖼️';
    if (isPdf(key))   return '📄';
    if (/\.(mp3|wav|m4a)$/i.test(key)) return '🎵';
    if (/\.(mp4|mov|avi)$/i.test(key)) return '🎬';
    if (/\.(docx?|odt)$/i.test(key))   return '📝';
    if (/\.(xlsx?|csv)$/i.test(key))   return '📊';
    return '📎';
  }
  function fileName(key) {
    if (!key) return '';
    const base = key.split('/').pop() || key;
    // strip "{timestamp}_" prefix added by upload helper
    return base.replace(/^\d{10,}_/, '');
  }

  window.IBDStorage = { getSignedUrl, getSignedUrls, isImage, isPdf, fileIcon, fileName };
})();
