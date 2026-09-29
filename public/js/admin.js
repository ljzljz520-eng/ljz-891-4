/* ============ 管理后台 ============ */
const state = {
  tab: 'dashboard',
  products: [],
  accounts: [],
  licenses: []
};

const TAB_TITLES = { dashboard: '概览', licenses: '授权管理', accounts: '账号管理', products: '产品管理' };

// ---------- 启动 ----------
async function boot() {
  bindChrome();
  try {
    const me = await api('/api/admin/me');
    enterApp(me.data.username);
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('appPage').style.display = 'none';
}
function enterApp(username) {
  document.getElementById('adminUser').textContent = username;
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'flex';
  switchTab('dashboard');
}

function bindChrome() {
  document.getElementById('loginForm').addEventListener('submit', doLogin);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    location.reload();
  });
  document.getElementById('changePwdBtn').addEventListener('click', openChangePwd);
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });
  // 账号/授权搜索
  document.getElementById('accountSearchBtn').addEventListener('click', loadAccounts);
  document.getElementById('accountSearch').addEventListener('keydown', (e) => e.key === 'Enter' && loadAccounts());
  document.getElementById('licenseSearchBtn').addEventListener('click', loadLicenses);
  document.getElementById('licenseSearch').addEventListener('keydown', (e) => e.key === 'Enter' && loadLicenses());
  document.getElementById('licenseStatusFilter').addEventListener('change', loadLicenses);
  // 新增按钮
  document.getElementById('addAccountBtn').addEventListener('click', openAccountForm);
  document.getElementById('addProductBtn').addEventListener('click', openProductForm);
  document.getElementById('addLicenseBtn').addEventListener('click', openLicenseForm);
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errBox = document.getElementById('loginError');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    const r = await api('/api/admin/login', {
      method: 'POST',
      body: {
        username: document.getElementById('loginUser').value.trim(),
        password: document.getElementById('loginPass').value
      }
    });
    enterApp(r.data.username);
  } catch (err) {
    const p = err.payload || {};
    const reasons = (p.reasons || []).map((x) => '· ' + x).join('<br>');
    errBox.innerHTML = esc(p.message || err.message) + (reasons ? '<br>' + reasons : '');
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((el) => (el.style.display = el.dataset.panel === tab ? 'block' : 'none'));
  document.getElementById('pageTitle').textContent = TAB_TITLES[tab];
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'licenses') loadLicenses();
  if (tab === 'accounts') loadAccounts();
  if (tab === 'products') loadProducts();
}

// ---------- 修改密码 ----------
function openChangePwd() {
  Modal.open({
    title: '修改管理员密码',
    bodyHTML: `
      <div class="field"><label>原密码</label><input id="cpOld" type="password" autocomplete="off" /></div>
      <div class="field"><label>新密码（6-32 位）</label><input id="cpNew" type="password" autocomplete="new-password" /></div>
      <div class="field"><label>再次输入新密码</label><input id="cpNew2" type="password" autocomplete="new-password" /></div>`,
    okText: '保存',
    onOk: async () => {
      const o = document.getElementById('cpOld').value;
      const n = document.getElementById('cpNew').value;
      const n2 = document.getElementById('cpNew2').value;
      if (n.length < 6 || n.length > 32) throw new Error('新密码长度需为 6-32 位');
      if (n !== n2) throw new Error('两次输入的新密码不一致');
      await api('/api/admin/password', { method: 'POST', body: { oldPassword: o, newPassword: n } });
      toast('密码修改成功，下次登录请使用新密码', 'success');
    }
  });
}

// ---------- 概览 ----------
const LOG_REASON_TEXT = {
  success: '核验成功', active: '使用中', expiring: '即将到期', expired: '已过期',
  PARAM_MISSING: '缺少参数', PARAM_FORMAT: '格式不正确', ACCOUNT_NOT_FOUND: '账号不存在',
  ACCOUNT_DISABLED: '账号已停用', CODE_NOT_FOUND: '授权码无效', LICENSE_REVOKED: '授权已停用',
  BOUND_TO_OTHER: '绑定其他账号', DEVICE_LIMIT: '设备数超限', SERVICE_BUSY: '服务繁忙'
};

async function loadDashboard() {
  const [s, logs] = await Promise.all([api('/api/admin/stats'), api('/api/admin/logs')]);
  const d = s.data;
  const cards = [
    { icon: '👥', cls: 'ic-blue', num: d.accountCount, label: `账号总数（启用 ${d.activeAccountCount}）` },
    { icon: '🔑', cls: 'ic-green', num: d.activeLicenseCount, label: `有效授权（共 ${d.licenseCount}）` },
    { icon: '📦', cls: 'ic-purple', num: d.onShelfProductCount, label: `在售产品（共 ${d.productCount}）` },
    { icon: '⏰', cls: 'ic-orange', num: d.expiredLicenseCount, label: '30天内到期/已过期提示' },
    { icon: '⛔', cls: 'ic-red', num: d.revokedLicenseCount, label: '已停用授权' },
    { icon: '🔎', cls: 'ic-cyan', num: d.queryToday, label: '今日核验次数' }
  ];
  document.getElementById('statGrid').innerHTML = cards
    .map((c) => `
      <div class="stat-card">
        <div class="icon ${c.cls}">${c.icon}</div>
        <div><div class="num">${c.num}</div><div class="label">${esc(c.label)}</div></div>
      </div>`)
    .join('');

  const tbody = document.getElementById('logTbody');
  tbody.innerHTML = (logs.data || []).length
    ? logs.data
        .map(
          (l) => `
        <tr>
          <td>${fmtDateTime(l.at)}</td>
          <td>${esc(l.username || '—')}</td>
          <td class="code-cell">${esc(l.codeMask || '—')}</td>
          <td class="${l.result === 'success' ? 'log-ok' : 'log-fail'}">${l.result === 'success' ? '成功' : '失败'}</td>
          <td>${esc(LOG_REASON_TEXT[l.reason] || l.reason || '—')}</td>
          <td>${esc(l.ip || '—')}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">暂无核验记录</td></tr>';
}

// ---------- 账号 ----------
async function loadAccounts() {
  const q = document.getElementById('accountSearch').value.trim();
  const rows = (await api('/api/admin/accounts' + (q ? '?q=' + encodeURIComponent(q) : ''))).data;
  state.accounts = rows;
  const tbody = document.getElementById('accountTbody');
  tbody.innerHTML = rows.length
    ? rows
        .map(
          (a) => `
      <tr>
        <td><strong>${esc(a.username)}</strong></td>
        <td>${esc(a.displayName)}</td>
        <td><span class="badge badge-role ${a.role === 'teacher' ? 'teacher' : ''}">${a.role === 'teacher' ? '教师' : '学生'}</span></td>
        <td>${a.status === 'active'
          ? '<span class="badge badge-active">启用中</span>'
          : '<span class="badge badge-revoked">已停用</span>'}</td>
        <td>${a.licenseCount}</td>
        <td>${fmtDate(a.createdAt)}</td>
        <td><div class="op-cell">
          <button class="btn btn-default btn-sm" data-act="toggle" data-id="${a.id}">${a.status === 'active' ? '停用' : '启用'}</button>
          <button class="btn btn-default btn-sm" data-act="edit" data-id="${a.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-act="del" data-id="${a.id}">删除</button>
        </div></td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty">没有符合条件的账号</td></tr>';

  tbody.querySelectorAll('button[data-act]').forEach((btn) =>
    btn.addEventListener('click', () => accountAction(btn.dataset.act, btn.dataset.id))
  );
}

function openAccountForm(acc) {
  const isEdit = !!acc;
  Modal.open({
    title: isEdit ? '编辑账号' : '添加账号',
    bodyHTML: `
      <div class="field"><label>登录账号（3-32 位字母/数字）</label>
        <input id="accUsername" value="${esc(acc ? acc.username : '')}" ${isEdit ? 'disabled' : ''} placeholder="如 student03" /></div>
      <div class="field"><label>姓名 / 显示名</label>
        <input id="accName" value="${esc(acc ? acc.displayName : '')}" /></div>
      <div class="field"><label>身份</label>
        <select id="accRole">
          <option value="student" ${acc && acc.role === 'student' ? 'selected' : ''}>学生</option>
          <option value="teacher" ${acc && acc.role === 'teacher' ? 'selected' : ''}>教师</option>
        </select></div>
      ${isEdit ? `<div class="field"><label>账号状态</label>
        <select id="accStatus">
          <option value="active" ${acc.status === 'active' ? 'selected' : ''}>启用</option>
          <option value="disabled" ${acc.status === 'disabled' ? 'selected' : ''}>停用</option>
        </select></div>` : ''}`,
    okText: isEdit ? '保存' : '添加',
    onOk: async () => {
      const username = document.getElementById('accUsername').value.trim();
      const displayName = document.getElementById('accName').value.trim();
      const role = document.getElementById('accRole').value;
      if (isEdit) {
        const patch = { displayName, role };
        const st = document.getElementById('accStatus');
        if (st) patch.status = st.value;
        await api('/api/admin/accounts/' + acc.id, { method: 'PATCH', body: patch });
        toast('账号已更新', 'success');
      } else {
        await api('/api/admin/accounts', { method: 'POST', body: { username, displayName, role } });
        toast('账号添加成功', 'success');
      }
      loadAccounts();
    }
  });
}

async function accountAction(act, id) {
  const acc = state.accounts.find((x) => x.id === id);
  if (!acc) return;
  if (act === 'edit') return openAccountForm(acc);
  if (act === 'toggle') {
    const to = acc.status === 'active' ? 'disabled' : 'active';
    if (to === 'disabled' && !confirm(`确定停用账号「${acc.displayName}」？停用后该账号将无法核验任何授权。`)) return;
    await api('/api/admin/accounts/' + id, { method: 'PATCH', body: { status: to } });
    toast(to === 'disabled' ? '账号已停用' : '账号已启用', 'success');
    return loadAccounts();
  }
  if (act === 'del') {
    if (!confirm(`确定删除账号「${acc.displayName}」？该账号名下授权将解除绑定（授权码仍可重新发放），此操作不可恢复。`)) return;
    await api('/api/admin/accounts/' + id, { method: 'DELETE' });
    toast('账号已删除', 'success');
    return loadAccounts();
  }
}

// ---------- 产品 ----------
async function loadProducts() {
  const rows = (await api('/api/admin/products')).data;
  state.products = rows;
  const tbody = document.getElementById('productTbody');
  tbody.innerHTML = rows.length
    ? rows
        .map(
          (p) => `
      <tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td class="code-cell">${esc(p.code)}</td>
        <td style="max-width:280px;color:var(--text-2)">${esc(p.description || '—')}</td>
        <td>${p.status === 'on' ? '<span class="badge badge-on">在售</span>' : '<span class="badge badge-off">已下架</span>'}</td>
        <td>${fmtDate(p.createdAt)}</td>
        <td><div class="op-cell">
          <button class="btn btn-default btn-sm" data-act="toggle" data-id="${p.id}">${p.status === 'on' ? '下架' : '重新上架'}</button>
          <button class="btn btn-default btn-sm" data-act="edit" data-id="${p.id}">编辑</button>
        </div></td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">还没有产品，点击右上角添加</td></tr>';
  tbody.querySelectorAll('button[data-act]').forEach((btn) =>
    btn.addEventListener('click', () => productAction(btn.dataset.act, btn.dataset.id))
  );
}

function openProductForm(p) {
  const isEdit = !!p;
  Modal.open({
    title: isEdit ? '编辑产品' : '添加产品',
    bodyHTML: `
      <div class="field"><label>产品名称（课程/软件名）</label>
        <input id="pName" maxlength="80" value="${esc(p ? p.name : '')}" placeholder="如 Python 编程入门（配套实训软件）" /></div>
      <div class="field"><label>产品编号</label>
        <input id="pCode" value="${esc(p ? p.code : '')}" placeholder="如 COURSE-PY101（留空自动生成）" /></div>
      <div class="field"><label>产品说明</label>
        <textarea id="pDesc" rows="3" maxlength="300" placeholder="面向对象、包含模块、注意事项等">${esc(p ? p.description : '')}</textarea></div>
      <div class="field"><label>上架状态</label>
        <select id="pStatus">
          <option value="on" ${p && p.status === 'on' ? 'selected' : ''}>在售</option>
          <option value="off" ${p && p.status === 'off' ? 'selected' : ''}>下架（停止新发授权，已发授权不受影响）</option>
        </select></div>`,
    okText: isEdit ? '保存' : '添加',
    onOk: async () => {
      const body = {
        name: document.getElementById('pName').value.trim(),
        code: document.getElementById('pCode').value.trim(),
        description: document.getElementById('pDesc').value.trim(),
        status: document.getElementById('pStatus').value
      };
      if (!body.name) throw new Error('产品名称不能为空');
      if (isEdit) {
        await api('/api/admin/products/' + p.id, { method: 'PATCH', body });
        toast('产品已更新', 'success');
      } else {
        await api('/api/admin/products', { method: 'POST', body });
        toast('产品添加成功', 'success');
      }
      loadProducts();
    }
  });
}

async function productAction(act, id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  if (act === 'edit') return openProductForm(p);
  if (act === 'toggle') {
    const to = p.status === 'on' ? 'off' : 'on';
    await api('/api/admin/products/' + id, { method: 'PATCH', body: { status: to } });
    toast(to === 'off' ? '产品已下架' : '产品已重新上架', 'success');
    loadProducts();
  }
}

// ---------- 授权 ----------
const LICENSE_STATE_BADGE = {
  active: '<span class="badge badge-active">使用中</span>',
  expiring: '<span class="badge badge-expiring">即将到期</span>',
  expired: '<span class="badge badge-expired">已过期</span>',
  revoked: '<span class="badge badge-revoked">已停用</span>'
};

async function loadLicenses() {
  const status = document.getElementById('licenseStatusFilter').value;
  const q = document.getElementById('licenseSearch').value.trim();
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const [licenses, products, accounts] = await Promise.all([
    api('/api/admin/licenses' + (params.toString() ? '?' + params : '')),
    api('/api/admin/products'),
    api('/api/admin/accounts')
  ]);
  state.licenses = licenses.data;
  state.products = products.data;
  state.accounts = accounts.data;

  const tbody = document.getElementById('licenseTbody');
  tbody.innerHTML = state.licenses.length
    ? state.licenses
        .map((l) => {
          const acc = l.accountId
            ? `${esc(l.accountName)}<div class="cell-sub">${esc(l.accountUsername)}${l.accountStatus === 'disabled' ? '（账号已停用）' : ''}</div>`
            : '<span style="color:var(--gray)">未绑定（待发放）</span>';
          return `
      <tr>
        <td class="code-cell">
          ${esc(l.code)}
          <button class="copy-btn" title="复制授权码" data-copy="${esc(l.code)}">复制</button>
          ${l.note ? `<div class="cell-sub">📝 ${esc(l.note)}</div>` : ''}
        </td>
        <td>${esc(l.productName)}<div class="cell-sub">${esc(l.productCode || '')}${l.productStatus === 'off' ? ' · 已下架' : ''}</div></td>
        <td>${acc}</td>
        <td>${LICENSE_STATE_BADGE[l.state] || ''}</td>
        <td><strong>${l.deviceCount}</strong> / ${l.deviceLimit}
          ${l.deviceCount ? `<button class="copy-btn" data-devices="${l.id}">查看/清除</button>` : ''}</td>
        <td>${fmtDate(l.expiresAt)}<div class="cell-sub">${
            l.state === 'expired' ? '<span style="color:var(--danger)">已过期</span>' : '剩 ' + l.daysLeft + ' 天'
          }</div></td>
        <td>${fmtDateTime(l.activatedAt)}</td>
        <td><div class="op-cell">
          <button class="btn btn-default btn-sm" data-act="bind" data-id="${l.id}">${l.accountId ? '换绑/解绑' : '绑定账号'}</button>
          <button class="btn ${l.status === 'revoked' ? 'btn-default' : 'btn-danger'} btn-sm" data-act="revoke" data-id="${l.id}">${l.status === 'revoked' ? '恢复启用' : '停用授权'}</button>
          <button class="btn btn-default btn-sm" data-act="edit" data-id="${l.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-act="del" data-id="${l.id}">删除</button>
        </div></td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="8" class="empty">没有符合条件的授权</td></tr>';

  tbody.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => copyText(b.dataset.copy))
  );
  tbody.querySelectorAll('[data-devices]').forEach((b) =>
    b.addEventListener('click', () => openDevices(b.dataset.devices))
  );
  tbody.querySelectorAll('button[data-act]').forEach((b) =>
    b.addEventListener('click', () => licenseAction(b.dataset.act, b.dataset.id))
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('授权码已复制', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('授权码已复制', 'success');
  }
}

function openLicenseForm() {
  const onProducts = state.products.length ? state.products : [];
  const productOptions = onProducts
    .map((p) => `<option value="${p.id}">${esc(p.name)}${p.status === 'off' ? '（已下架）' : ''}</option>`)
    .join('');
  const accountOptions =
    '<option value="">暂不绑定（发卡，首次核验自动绑定）</option>' +
    state.accounts
      .map((a) => `<option value="${a.id}" ${a.status === 'disabled' ? 'disabled' : ''}>${esc(a.displayName)}（${esc(a.username)}${a.status === 'disabled' ? '，已停用' : ''}）</option>`)
      .join('');
  Modal.open({
    title: '添加授权',
    bodyHTML: `
      <div class="field"><label>选择课程产品 *</label>
        <select id="lcProduct">${productOptions || '<option value="">请先在“产品管理”中添加产品</option>'}</select></div>
      <div class="field"><label>绑定账号</label>
        <select id="lcAccount">${accountOptions}</select>
        <div class="cell-sub" style="margin-top:4px">不绑定则为待发放状态，师生首次用正确账号+授权码核验时自动绑定</div></div>
      <div style="display:flex;gap:12px">
        <div class="field" style="flex:1"><label>设备数量上限 *</label>
          <input id="lcDevices" type="number" min="1" max="100" value="1" /></div>
        <div class="field" style="flex:1"><label>有效天数 *</label>
          <input id="lcDays" type="number" min="1" max="3650" value="365" /></div>
      </div>
      <div class="field"><label>自定义授权码（留空自动生成，需 16 位字母数字）</label>
        <input id="lcCode" placeholder="如 ABCDEFGHJKLMNPQRT（可不填）" maxlength="19" /></div>
      <div class="field"><label>备注</label>
        <input id="lcNote" maxlength="100" placeholder="如 2026 秋季学期统一发放" /></div>`,
    okText: '生成授权',
    onOk: async () => {
      const body = {
        productId: document.getElementById('lcProduct').value,
        accountId: document.getElementById('lcAccount').value,
        deviceLimit: Number(document.getElementById('lcDevices').value),
        validDays: Number(document.getElementById('lcDays').value),
        code: document.getElementById('lcCode').value.trim(),
        note: document.getElementById('lcNote').value.trim()
      };
      if (!body.productId) throw new Error('请先选择课程产品');
      const r = await api('/api/admin/licenses' , { method: 'POST', body });
      toast('授权添加成功', 'success');
      Modal.open({
        title: '授权已生成',
        hideFooter: true,
        bodyHTML: `
          <p style="font-size:13.5px;color:var(--text-2)">请将以下授权码发放给师生，也可在列表中随时复制：</p>
          <div style="background:#f0f5ff;border:1px solid #adc6ff;border-radius:8px;padding:14px;text-align:center">
            <div class="code-cell" style="font-size:17px;font-weight:700;letter-spacing:1px;color:var(--primary-dark)">${esc(r.data.code)}</div>
          </div>
          <p style="font-size:12.5px;color:var(--gray)">有效期至 ${fmtDate(r.data.expiresAt)} · 设备上限 ${r.data.deviceLimit} 台</p>`
      });
      loadLicenses();
    }
  });
}

function openLicenseEdit(l) {
  Modal.open({
    title: '编辑授权信息',
    bodyHTML: `
      <div class="field"><label>授权码（不可修改）</label><input value="${esc(l.code)}" disabled /></div>
      <div class="field"><label>设备数量上限</label>
        <input id="leDevices" type="number" min="1" max="100" value="${l.deviceLimit}" />
        <div class="cell-sub" style="margin-top:4px">当前已登记 ${l.deviceCount} 台；调低上限不会删除已有设备，但新设备将无法登记</div></div>
      <div class="field"><label>备注</label><input id="leNote" maxlength="100" value="${esc(l.note)}" /></div>`,
    okText: '保存',
    onOk: async () => {
      await api('/api/admin/licenses/' + l.id, {
        method: 'PATCH',
        body: {
          deviceLimit: Number(document.getElementById('leDevices').value),
          note: document.getElementById('leNote').value.trim()
        }
      });
      toast('授权已更新', 'success');
      loadLicenses();
    }
  });
}

function openBindForm(l) {
  const accountOptions =
    '<option value="">— 解除绑定（回到待发放）—</option>' +
    state.accounts
      .map((a) => `<option value="${a.id}" ${l.accountId === a.id ? 'selected' : ''}>${esc(a.displayName)}（${esc(a.username)}${a.status === 'disabled' ? '，已停用' : ''}）</option>`)
      .join('');
  Modal.open({
    title: l.accountId ? '换绑 / 解绑账号' : '绑定账号',
    bodyHTML: `
      <p style="font-size:13px;color:var(--text-2)">授权码：<span class="code-cell">${esc(l.code)}</span></p>
      <div class="field"><label>选择账号</label><select id="bindAccount">${accountOptions}</select></div>
      <p style="font-size:12.5px;color:var(--warning)">提示：换绑或解绑会清空该授权已登记的设备记录。</p>`,
    okText: '保存绑定',
    onOk: async () => {
      const v = document.getElementById('bindAccount').value;
      await api('/api/admin/licenses/' + l.id, { method: 'PATCH', body: { accountId: v || null } });
      toast(v ? '绑定关系已更新' : '已解除绑定，授权回到待发放状态', 'success');
      loadLicenses();
    }
  });
}

function openDevices(licenseId) {
  const l = state.licenses.find((x) => x.id === licenseId);
  if (!l || !l.devices.length) return;
  const rows = l.devices
    .map(
      (d) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
      <div>
        <strong style="font-size:13.5px">${esc(d.name)}</strong>
        <div class="cell-sub">${esc(d.platform || '未知平台')} · 绑定于 ${fmtDateTime(d.boundAt)} · 最近使用 ${fmtDateTime(d.lastSeenAt)}</div>
      </div>
      <button class="btn btn-danger btn-sm" data-fp="${esc(d.fingerprint)}">清除</button>
    </div>`
    )
    .join('');
  const mask = Modal.open({
    title: `已登记设备（${l.deviceCount}/${l.deviceLimit}）`,
    bodyHTML: `
      <p style="font-size:12.5px;color:var(--gray)">清除设备后，该设备下次核验会重新占用一个名额。</p>
      ${rows}
      <button class="btn btn-danger btn-sm" id="clearAllDevices" style="width:100%;margin-top:4px">清除全部设备</button>`,
    hideFooter: true
  });
  mask.querySelectorAll('[data-fp]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('确定清除这台设备的登记记录？')) return;
      await api('/api/admin/licenses/' + l.id + '/devices', { method: 'DELETE', body: { fingerprint: btn.dataset.fp } });
      toast('设备已清除', 'success');
      Modal.close();
      loadLicenses();
    })
  );
  mask.querySelector('#clearAllDevices').addEventListener('click', async () => {
    if (!confirm('确定清除全部设备记录？')) return;
    await api('/api/admin/licenses/' + l.id + '/devices', { method: 'DELETE', body: {} });
    toast('全部设备已清除', 'success');
    Modal.close();
    loadLicenses();
  });
}

async function licenseAction(act, id) {
  const l = state.licenses.find((x) => x.id === id);
  if (!l) return;
  if (act === 'edit') return openLicenseEdit(l);
  if (act === 'bind') return openBindForm(l);
  if (act === 'revoke') {
    const to = l.status === 'revoked' ? 'active' : 'revoked';
    if (to === 'revoked' && !confirm(`确定停用授权 ${l.code}？停用后绑定账号将无法再使用该课程软件。`)) return;
    await api('/api/admin/licenses/' + id, { method: 'PATCH', body: { status: to } });
    toast(to === 'revoked' ? '授权已停用' : '授权已恢复', 'success');
    return loadLicenses();
  }
  if (act === 'del') {
    if (!confirm(`确定删除授权 ${l.code}？删除后该授权码立即失效，此操作不可恢复。`)) return;
    await api('/api/admin/licenses/' + id, { method: 'DELETE' });
    toast('授权已删除', 'success');
    return loadLicenses();
  }
}

boot();
