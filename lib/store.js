'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { uuid, genCode, sha256 } = require('./util');

let db = null;
let writeChain = Promise.resolve();

function ensureSeed() {
  if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });
  if (!fs.existsSync(config.DB_FILE)) {
    const seed = require('./seed');
    db = seed.build();
    persistSync();
  } else {
    db = JSON.parse(fs.readFileSync(config.DB_FILE, 'utf8'));
  }
}

function persistSync() {
  const tmp = config.DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, config.DB_FILE);
}

/** 串行化异步写，避免并发覆盖 */
function save() {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(() =>
    fs.promises.writeFile(config.DB_FILE + '.tmp', snapshot).then(() =>
      fs.promises.rename(config.DB_FILE + '.tmp', config.DB_FILE)
    )
  );
  return writeChain;
}

// ---------- 管理员 ----------
function getAdmin() {
  return db.admin;
}
function verifyAdmin(username, password) {
  const a = db.admin;
  if (!a || a.username !== username) return false;
  return a.passwordHash === sha256(password + (a.salt || ''));
}
function setAdminPassword(newPassword) {
  const a = db.admin;
  a.salt = cryptoRandom();
  a.passwordHash = sha256(newPassword + a.salt);
  return save();
}

// ---------- 账号 ----------
function listAccounts(filter = {}) {
  let rows = db.accounts.slice();
  if (filter.keyword) {
    const k = String(filter.keyword).trim().toLowerCase();
    rows = rows.filter(
      (x) => x.username.toLowerCase().includes(k) || (x.displayName || '').toLowerCase().includes(k)
    );
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}
function getAccount(id) {
  return db.accounts.find((x) => x.id === id) || null;
}
function getAccountByUsername(username) {
  const u = String(username || '').trim().toLowerCase();
  return db.accounts.find((x) => x.username.toLowerCase() === u) || null;
}
function createAccount({ username, displayName, role }) {
  const acc = {
    id: uuid(),
    username: String(username).trim(),
    displayName: (displayName || '').trim() || String(username).trim(),
    role, // 'teacher' | 'student'
    status: 'active',
    createdAt: new Date().toISOString()
  };
  db.accounts.push(acc);
  return save().then(() => acc);
}
function updateAccount(id, patch) {
  const acc = getAccount(id);
  if (!acc) return null;
  if (patch.displayName !== undefined) acc.displayName = String(patch.displayName).trim() || acc.username;
  if (patch.role === 'teacher' || patch.role === 'student') acc.role = patch.role;
  if (patch.status === 'active' || patch.status === 'disabled') acc.status = patch.status;
  return save().then(() => acc);
}
function deleteAccount(id) {
  const idx = db.accounts.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  db.accounts.splice(idx, 1);
  // 解除授权与该账号的绑定（授权码仍有效，可重新绑定）
  db.licenses.forEach((lc) => {
    if (lc.accountId === id) {
      lc.accountId = null;
      lc.devices = [];
    }
  });
  return save().then(() => true);
}

// ---------- 产品 ----------
function listProducts(includeOffShelf = true) {
  let rows = db.products.slice();
  if (!includeOffShelf) rows = rows.filter((p) => p.status === 'on');
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}
function getProduct(id) {
  return db.products.find((x) => x.id === id) || null;
}
function createProduct(data) {
  const p = {
    id: uuid(),
    name: String(data.name).trim(),
    code: String(data.code || '').trim() || ('P' + Date.now()),
    description: String(data.description || '').trim(),
    status: data.status === 'off' ? 'off' : 'on',
    createdAt: new Date().toISOString()
  };
  db.products.push(p);
  return save().then(() => p);
}
function updateProduct(id, patch) {
  const p = getProduct(id);
  if (!p) return null;
  if (patch.name !== undefined) p.name = String(patch.name).trim() || p.name;
  if (patch.description !== undefined) p.description = String(patch.description).trim();
  if (patch.status === 'on' || patch.status === 'off') p.status = patch.status;
  return save().then(() => p);
}

// ---------- 授权 ----------
function listLicenses(filter = {}) {
  let rows = db.licenses.slice();
  if (filter.accountId) rows = rows.filter((x) => x.accountId === filter.accountId);
  if (filter.productId) rows = rows.filter((x) => x.productId === filter.productId);
  if (filter.status) rows = rows.filter((x) => x.status === filter.status);
  if (filter.keyword) {
    const k = normalize(filter.keyword);
    rows = rows.filter((x) => x.code.replace(/-/g, '').includes(k));
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}
function getLicense(id) {
  return db.licenses.find((x) => x.id === id) || null;
}
function findLicenseByCode(code) {
  const norm = normalize(code);
  if (!norm) return null;
  return db.licenses.find((x) => x.code.replace(/-/g, '') === norm) || null;
}
function createLicense({ productId, accountId, deviceLimit, validDays, code, note }) {
  const now = new Date();
  const lc = {
    id: uuid(),
    productId,
    accountId: accountId || null,
    code: code || genCode(16),
    deviceLimit: Math.max(1, Math.min(config.MAX_DEVICE_LIMIT, Number(deviceLimit) || 1)),
    devices: [],
    status: 'active', // active | revoked
    createdAt: now.toISOString(),
    activatedAt: accountId ? now.toISOString() : null,
    expiresAt: addDaysISO(now, Number(validDays) > 0 ? Number(validDays) : 365),
    lastVerifiedAt: null,
    note: String(note || '').trim()
  };
  db.licenses.push(lc);
  return save().then(() => lc);
}
function updateLicense(id, patch) {
  const lc = getLicense(id);
  if (!lc) return null;
  if (Number.isFinite(Number(patch.deviceLimit))) {
    lc.deviceLimit = Math.max(1, Math.min(config.MAX_DEVICE_LIMIT, Number(patch.deviceLimit)));
  }
  if (patch.status === 'active' || patch.status === 'revoked') lc.status = patch.status;
  if (patch.note !== undefined) lc.note = String(patch.note).trim();
  return save().then(() => lc);
}
function deleteLicense(id) {
  const idx = db.licenses.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  db.licenses.splice(idx, 1);
  return save().then(() => true);
}
function bindLicense(lc, accountId) {
  const now = new Date().toISOString();
  lc.accountId = accountId;
  if (!lc.activatedAt) lc.activatedAt = now;
  return save();
}
function touchLicense(lc, device) {
  const now = new Date().toISOString();
  lc.lastVerifiedAt = now;
  if (device) {
    const d = lc.devices.find((x) => x.fingerprint === device.fingerprint);
    if (d) {
      d.lastSeenAt = now;
      d.name = device.name || d.name;
    } else {
      lc.devices.push({
        fingerprint: device.fingerprint,
        name: device.name || '未知设备',
        platform: device.platform || '',
        boundAt: now,
        lastSeenAt: now
      });
    }
  }
  return save();
}
function resetDevice(lc, fingerprint) {
  lc.devices = lc.devices.filter((d) => d.fingerprint !== fingerprint);
  return save();
}
function resetAllDevices(lc) {
  lc.devices = [];
  return save();
}
function recordQuery({ username, code, result, reason, ip }) {
  db.queryLogs.push({
    id: uuid(),
    username: String(username || '').slice(0, 64),
    codeMask: maskCode(code),
    result, // success | fail
    reason: reason || null,
    ip: ip || '',
    at: new Date().toISOString()
  });
  if (db.queryLogs.length > 500) db.queryLogs = db.queryLogs.slice(-500);
  return save();
}
function recentLogs(limit = 50) {
  return db.queryLogs.slice(-limit).reverse();
}

// ---------- 统计 ----------
function stats() {
  const licenses = db.licenses;
  const now = Date.now();
  return {
    accountCount: db.accounts.length,
    activeAccountCount: db.accounts.filter((a) => a.status === 'active').length,
    productCount: db.products.length,
    onShelfProductCount: db.products.filter((p) => p.status === 'on').length,
    licenseCount: licenses.length,
    activeLicenseCount: licenses.filter((l) => l.status === 'active' && new Date(l.expiresAt).getTime() > now).length,
    revokedLicenseCount: licenses.filter((l) => l.status === 'revoked').length,
    expiredLicenseCount: licenses.filter((l) => l.status === 'active' && new Date(l.expiresAt).getTime() <= now).length,
    queryToday: db.queryLogs.filter((l) => l.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length
  };
}

// ---------- helpers ----------
function normalize(s) {
  return String(s || '').replace(/[\s-]/g, '').toUpperCase();
}
function maskCode(code) {
  const n = normalize(code);
  if (n.length <= 4) return '****';
  return n.slice(0, 4) + '-****-****-' + n.slice(-4);
}
function addDaysISO(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function cryptoRandom() {
  return require('crypto').randomBytes(8).toString('hex');
}

ensureSeed();

module.exports = {
  save,
  verifyAdmin,
  setAdminPassword,
  getAdmin,
  listAccounts,
  getAccount,
  getAccountByUsername,
  createAccount,
  updateAccount,
  deleteAccount,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  listLicenses,
  getLicense,
  findLicenseByCode,
  createLicense,
  updateLicense,
  deleteLicense,
  bindLicense,
  touchLicense,
  resetDevice,
  resetAllDevices,
  recordQuery,
  recentLogs,
  stats
};
