const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { verifyPassword, formatCode, normCode } = require('./crypto-util');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------- 限流（内存，按 IP + 动作） ----------------
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  return b.count <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60000).unref();

// ---------------- 工具 ----------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  return (req.socket.remoteAddress || '') + '|' + (req.headers['x-forwarded-for'] || '');
}

// 查询失败的“可能原因”，不暴露系统内部错误
const FAIL_REASONS = [
  '账号或授权码输入有误，请核对大小写与字符（数字 0 与字母 O、数字 1 与字母 I/L 容易混淆）',
  '授权码尚未开通，请联系管理员或任课老师完成发放',
  '授权可能已被停用（如设备数超出限制或申请信息不符）',
  '请确认使用的是本人账号，授权码与账号为一一对应关系'
];

function licenseView(l, products) {
  const now = Date.now();
  const exp = new Date(l.expiresAt).getTime();
  let state;
  if (l.status === 'disabled') state = 'disabled';
  else if (exp < now) state = 'expired';
  else if (exp - now < 15 * 86400000) state = 'expiring';
  else state = 'active';

  const daysLeft = state === 'disabled' ? null : Math.ceil((exp - now) / 86400000);
  return {
    id: l.id,
    account: l.account,
    authCode: l.authCode,
    holder: l.holder,
    products: l.productIds
      .map(pid => products.find(p => p.id === pid))
      .filter(Boolean)
      .map(p => ({ id: p.id, name: p.name, version: p.version, available: p.status === 'on' })),
    deviceLimit: l.deviceLimit,
    devicesUsed: l.devicesUsed,
    activatedAt: l.activatedAt,
    expiresAt: l.expiresAt,
    state,
    daysLeft,
    note: state === 'disabled' ? (l.note || '该授权已被管理员停用') : undefined
  };
}

// ---------------- 业务接口 ----------------
async function handleQuery(req, res) {
  const ip = clientIp(req);
  if (!rateLimit('query:' + ip, 15, 5 * 60000)) {
    return sendJSON(res, 429, {
      ok: false,
      code: 'RATE_LIMITED',
      title: '查询过于频繁',
      message: '为保障账号安全，请稍等 5 分钟后再试。如急需查询，请联系管理员。'
    });
  }
  const body = await readBody(req).catch(() => null);
  if (!body) {
    return sendJSON(res, 400, {
      ok: false, code: 'BAD_INPUT', title: '提交内容无法识别',
      message: '请在页面表单中正常填写账号与授权码后重试，不要直接调用接口。'
    });
  }
  const account = String(body.account || '').trim();
  const codeRaw = String(body.authCode || '').trim();

  if (!account || !codeRaw) {
    return sendJSON(res, 200, {
      ok: false, code: 'MISSING_FIELDS', title: '信息未填写完整',
      message: '请同时输入账号和授权码后再进行查询。'
    });
  }
  if (account.length > 64 || codeRaw.length > 40) {
    return sendJSON(res, 200, { ok: false, code: 'INVALID_INPUT', title: '输入格式有误', message: FAIL_REASONS[0] });
  }

  const lic = store.findLicenseByAccount(account);
  const codeFormatted = formatCode(codeRaw);
  const codeMatched = lic && normCode(lic.authCode) === normCode(codeFormatted);

  if (!lic || !codeMatched) {
    // 防止用授权码反查账号：统一提示，不区分到底是哪个不对
    return sendJSON(res, 200, {
      ok: false, code: 'NOT_FOUND', title: '未查询到有效授权',
      message: '根据您提供的账号与授权码，未能找到对应的授权记录。可能的原因：',
      reasons: FAIL_REASONS
    });
  }

  const products = store.listProducts(true);
  const view = licenseView(lic, products);

  if (view.state === 'disabled') {
    return sendJSON(res, 200, {
      ok: true, status: 'disabled',
      title: '该授权当前已停用',
      message: '您的账号授权已被停用，暂时无法使用课程软件。',
      data: { account: view.account, holder: view.holder, reason: view.note, activatedAt: view.activatedAt }
    });
  }

  if (view.state === 'expired') {
    return sendJSON(res, 200, {
      ok: true, status: 'expired',
      title: '授权已到期',
      message: '该授权的有效期已经结束。如需继续使用，请联系管理员或任课老师续费。',
      data: view
    });
  }

  return sendJSON(res, 200, { ok: true, status: view.state, data: view });
}

// ---------------- 管理端鉴权 ----------------
function requireAuth(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = store.findSession(token);
  if (!session) {
    sendJSON(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' });
    return null;
  }
  const admin = store.findAdminById(session.adminId);
  if (!admin) {
    sendJSON(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '账号不存在，请重新登录' });
    return null;
  }
  return admin;
}

function handleAdminLogin(req, res) {
  return readBody(req).then(body => {
    const ip = clientIp(req);
    if (!rateLimit('login:' + ip, 6, 10 * 60000)) {
      return sendJSON(res, 429, { ok: false, message: '登录尝试过多，为安全起见请 10 分钟后再试' });
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const admin = store.findAdminByName(username);
    if (!admin || !verifyPassword(password, admin.password)) {
      return sendJSON(res, 200, { ok: false, message: '账号或密码不正确（默认管理员 admin / admin123）' });
    }
    const session = store.createSession(admin.id);
    sendJSON(res, 200, { ok: true, token: session.token, username: admin.username, expiresAt: session.expiresAt });
  }).catch(() => sendJSON(res, 400, { ok: false, message: '提交内容格式有误' }));
}

function handleAdminLogout(req, res) {
  const admin = requireAuth(req, res);
  if (!admin) return;
  const token = (req.headers['authorization'] || '').slice(7);
  store.destroySession(token);
  sendJSON(res, 200, { ok: true });
}

function handleStats(req, res) {
  if (!requireAuth(req, res)) return;
  sendJSON(res, 200, { ok: true, stats: store.stats() });
}

function handleProducts(req, res, method) {
  if (!requireAuth(req, res)) return;
  if (method === 'GET') return sendJSON(res, 200, { ok: true, items: store.listProducts(true) });
  if (method === 'POST') {
    return readBody(req).then(body => {
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { ok: false, message: '请填写产品名称' });
      if (name.length > 60) return sendJSON(res, 400, { ok: false, message: '产品名称过长（最多 60 字）' });
      const p = store.createProduct({ name, version: body.version });
      sendJSON(res, 200, { ok: true, item: p });
    }).catch(() => sendJSON(res, 400, { ok: false, message: '提交内容格式有误' }));
  }
}

function handleProductItem(req, res, method, id) {
  if (!requireAuth(req, res)) return;
  const p = store.getProduct(id);
  if (!p) return sendJSON(res, 404, { ok: false, message: '产品不存在或已被删除' });
  if (method === 'PATCH') {
    return readBody(req).then(body => sendJSON(res, 200, { ok: true, item: store.updateProduct(id, body) }))
      .catch(() => sendJSON(res, 400, { ok: false, message: '提交内容格式有误' }));
  }
}

function handleLicenses(req, res, method) {
  if (!requireAuth(req, res)) return;
  if (method === 'GET') {
    const u = new URL(req.url, 'http://x');
    const page = Math.max(1, parseInt(u.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(u.searchParams.get('pageSize') || '10', 10)));
    const result = store.listLicenses({
      keyword: u.searchParams.get('keyword') || '',
      status: u.searchParams.get('status') || '',
      productId: u.searchParams.get('productId') || '',
      page, pageSize
    });
    const products = store.listProducts(true);
    result.items = result.items.map(l => licenseView(l, products));
    return sendJSON(res, 200, { ok: true, ...result });
  }
  if (method === 'POST') {
    return readBody(req).then(body => {
      const account = String(body.account || '').trim();
      if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(account)) {
        return sendJSON(res, 400, { ok: false, message: '账号需为 3-64 位字母、数字或 _ . @ - 字符' });
      }
      if (store.findLicenseByAccount(account)) {
        return sendJSON(res, 400, { ok: false, message: '该账号已存在授权，请勿重复开通；可在列表中直接编辑' });
      }
      const productIds = Array.isArray(body.productIds) ? body.productIds : [];
      const validIds = store.listProducts(true).filter(p => p.status === 'on').map(p => p.id);
      const picked = [...new Set(productIds)].filter(id => validIds.includes(id));
      if (picked.length === 0) return sendJSON(res, 400, { ok: false, message: '请至少选择一个在售课程产品' });
      const deviceLimit = parseInt(body.deviceLimit, 10);
      if (!(deviceLimit >= 1 && deviceLimit <= 999)) return sendJSON(res, 400, { ok: false, message: '设备数量需在 1-999 之间' });
      const validDays = parseInt(body.validDays, 10);
      if (!(validDays >= 1 && validDays <= 3650)) return sendJSON(res, 400, { ok: false, message: '有效天数需在 1-3650 之间' });

      let code;
      if (body.authCode && String(body.authCode).trim()) {
        code = formatCode(body.authCode);
        if (!/^EDU-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
          return sendJSON(res, 400, { ok: false, message: '自定义授权码格式需为 EDU-XXXX-XXXX-XXXX（仅大写字母与数字）' });
        }
      }
      const lic = store.createLicense({
        account, holder: body.holder, productIds: picked,
        deviceLimit, validDays, authCode: code,
        activatedAt: body.activatedAt, note: body.note
      });
      sendJSON(res, 200, { ok: true, item: licenseView(lic, store.listProducts(true)) });
    }).catch(() => sendJSON(res, 400, { ok: false, message: '提交内容格式有误' }));
  }
}

function handleLicenseItem(req, res, method, id, action) {
  if (!requireAuth(req, res)) return;
  const lic = store.getLicense(id);
  if (!lic) return sendJSON(res, 404, { ok: false, message: '授权记录不存在' });

  if (action === 'disable' && method === 'POST') {
    return readBody(req).then(body => {
      const updated = store.setLicenseStatus(id, 'disabled');
      if (body.reason) store.updateLicense(id, { note: String(body.reason).slice(0, 100) });
      sendJSON(res, 200, { ok: true, item: licenseView(updated, store.listProducts(true)) });
    }).catch(() => sendJSON(res, 400, { ok: false, message: '提交内容格式有误' }));
  }
  if (action === 'enable' && method === 'POST') {
    const updated = store.setLicenseStatus(id, 'active');
    return sendJSON(res, 200, { ok: true, item: licenseView(updated, store.listProducts(true)) });
  }
  if (!action && method === 'PATCH') {
    return readBody(req).then(body => {
      const updated = store.updateLicense(id, body);
      sendJSON(res, 200, { ok: true, item: licenseView(updated, store.listProducts(true)) });
    }).catch(() => sendJSON(res, 400, { ok: false, message: '提交内容格式有误' }));
  }
  sendJSON(res, 404, { ok: false, message: '未找到对应的操作' });
}

// ---------------- 静态文件 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      file = path.join(PUBLIC_DIR, 'index.html'); // SPA 回退
    }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('Not Found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

// ---------------- 路由 ----------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const m = req.method;
  try {
    if (p === '/api/query' && m === 'POST') return await handleQuery(req, res);
    if (p === '/api/admin/login' && m === 'POST') return handleAdminLogin(req, res);
    if (p === '/api/admin/logout' && m === 'POST') return handleAdminLogout(req, res);
    if (p === '/api/admin/stats' && m === 'GET') return handleStats(req, res);
    if (p === '/api/admin/products') return handleProducts(req, res, m);
    let mm = p.match(/^\/api\/admin\/products\/([\w-]+)$/);
    if (mm) return handleProductItem(req, res, m, mm[1]);
    if (p === '/api/admin/licenses') return handleLicenses(req, res, m);
    mm = p.match(/^\/api\/admin\/licenses\/([\w-]+)(?:\/(enable|disable))?$/);
    if (mm) return handleLicenseItem(req, res, m, mm[1], mm[2]);
    if (p.startsWith('/api/')) return sendJSON(res, 404, { ok: false, message: '接口不存在' });
    return serveStatic(req, res, p);
  } catch (err) {
    // 兜底：对用户不暴露技术错误
    if (p.startsWith('/api/query')) {
      return sendJSON(res, 200, {
        ok: false, code: 'TRY_AGAIN', title: '查询暂时未能完成',
        message: '当前查询服务繁忙，请稍后重试；若多次出现，请联系管理员核对授权信息。'
      });
    }
    sendJSON(res, 500, { ok: false, message: '服务暂时不可用，请稍后重试' });
  }
});

server.listen(PORT, () => {
  store.load();
  console.log(`课程软件授权核验站已启动: http://localhost:${PORT}`);
  console.log(`管理后台: http://localhost:${PORT}/admin.html  (默认账号 admin / admin123)`);
});
