'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const store = require('./lib/store');
const session = require('./lib/session');
const { normalizeCode, formatCode, safeEqual, sha256 } = require('./lib/util');
const { enrichLicense, licenseState, daysLeft } = require('./lib/license');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// ---------- 响应工具 ----------
function sendJSON(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(json);
}

function fail(res, status, code, message, extra = {}) {
  sendJSON(res, status, Object.assign({ ok: false, code, message }, extra));
}

function clientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- 管理端鉴权 ----------
function requireAdmin(req, res) {
  const token = session.parseCookies(req.headers.cookie).adm_token;
  const s = session.get(token);
  if (!s) {
    fail(res, 401, 'UNAUTHORIZED', '登录状态已失效，请重新登录');
    return null;
  }
  return s;
}

// 面向师生的“可能原因”提示目录（不暴露内部细节）
const QUERY_ERRORS = {
  PARAM_MISSING: {
    status: 400,
    message: '请输入账号和授权码后再查询',
    reasons: ['账号或授权码为空'],
    suggestions: ['请核对后重新输入，授权码中的连字符“-”可省略']
  },
  PARAM_FORMAT: {
    status: 400,
    message: '账号或授权码格式不正确',
    reasons: ['账号应为 3-32 位字母、数字或 . _ @ - 字符', '授权码应为 16 位（通常显示为 XXXX-XXXX-XXXX-XXXX）'],
    suggestions: ['请核对购课/发卡凭证上的信息，注意不要多带空格']
  },
  ACCOUNT_NOT_FOUND: {
    status: 404,
    message: '账号不存在，或该账号尚未开通课程服务',
    reasons: ['账号输入有误（请区分大小写）', '该账号属于其他教学系统，未同步到本站', '账号尚未由管理员开通'],
    suggestions: ['请确认账号拼写，或联系任课老师 / 管理员在后台开通']
  },
  ACCOUNT_DISABLED: {
    status: 403,
    message: '该账号当前处于停用状态，暂时无法查询授权',
    reasons: ['管理员手动停用了该账号', '课程结束、毕业或欠费等原因被批量停用', '账号存在异常使用记录被暂停'],
    suggestions: ['如确有需要，请联系管理员或任课老师核实并恢复']
  },
  CODE_NOT_FOUND: {
    status: 404,
    message: '授权码无效，系统中查询不到该授权',
    reasons: ['授权码抄写有误（请区分大小写，连字符可省略）', '该授权码尚未发放，或已被删除', '把其他平台的激活码误填到了本站'],
    suggestions: ['请对照发卡凭证重新输入；仍失败请联系老师核对授权码']
  },
  LICENSE_REVOKED: {
    status: 403,
    message: '该授权已被停用，无法继续使用课程软件',
    reasons: ['管理员暂停或吊销了该授权', '退费、转班等流程导致授权回收'],
    suggestions: ['如对停用有疑问，请联系管理员或购课渠道处理']
  },
  BOUND_TO_OTHER: {
    status: 403,
    message: '该授权码已绑定其他账号，不能在当前账号下使用',
    reasons: ['授权码实行“一码绑定一账号”，首次核验即完成绑定', '可能由同学或家人先用其他账号激活'],
    suggestions: ['请使用最初绑定的账号登录；如需换绑，请联系管理员处理']
  },
  DEVICE_LIMIT: {
    status: 403,
    message: '设备数量已达到授权上限，新设备无法使用',
    suggestions: ['请在已登记的设备上使用本课程', '如需更换设备，可请管理员在后台清除旧设备后再核验']
  }
};

function queryFail(res, key, extra) {
  const e = QUERY_ERRORS[key];
  fail(res, e.status, key, e.message, { reasons: e.reasons, suggestions: e.suggestions || [], ...extra });
}

// ---------- 业务接口 ----------
async function handleQuery(req, res) {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const codeRaw = String(body.code || '').trim();
  const device = body.device && typeof body.device === 'object' ? body.device : {};

  if (!username || !codeRaw) {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'PARAM_MISSING', ip: clientIP(req) });
    return queryFail(res, 'PARAM_MISSING');
  }
  if (!/^[a-zA-Z0-9_.@-]{3,32}$/.test(username) || !/^[A-Za-z0-9]{16}$/.test(normalizeCode(codeRaw))) {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'PARAM_FORMAT', ip: clientIP(req) });
    return queryFail(res, 'PARAM_FORMAT');
  }

  const account = store.getAccountByUsername(username);
  if (!account) {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'ACCOUNT_NOT_FOUND', ip: clientIP(req) });
    return queryFail(res, 'ACCOUNT_NOT_FOUND');
  }
  if (account.status === 'disabled') {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'ACCOUNT_DISABLED', ip: clientIP(req) });
    return queryFail(res, 'ACCOUNT_DISABLED');
  }

  const lc = store.findLicenseByCode(codeRaw);
  if (!lc) {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'CODE_NOT_FOUND', ip: clientIP(req) });
    return queryFail(res, 'CODE_NOT_FOUND');
  }

  const now = Date.now();

  // 一码绑一号：首次核验自动绑定到当前账号
  if (!lc.accountId) {
    await store.bindLicense(lc, account.id);
  } else if (lc.accountId !== account.id) {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'BOUND_TO_OTHER', ip: clientIP(req) });
    return queryFail(res, 'BOUND_TO_OTHER');
  }

  if (lc.status === 'revoked') {
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'LICENSE_REVOKED', ip: clientIP(req) });
    return queryFail(res, 'LICENSE_REVOKED');
  }

  const product = store.getProduct(lc.productId);
  const state = licenseState(lc, now);

  // 设备登记：仅在授权有效期内进行；过期/停用不再写入新设备
  let deviceBlocked = false;
  let thisDevice = null;
  const fp = String(device.fingerprint || '').slice(0, 64);
  if (state === 'active' || state === 'expiring') {
    if (fp) {
      const existing = lc.devices.find((d) => d.fingerprint === fp);
      if (!existing && lc.devices.length >= lc.deviceLimit) {
        deviceBlocked = true;
      } else if (!deviceBlocked) {
        thisDevice = {
          fingerprint: fp,
          name: String(device.name || '未知设备').slice(0, 60),
          platform: String(device.platform || '').slice(0, 60)
        };
        await store.touchLicense(lc, thisDevice);
      }
    } else {
      await store.touchLicense(lc, null);
    }
  }

  if (deviceBlocked) {
    const other = enrichLicense(lc, product, account, now);
    await store.recordQuery({ username, code: codeRaw, result: 'fail', reason: 'DEVICE_LIMIT', ip: clientIP(req) });
    return queryFail(res, 'DEVICE_LIMIT', {
      deviceLimit: other.deviceLimit,
      deviceCount: other.deviceCount,
      devices: other.devices.map((d) => ({ name: d.name, platform: d.platform, boundAt: d.boundAt }))
    });
  }

  await store.recordQuery({ username, code: codeRaw, result: 'success', reason: state, ip: clientIP(req) });

  const info = enrichLicense(lc, product, account, now);
  const hints = [];
  if (info.state === 'expired') {
    hints.push('授权已过有效期，请续费或联系老师获取新的授权码。');
  } else if (info.state === 'expiring') {
    hints.push(`授权将于 ${info.daysLeft} 天后到期，请尽快联系管理员续费，以免影响使用。`);
  }
  if (info.deviceCount >= info.deviceLimit) {
    hints.push('设备数已达上限，更换新设备前需先由管理员清除旧设备。');
  }

  sendJSON(res, 200, {
    ok: true,
    data: {
      account: {
        username: account.username,
        displayName: account.displayName,
        role: account.role
      },
      license: info,
      hints
    }
  });
}

// ---------- 管理员接口 ----------
async function handleAdmin(req, res, url) {
  const p = url.pathname;

  // 登录 / 登出（无需会话）
  if (p === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const admin = store.getAdmin();
    const okUser = admin && safeEqual(username, admin.username);
    const okPass = store.verifyAdmin(username, password);
    if (!okUser || !okPass) {
      return fail(res, 401, 'BAD_CREDENTIALS', '管理员账号或密码不正确', {
        reasons: ['账号或密码输入有误', '管理员账号由系统初始化分配'],
        suggestions: ['演示环境可使用 admin / admin123，登录后请尽快修改密码']
      });
    }
    const token = session.create(username);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `adm_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.round(config.SESSION_TTL_MS / 1000)}`
    });
    return res.end(JSON.stringify({ ok: true, data: { username } }));
  }
  if (p === '/api/admin/logout' && req.method === 'POST') {
    const token = session.parseCookies(req.headers.cookie).adm_token;
    if (token) session.destroy(token);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'adm_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (!requireAdmin(req, res)) return;

  if (p === '/api/admin/me' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, data: { username: store.getAdmin().username } });
  }

  if (p === '/api/admin/password' && req.method === 'POST') {
    const body = await readBody(req);
    const { oldPassword, newPassword } = body;
    const admin = store.getAdmin();
    if (admin.passwordHash !== sha256(String(oldPassword || '') + admin.salt)) {
      return fail(res, 400, 'BAD_OLD_PASSWORD', '原密码不正确');
    }
    if (!/^.{6,32}$/.test(String(newPassword || ''))) {
      return fail(res, 400, 'WEAK_PASSWORD', '新密码长度需为 6-32 位');
    }
    await store.setAdminPassword(String(newPassword));
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/admin/stats' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, data: store.stats() });
  }
  if (p === '/api/admin/logs' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, data: store.recentLogs(60) });
  }

  // ---- 账号 ----
  if (p === '/api/admin/accounts') {
    if (req.method === 'GET') {
      const rows = store.listAccounts({ keyword: url.searchParams.get('q') || '' });
      const licenses = store.listLicenses({});
      return sendJSON(res, 200, {
        ok: true,
        data: rows.map((a) => ({
          ...a,
          licenseCount: licenses.filter((l) => l.accountId === a.id).length
        }))
      });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      if (!/^[a-zA-Z0-9_.@-]{3,32}$/.test(username)) {
        return fail(res, 400, 'BAD_USERNAME', '账号需为 3-32 位字母、数字或 . _ @ - 字符');
      }
      if (store.getAccountByUsername(username)) {
        return fail(res, 409, 'USER_EXISTS', '该账号已存在，请勿重复添加');
      }
      const role = b.role === 'teacher' ? 'teacher' : 'student';
      const acc = await store.createAccount({ username, displayName: b.displayName || username, role });
      return sendJSON(res, 201, { ok: true, data: acc });
    }
  }
  let m;
  if ((m = p.match(/^\/api\/admin\/accounts\/([\w-]+)$/))) {
    const acc = store.getAccount(m[1]);
    if (!acc) return fail(res, 404, 'NOT_FOUND', '账号不存在');
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      const updated = await store.updateAccount(acc.id, b);
      return sendJSON(res, 200, { ok: true, data: updated });
    }
    if (req.method === 'DELETE') {
      await store.deleteAccount(acc.id);
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ---- 产品 ----
  if (p === '/api/admin/products') {
    if (req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, data: store.listProducts(true) });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      if (!name) return fail(res, 400, 'BAD_NAME', '产品名称不能为空');
      if (name.length > 80) return fail(res, 400, 'NAME_TOO_LONG', '产品名称不能超过 80 字');
      const product = await store.createProduct({
        name,
        code: b.code,
        description: b.description,
        status: b.status
      });
      return sendJSON(res, 201, { ok: true, data: product });
    }
  }
  if ((m = p.match(/^\/api\/admin\/products\/([\w-]+)$/))) {
    const product = store.getProduct(m[1]);
    if (!product) return fail(res, 404, 'NOT_FOUND', '产品不存在');
    if (req.method === 'PATCH') {
      const updated = await store.updateProduct(product.id, await readBody(req));
      return sendJSON(res, 200, { ok: true, data: updated });
    }
  }

  // ---- 授权 ----
  if (p === '/api/admin/licenses') {
    if (req.method === 'GET') {
      const status = url.searchParams.get('status') || '';
      const q = url.searchParams.get('q') || '';
      const now = Date.now();
      let rows = store.listLicenses({ keyword: q });
      if (status === 'active' || status === 'revoked') rows = rows.filter((l) => l.status === status);
      if (status === 'expired') rows = rows.filter((l) => l.status === 'active' && new Date(l.expiresAt).getTime() <= now);
      if (status === 'expiring')
        rows = rows.filter((l) => {
          const d = daysLeft(l.expiresAt, now);
          return l.status === 'active' && d >= 0 && d <= 30;
        });
      return sendJSON(res, 200, {
        ok: true,
        data: rows.map((l) =>
          enrichLicense(l, store.getProduct(l.productId), l.accountId ? store.getAccount(l.accountId) : null, now)
        )
      });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const product = store.getProduct(String(b.productId || ''));
      if (!product) return fail(res, 400, 'BAD_PRODUCT', '请选择要授权的课程产品');
      const deviceLimit = Number(b.deviceLimit);
      if (!Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > config.MAX_DEVICE_LIMIT) {
        return fail(res, 400, 'BAD_DEVICE_LIMIT', `设备数量须为 1-${config.MAX_DEVICE_LIMIT} 的整数`);
      }
      const validDays = Number(b.validDays);
      if (!Number.isFinite(validDays) || validDays <= 0 || validDays > 3650) {
        return fail(res, 400, 'BAD_DAYS', '有效天数须为 1-3650 之间的数字');
      }
      let accountId = null;
      if (b.accountId) {
        const acc = store.getAccount(String(b.accountId));
        if (!acc) return fail(res, 400, 'BAD_ACCOUNT', '所选账号不存在');
        accountId = acc.id;
      }
      let code = '';
      if (b.code && String(b.code).trim()) {
        code = normalizeCode(b.code);
        if (!/^[A-Z0-9]{16}$/.test(code)) return fail(res, 400, 'BAD_CODE', '自定义授权码须为 16 位字母或数字');
        if (store.findLicenseByCode(code)) return fail(res, 409, 'CODE_EXISTS', '该授权码已存在，请勿重复添加');
      }
      const lc = await store.createLicense({
        productId: product.id,
        accountId,
        deviceLimit,
        validDays,
        code: code ? formatCode(code) : '',
        note: b.note || ''
      });
      return sendJSON(res, 201, { ok: true, data: enrichLicense(lc, product, accountId ? store.getAccount(accountId) : null) });
    }
  }
  if ((m = p.match(/^\/api\/admin\/licenses\/([\w-]+)$/))) {
    const lc = store.getLicense(m[1]);
    if (!lc) return fail(res, 404, 'NOT_FOUND', '授权不存在');
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (b.accountId !== undefined) {
        if (b.accountId === null || b.accountId === '') {
          lc.accountId = null;
          lc.activatedAt = null;
          lc.devices = [];
        } else {
          const acc = store.getAccount(String(b.accountId));
          if (!acc) return fail(res, 400, 'BAD_ACCOUNT', '所选账号不存在');
          lc.accountId = acc.id;
          if (!lc.activatedAt) lc.activatedAt = new Date().toISOString();
        }
        await store.save();
      }
      const updated = await store.updateLicense(lc.id, b);
      const product = store.getProduct(updated.productId);
      const account = updated.accountId ? store.getAccount(updated.accountId) : null;
      return sendJSON(res, 200, { ok: true, data: enrichLicense(updated, product, account) });
    }
    if (req.method === 'DELETE') {
      await store.deleteLicense(lc.id);
      return sendJSON(res, 200, { ok: true });
    }
  }
  if ((m = p.match(/^\/api\/admin\/licenses\/([\w-]+)\/devices$/))) {
    const lc = store.getLicense(m[1]);
    if (!lc) return fail(res, 404, 'NOT_FOUND', '授权不存在');
    if (req.method === 'DELETE') {
      const b = await readBody(req);
      if (b.fingerprint) await store.resetDevice(lc, String(b.fingerprint));
      else await store.resetAllDevices(lc);
      return sendJSON(res, 200, { ok: true });
    }
  }

  return fail(res, 404, 'API_NOT_FOUND', '接口不存在');
}

// ---------- 静态文件 ----------
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  // 禁止访问 data / lib 等目录
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><h2>页面不存在</h2><a href="/">返回首页</a>');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...(ext === '.html' ? { 'Cache-Control': 'no-store' } : { 'Cache-Control': 'public, max-age=3600' })
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- 服务器 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const start = Date.now();
  try {
    if (url.pathname === '/api/query' && req.method === 'POST') return await handleQuery(req, res);
    if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, url);
    if (url.pathname.startsWith('/api/')) return fail(res, 404, 'API_NOT_FOUND', '接口不存在');
    return serveStatic(req, res, url);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') return fail(res, 413, 'BODY_TOO_LARGE', '提交内容过大，请精简后重试');
    if (err.message === 'BAD_JSON') return fail(res, 400, 'BAD_JSON', '提交的数据格式不正确，请刷新页面后重试');
    // 真实异常：记录细节到服务端，对外只给友好提示（不出现“系统错误/500”字样）
    console.error(`[ERROR] ${req.method} ${url.pathname}`, err);
    return fail(res, 500, 'SERVICE_BUSY', '查询服务暂时开了小差，请稍后再试', {
      reasons: ['当前查询人数较多，服务响应超时', '网络连接不稳定导致请求未完成'],
      suggestions: ['请稍等 1 分钟后重新查询；若多次尝试仍失败，请联系管理员并告知操作时间']
    });
  } finally {
    console.log(`${req.method} ${url.pathname} ${res.statusCode || 200} ${Date.now() - start}ms`);
  }
});

server.listen(config.PORT, () => {
  console.log('==============================================');
  console.log('  课程软件授权核验站已启动');
  console.log(`  师生核验页:  http://localhost:${config.PORT}/`);
  console.log(`  管理后台:    http://localhost:${config.PORT}/admin`);
  console.log('  默认管理员:  admin / admin123');
  console.log('==============================================');
});
