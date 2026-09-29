const fs = require('fs');
const path = require('path');
const { hashPassword, generateAuthCode } = require('./crypto-util');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = null;
let writeTimer = null;
let writeChain = Promise.resolve();

function nowISO() { return new Date().toISOString(); }
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function seed() {
  const t = Date.now();
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString();
  return {
    version: 1,
    admins: [
      { id: 'adm_seed', username: 'admin', password: hashPassword('admin123'), createdAt: iso(t) }
    ],
    products: [
      { id: 'prod_math',   name: '高等数学精讲课程包', version: 'v3.2', status: 'on', createdAt: iso(t) },
      { id: 'prod_english', name: '大学英语四级冲刺',  version: 'v2.0', status: 'on', createdAt: iso(t) },
      { id: 'prod_code',    name: 'Python 编程实训软件', version: 'v5.1', status: 'on', createdAt: iso(t) },
      { id: 'prod_physics', name: '大学物理仿真实验',  version: 'v1.8', status: 'off', createdAt: iso(t) }
    ],
    licenses: [
      {
        id: uid('lic'), account: 'teacher01', authCode: 'EDU-DEMO-2026-TEAC',
        holder: '王老师', productIds: ['prod_math', 'prod_code'],
        deviceLimit: 5, devicesUsed: 2,
        activatedAt: iso(t - 30 * day), expiresAt: iso(t + 335 * day),
        status: 'active', createdAt: iso(t - 30 * day), note: '计算机学院统一采购'
      },
      {
        id: uid('lic'), account: 'student01', authCode: 'EDU-DEMO-2026-STUD',
        holder: '李同学', productIds: ['prod_english'],
        deviceLimit: 2, devicesUsed: 1,
        activatedAt: iso(t - 120 * day), expiresAt: iso(t - 5 * day),
        status: 'active', createdAt: iso(t - 120 * day), note: '已到期示例'
      },
      {
        id: uid('lic'), account: 'student02', authCode: 'EDU-DEMO-2026-STOP',
        holder: '赵同学', productIds: ['prod_math'],
        deviceLimit: 2, devicesUsed: 0,
        activatedAt: iso(t - 10 * day), expiresAt: iso(t + 355 * day),
        status: 'disabled', createdAt: iso(t - 10 * day), note: '停用示例：设备数超限'
      }
    ],
    sessions: [] // { token, adminId, createdAt, expiresAt }
  };
}

function load() {
  if (db) return db;
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      db = seed();
      persist(true);
    }
  } catch (e) {
    // 数据文件损坏：备份后重建，保证服务可用
    const backup = DB_FILE + '.corrupt.' + Date.now();
    try { fs.copyFileSync(DB_FILE, backup); } catch (_) {}
    db = seed();
    persist(true);
  }
  return db;
}

function persist(sync = false) {
  if (sync) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
    return;
  }
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeChain = writeChain.then(() => {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_FILE);
    }).catch(() => {});
  }, 50);
}

// ---------- 管理员 ----------
function findAdminByName(username) {
  return load().admins.find(a => a.username === String(username).trim().toLowerCase());
}
function findAdminById(id) { return load().admins.find(a => a.id === id); }
function createAdmin(username, password) {
  const d = load();
  const a = { id: uid('adm'), username: username.trim().toLowerCase(), password: hashPassword(password), createdAt: nowISO() };
  d.admins.push(a); persist();
  return a;
}

// ---------- 会话 ----------
function createSession(adminId) {
  const d = load();
  const s = { token: require('crypto').randomBytes(32).toString('hex'), adminId, createdAt: nowISO(), expiresAt: new Date(Date.now() + 8 * 3600000).toISOString() };
  d.sessions.push(s); persist();
  return s;
}
function findSession(token) {
  if (!token) return null;
  const s = load().sessions.find(x => x.token === token);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    db.sessions = db.sessions.filter(x => x.token !== token); persist();
    return null;
  }
  return s;
}
function destroySession(token) {
  const d = load();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter(s => s.token !== token);
  if (d.sessions.length !== before) persist();
}

// ---------- 产品 ----------
function listProducts(includeOff = true) {
  return load().products.filter(p => includeOff || p.status === 'on');
}
function getProduct(id) { return load().products.find(p => p.id === id); }
function createProduct({ name, version }) {
  const d = load();
  const p = { id: uid('prod'), name: String(name).trim(), version: String(version || '').trim() || '-', status: 'on', createdAt: nowISO() };
  d.products.push(p); persist();
  return p;
}
function updateProduct(id, fields) {
  const p = getProduct(id);
  if (!p) return null;
  if (fields.name !== undefined) p.name = String(fields.name).trim();
  if (fields.version !== undefined) p.version = String(fields.version).trim() || '-';
  if (fields.status !== undefined) p.status = fields.status === 'off' ? 'off' : 'on';
  persist();
  return p;
}

// ---------- 授权 ----------
function findLicenseByAccount(account) {
  const acc = String(account || '').trim().toLowerCase();
  return load().licenses.find(l => l.account.toLowerCase() === acc);
}
function getLicense(id) { return load().licenses.find(l => l.id === id); }

function listLicenses({ keyword = '', page = 1, pageSize = 10, status = '', productId = '' } = {}) {
  let items = load().licenses.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const kw = String(keyword).trim().toLowerCase();
  if (kw) items = items.filter(l =>
    l.account.toLowerCase().includes(kw) ||
    (l.holder || '').toLowerCase().includes(kw) ||
    l.authCode.toLowerCase().includes(kw.replace(/[^a-z0-9]/gi, ''))
  );
  if (status) items = items.filter(l => l.status === status);
  if (productId) items = items.filter(l => l.productIds.includes(productId));
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { total, page, pageSize, items: items.slice(start, start + pageSize) };
}

function createLicense({ account, holder, productIds, deviceLimit, validDays, authCode, activatedAt, note }) {
  const d = load();
  const start = activatedAt ? new Date(activatedAt) : new Date();
  const lic = {
    id: uid('lic'),
    account: String(account).trim(),
    authCode: authCode || generateAuthCode(),
    holder: String(holder || '').trim(),
    productIds: Array.isArray(productIds) ? productIds : [],
    deviceLimit: Math.max(1, parseInt(deviceLimit, 10) || 1),
    devicesUsed: 0,
    activatedAt: start.toISOString(),
    expiresAt: new Date(start.getTime() + Math.max(1, parseInt(validDays, 10) || 365) * 86400000).toISOString(),
    status: 'active',
    createdAt: nowISO(),
    note: String(note || '').trim()
  };
  d.licenses.push(lic); persist();
  return lic;
}

function updateLicense(id, fields) {
  const l = getLicense(id);
  if (!l) return null;
  if (fields.holder !== undefined) l.holder = String(fields.holder).trim();
  if (Array.isArray(fields.productIds)) l.productIds = fields.productIds;
  if (fields.deviceLimit !== undefined) l.deviceLimit = Math.max(0, parseInt(fields.deviceLimit, 10) || 0);
  if (fields.devicesUsed !== undefined) l.devicesUsed = Math.max(0, parseInt(fields.devicesUsed, 10) || 0);
  if (fields.expiresAt) l.expiresAt = new Date(fields.expiresAt).toISOString();
  if (fields.activatedAt) l.activatedAt = new Date(fields.activatedAt).toISOString();
  if (fields.status) l.status = fields.status === 'disabled' ? 'disabled' : 'active';
  if (fields.note !== undefined) l.note = String(fields.note).trim();
  persist();
  return l;
}

function setLicenseStatus(id, status) {
  const l = getLicense(id);
  if (!l) return null;
  l.status = status === 'disabled' ? 'disabled' : 'active';
  persist();
  return l;
}

function stats() {
  const d = load();
  const t = Date.now();
  let active = 0, disabled = 0, expired = 0;
  for (const l of d.licenses) {
    if (l.status === 'disabled') { disabled++; continue; }
    if (new Date(l.expiresAt).getTime() < t) expired++; else active++;
  }
  return { total: d.licenses.length, active, disabled, expired, products: d.products.length };
}

module.exports = {
  load, nowISO,
  findAdminByName, findAdminById, createAdmin,
  createSession, findSession, destroySession,
  listProducts, getProduct, createProduct, updateProduct,
  findLicenseByAccount, getLicense, listLicenses,
  createLicense, updateLicense, setLicenseStatus, stats
};
