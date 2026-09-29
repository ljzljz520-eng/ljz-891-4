'use strict';
const crypto = require('crypto');

/** 生成 RFC4122 风格 UUID v4 */
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 生成授权码，形如 XXXX-XXXX-XXXX-XXXX（去除易混字符 0/O/1/I） */
function genCode(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if ((i + 1) % 4 === 0 && i !== length - 1) out += '-';
  }
  return out;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/** 简单常量时间比较，防时序探测 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 去掉授权码分隔符并转大写，用于比对 */
function normalizeCode(code) {
  return String(code || '').replace(/[\s-]/g, '').toUpperCase();
}

function formatCode(code) {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, '$1-');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { uuid, genCode, sha256, safeEqual, normalizeCode, formatCode, escapeHtml };
