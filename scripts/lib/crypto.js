/* ============================================================
   crypto.js (Node) — Mirror ของ js/core/crypto.js (browser)
   ใช้ decrypt credentials ที่ encrypt ด้วย Master Key จาก ERP UI

   ต้องใช้ algorithm เดียวกัน:
   - PBKDF2-SHA256, 100000 iterations, salt = "A4S-ERP-salt-v1"
   - AES-GCM 256-bit
   - Ciphertext format: base64(iv[12] || ciphertext||tag)
   ============================================================ */

import { pbkdf2Sync, createDecipheriv, createCipheriv, randomBytes, createHash } from 'node:crypto';

const SALT = 'A4S-ERP-salt-v1';
const ITERS = 100000;

let _cachedKey = null;
let _cachedPassphrase = null;

function _deriveKey(passphrase) {
  return pbkdf2Sync(passphrase, SALT, ITERS, 32, 'sha256');
}

function _getKey(passphrase) {
  if (!passphrase) throw new Error('MASTER_KEY missing');
  if (passphrase !== _cachedPassphrase) {
    _cachedKey = _deriveKey(passphrase);
    _cachedPassphrase = passphrase;
  }
  return _cachedKey;
}

/** Decrypt base64 ciphertext → plaintext string
 *  Matches browser AES-GCM with iv prepended (12 bytes)
 */
export function decrypt(ciphertextB64, passphrase) {
  if (!ciphertextB64) return null;
  const key = _getKey(passphrase);
  const combined = Buffer.from(ciphertextB64, 'base64');
  const iv = combined.subarray(0, 12);
  // In AES-GCM output from Web Crypto, last 16 bytes = auth tag
  const tag = combined.subarray(combined.length - 16);
  const ct  = combined.subarray(12, combined.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Encrypt plaintext → base64 (iv|ct|tag) — mirror of browser format */
export function encrypt(plaintext, passphrase) {
  if (plaintext == null || plaintext === '') return null;
  const key = _getKey(passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/** SHA-256 hash (hex) — mirror of browser ERPCrypto.hash */
export function hash(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  return createHash('sha256').update(String(plaintext)).digest('hex');
}
