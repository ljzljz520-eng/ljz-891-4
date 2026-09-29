const crypto = require('crypto');

// 使用 PBKDF2 + 随机盐进行口令哈希，避免明文存储
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 生成随机令牌（会话）
function randomToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

// 去除易混字符（0/O, 1/I/L）的授权码字母表
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateAuthCode() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `EDU-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

function normCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// 将用户输入统一格式化为 EDU-XXXX-XXXX-XXXX
function formatCode(code) {
  const d = normCode(code).replace(/^EDU/, '');
  if (d.length === 12) return `EDU-${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8, 12)}`;
  return String(code || '').trim().toUpperCase();
}

module.exports = { hashPassword, verifyPassword, randomToken, generateAuthCode, normCode, formatCode };
