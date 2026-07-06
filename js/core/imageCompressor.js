/* ============================================================
   A4S-ERP — Image compressor (client-side)
   --------------------------------------------------------------
   ลดขนาดรูปก่อน upload ไป Supabase Storage เพื่อลด egress
   default: resize max 1600px + JPEG quality 0.82 (~3MB → ~250KB)

   Usage:
     // 1) Compress image → Blob (image/jpeg)
     const blob = await ImageCompressor.compress(fileOrDataUrl);
     // หรือกำหนด options:
     const blob = await ImageCompressor.compress(file, { maxDim: 1280, quality: 0.8 });

     // 2) Skip ถ้าไม่ใช่รูป (เหมาะกับ form ที่รับทั้งรูป+วิดีโอ/PDF)
     const out = await ImageCompressor.compressIfImage(file);
     // out = Blob ที่ compress แล้ว, หรือ original file ถ้าไม่ใช่รูป

     // 3) Compress + upload ผ่าน Supabase JS SDK
     const url = await ImageCompressor.uploadViaClient(sbClient, 'bucket', 'path/file', file);

     // 4) Compress + upload ผ่าน REST API (ใช้ตอนไม่มี sbClient)
     const url = await ImageCompressor.uploadViaRest(sbUrl, sbKey, 'bucket', 'path/file', file);
   ============================================================ */

(function () {
  const DEFAULTS = { maxDim: 1600, quality: 0.82 };

  function isImageType(t) {
    return typeof t === 'string' && t.startsWith('image/');
  }

  function inputIsImage(input) {
    if (!input) return false;
    if (typeof input === 'string') return input.startsWith('data:image/');
    if (input instanceof Blob) return isImageType(input.type);
    return false;
  }

  async function _toDataUrl(input) {
    if (typeof input === 'string') return input;
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(input);
    });
  }

  async function _loadImage(dataUrl) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
  }

  /* compress image → Blob (image/jpeg)
     throws ถ้า input ไม่ใช่รูป — caller ต้องเช็คก่อน หรือใช้ compressIfImage */
  async function compress(input, opts = {}) {
    const { maxDim, quality } = { ...DEFAULTS, ...opts };
    if (!inputIsImage(input)) throw new Error('compress: input is not an image');
    const dataUrl = await _toDataUrl(input);
    const img = await _loadImage(dataUrl);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('compress: canvas.toBlob returned null');
    return blob;
  }

  /* compress ถ้าเป็นรูป — ถ้าไม่ใช่ คืน input เดิม
     เหมาะกับ form ที่รับทั้งรูป + ไฟล์อื่น (วิดีโอ/PDF) */
  async function compressIfImage(input, opts = {}) {
    if (!inputIsImage(input)) return input;
    try { return await compress(input, opts); }
    catch (e) { console.warn('compressIfImage failed, using original:', e.message); return input; }
  }

  /* ── Drive storage routing (rollout กลาง) ──
     เปิดรูป Drive per-bucket ด้วย localStorage:
       erp_drive_storage = "1"                (master switch)
       erp_drive_buckets = "product-images,event-files,..."  (allowlist ราย bucket)
     bucket ที่ไม่อยู่ใน allowlist → อัปขึ้น Supabase ตามเดิม (PII buckets ปลอดภัย) */
  function _driveEnabledFor(bucket) {
    try {
      if (localStorage.getItem('erp_drive_storage') !== '1') return false;
      const list = (localStorage.getItem('erp_drive_buckets') || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      return list.includes(bucket);
    } catch { return false; }
  }
  function _driveCfg() {
    return {
      proxyBase: (localStorage.getItem('erp_proxy_url') || '').replace(/\/+$/, ''),
      key: localStorage.getItem('erp_drive_key') || '',
    };
  }

  /* compress + upload ผ่าน Supabase JS SDK → return public URL หรือ null
     `path` ไม่ต้องใส่ extension — จะถูกบังคับเป็น .jpg เสมอ (ของ compressed image)
     ถ้า input ไม่ใช่รูป จะ upload ตามเดิม (ใช้ name/type จาก File) */
  async function uploadViaClient(sbClient, bucket, path, input, opts = {}) {
    if (_driveEnabledFor(bucket)) {
      const { proxyBase, key } = _driveCfg();
      return uploadToDrive(proxyBase, key, `${bucket}/${path}`, input, opts);
    }
    if (!sbClient) return null;
    try {
      let blob, contentType, finalPath;
      if (inputIsImage(input)) {
        blob = await compress(input, opts);
        contentType = 'image/jpeg';
        finalPath = path.endsWith('.jpg') ? path : `${path}.jpg`;
      } else {
        blob = input instanceof Blob ? input : null;
        if (!blob) throw new Error('non-image input must be File/Blob');
        contentType = blob.type || 'application/octet-stream';
        const ext = (input.name && input.name.includes('.')) ? input.name.split('.').pop() : '';
        finalPath = ext ? (path.endsWith(`.${ext}`) ? path : `${path}.${ext}`) : path;
      }
      const { data, error } = await sbClient.storage
        .from(bucket)
        .upload(finalPath, blob, { upsert: true, contentType });
      if (error) throw error;
      const { data: { publicUrl } } = sbClient.storage.from(bucket).getPublicUrl(data.path);
      return publicUrl;
    } catch (e) {
      console.warn('uploadViaClient failed:', e.message);
      return null;
    }
  }

  /* compress + upload ผ่าน REST API (สำหรับ module ที่ไม่ใช้ sbClient)
     return public URL หรือ null
     `path` จะถูกบังคับเป็น .jpg เสมอ ถ้า input เป็นรูป */
  async function uploadViaRest(sbUrl, sbKey, bucket, path, input, opts = {}) {
    if (_driveEnabledFor(bucket)) {
      const { proxyBase, key } = _driveCfg();
      return uploadToDrive(proxyBase, key, `${bucket}/${path}`, input, opts);
    }
    if (!sbUrl || !sbKey) return null;
    try {
      let blob, contentType, finalPath;
      if (inputIsImage(input)) {
        blob = await compress(input, opts);
        contentType = 'image/jpeg';
        finalPath = path.endsWith('.jpg') ? path : `${path}.jpg`;
      } else {
        blob = input instanceof Blob ? input : null;
        if (!blob) throw new Error('non-image input must be File/Blob');
        contentType = blob.type || 'application/octet-stream';
        const ext = (input.name && input.name.includes('.')) ? input.name.split('.').pop() : '';
        finalPath = ext ? (path.endsWith(`.${ext}`) ? path : `${path}.${ext}`) : path;
      }
      const res = await fetch(`${sbUrl}/storage/v1/object/${bucket}/${finalPath}`, {
        method: 'POST',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text().catch(() => '')}`);
      return `${sbUrl}/storage/v1/object/public/${bucket}/${finalPath}`;
    } catch (e) {
      console.warn('uploadViaRest failed:', e.message);
      return null;
    }
  }

  /* compress + upload ผ่าน Drive proxy (ai-proxy /drive/upload)
     ใช้แทน Supabase Storage — return public URL (proxy serve URL) หรือ null
     - proxyBase : เช่น "https://a4s-erp-proxy.onrender.com" (ไม่มี / ท้าย)
     - uploadKey : ค่า DRIVE_UPLOAD_KEY (ส่งใน x-drive-key)
     - path      : ชื่อไฟล์ที่จะแสดงใน Drive (เช่น "products/123_0_....") — image จะบังคับ .jpg
     signature ตั้งใจให้คล้าย uploadViaRest เพื่อสลับ call site ได้ง่าย */
  async function uploadToDrive(proxyBase, uploadKey, path, input, opts = {}) {
    if (!proxyBase) return null;
    try {
      let blob, contentType, finalName;
      if (inputIsImage(input)) {
        blob = await compress(input, opts);
        contentType = 'image/jpeg';
        finalName = path.endsWith('.jpg') ? path : `${path}.jpg`;
      } else {
        blob = input instanceof Blob ? input : null;
        if (!blob) throw new Error('non-image input must be File/Blob');
        contentType = blob.type || 'application/octet-stream';
        const ext = (input.name && input.name.includes('.')) ? input.name.split('.').pop() : '';
        finalName = ext ? (path.endsWith(`.${ext}`) ? path : `${path}.${ext}`) : path;
      }
      const base = String(proxyBase).replace(/\/+$/, '');
      const headers = { 'Content-Type': contentType };
      if (uploadKey) headers['x-drive-key'] = uploadKey;
      const res = await fetch(`${base}/drive/upload?name=${encodeURIComponent(finalName)}`, {
        method: 'POST',
        headers,
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(`drive upload ${res.status}: ${data.error || 'no url'}`);
      }
      return data.url;
    } catch (e) {
      console.warn('uploadToDrive failed:', e.message);
      return null;
    }
  }

  window.ImageCompressor = { compress, compressIfImage, uploadViaClient, uploadViaRest, uploadToDrive };
})();
