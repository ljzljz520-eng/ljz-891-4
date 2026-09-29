// ============ 基础工具 ============
const token = sessionStorage.getItem('admin_token');
if (!token) location.href = '/admin.html';
const api = (url, opts = {}) => fetch(url, {
  ...opts,
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) }
});
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function guard(resp) {
  if (resp.status === 401) { sessionStorage.clear(); location.href = '/admin.html'; return null; }
  return resp.json();
}

// ============ 导航 ============
document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.sidebar .nav-item').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    ['overview', 'licenses', 'products'].forEach(p => {
      document.getElementById('page-' + p).style.display = p === el.dataset.page ? '' : 'none';
    });
    if (el.dataset.page === 'licenses') loadLicenses();
    if (el.dataset.page === 'products') loadProducts();
    if (el.dataset.page === 'overview') loadStats();
  });
});
document.getElementById('logoutLink').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  sessionStorage.clear();
  location.href = '/admin.html';
});
document.getElementById('adminName').textContent = sessionStorage.getItem('admin_name') || '管理员';

// ============ 模态框通用 ============
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-mask').forEach(mask =>
  mask.addEventListener('click', e => { if (e.target === mask) mask.classList.remove('show'); }));

// ============ 概览 ============
async function loadStats() {
  const data = await guard(await api('/api/admin/stats'));
  if (!data || !data.ok) return;
  const s = data.stats;
  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="num">${s.total}</div><div class="lbl">授权总数</div></div>
    <div class="stat-card s-active"><div class="num">${s.active}</div><div class="lbl">有效授权</div></div>
    <div class="stat-card s-expired"><div class="num">${s.expired}</div><div class="lbl">已到期</div></div>
    <div class="stat-card s-disabled"><div class="num">${s.disabled}</div><div class="lbl">已停用</div></div>`;
}
loadStats();

// ============ 授权列表 ============
let state = { page: 1, pageSize: 10, total: 0, keyword: '', status: '', productId: '' };
let productsCache = [];

function stateBadge(item) {
  if (item.state === 'disabled') return '<span class="badge badge-disabled">已停用</span>';
  if (item.state === 'expired') return '<span class="badge badge-expired">已到期</span>';
  if (item.state === 'expiring') return '<span class="badge badge-expiring">即将到期</span>';
  return '<span class="badge badge-active">有效</span>';
}

async function loadProductsForFilter() {
  const data = await guard(await api('/api/admin/products'));
  if (!data || !data.ok) return;
  productsCache = data.items;
  const sel = document.getElementById('filterProduct');
  sel.innerHTML = '<option value="">全部产品</option>' +
    productsCache.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = state.productId;
}

async function loadLicenses() {
  const params = new URLSearchParams({
    page: state.page, pageSize: state.pageSize,
    keyword: state.keyword, status: state.status, productId: state.productId
  });
  const data = await guard(await api('/api/admin/licenses?' + params));
  if (!data || !data.ok) return;
  state.total = data.total;
  const tbody = document.getElementById('licenseTbody');

  if (!data.items.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty">没有符合条件的授权记录</div></td></tr>';
  } else {
    tbody.innerHTML = data.items.map(l => {
      const courses = (l.products || []).map(p => esc(p.name)).join('、') || '<span class="muted">—</span>';
      const actions = l.state === 'disabled'
        ? `<button class="btn btn-success btn-sm" data-enable="${l.id}">启用</button>
           <button class="btn btn-ghost btn-sm" data-edit="${l.id}">编辑</button>`
        : `<button class="btn btn-ghost btn-sm" data-edit="${l.id}">编辑</button>
           <button class="btn btn-danger btn-sm" data-disable="${l.id}">停用</button>`;
      return `<tr>
        <td><strong>${esc(l.account)}</strong><div class="small muted">${esc(l.holder || '未登记')}</div></td>
        <td class="code-cell">${esc(l.authCode)}</td>
        <td style="max-width:180px">${courses}</td>
        <td>${l.devicesUsed}/${l.deviceLimit}</td>
        <td class="small">${fmtDT(l.activatedAt)}</td>
        <td class="small">${fmtDT(l.expiresAt)}</td>
        <td>${stateBadge(l)}</td>
        <td><div class="row-actions">${actions}</div></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-disable]').forEach(b => b.addEventListener('click', () => {
      document.getElementById('disableId').value = b.dataset.disable;
      document.getElementById('disableReason').value = '';
      openModal('disableModal');
    }));
    tbody.querySelectorAll('[data-enable]').forEach(b => b.addEventListener('click', () => enableLicense(b.dataset.enable)));
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openLicenseModal(b.dataset.edit)));
  }

  document.getElementById('totalText').textContent = `共 ${data.total} 条`;
  document.getElementById('pageText').textContent = `第 ${state.page} / ${Math.max(1, Math.ceil(data.total / state.pageSize))} 页`;
}

// 搜索 / 筛选
let searchTimer;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.keyword = e.target.value; state.page = 1; loadLicenses(); }, 350);
});
document.getElementById('filterStatus').addEventListener('change', e => { state.status = e.target.value; state.page = 1; loadLicenses(); });
document.getElementById('filterProduct').addEventListener('change', e => { state.productId = e.target.value; state.page = 1; loadLicenses(); });
document.getElementById('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; loadLicenses(); } });
document.getElementById('nextPage').addEventListener('click', () => {
  if (state.page < Math.ceil(state.total / state.pageSize)) { state.page++; loadLicenses(); }
});

// ============ 添加 / 编辑授权 ============
async function openLicenseModal(id) {
  if (!productsCache.length) await loadProductsForFilter();
  const onSale = productsCache.filter(p => p.status === 'on');
  document.getElementById('licProducts').innerHTML = onSale.length
    ? onSale.map(p => `<label><input type="checkbox" value="${p.id}"> ${esc(p.name)}</label>`).join('')
    : '<div class="small muted" style="grid-column:1/-1">暂无可售产品，请先到“产品管理”添加上架</div>';

  document.getElementById('licenseModalTitle').textContent = id ? '编辑授权' : '添加授权';
  ['licAccount', 'licHolder', 'licAuthCode', 'licNote'].forEach(x => document.getElementById(x).value = '');
  document.getElementById('licDeviceLimit').value = 2;
  document.getElementById('licDevicesUsed').value = 0;
  document.getElementById('licValidDays').value = 365;
  document.getElementById('licActivated').value = '';
  document.getElementById('licExpires').value = '';
  document.getElementById('licId').value = id || '';

  // 新建时：账号、开通时间、有效天数、自动授权码可用；编辑时：改到期时间与设备数
  document.getElementById('licAccount').disabled = !!id;
  document.getElementById('licAuthCode').disabled = !!id;
  document.getElementById('licValidDaysWrap').style.display = id ? 'none' : '';
  document.getElementById('licActivatedWrap').style.display = id ? 'none' : '';
  document.getElementById('licExpiresWrap').style.display = id ? '' : 'none';
  document.getElementById('licDevicesUsedWrap').style.display = id ? '' : 'none';

  if (id) {
    // 通过全量列表按 id 定位待编辑记录
    const all = await guard(await api('/api/admin/licenses?pageSize=500'));
    const item = (all.items || []).find(x => x.id === id);
    if (!item) { toast('未找到该记录'); closeModal('licenseModal'); return; }
    document.getElementById('licAccount').value = item.account;
    document.getElementById('licHolder').value = item.holder || '';
    document.getElementById('licDeviceLimit').value = item.deviceLimit;
    document.getElementById('licDevicesUsed').value = item.devicesUsed;
    document.getElementById('licExpires').value = toLocalInput(item.expiresAt);
    document.getElementById('licNote').value = item.note || '';
    document.querySelectorAll('#licProducts input').forEach(cb => { cb.checked = (item.products || []).some(pp => pp.id === cb.value); });
  }
  openModal('licenseModal');
}

document.getElementById('addLicenseBtn').addEventListener('click', () => openLicenseModal(null));

document.getElementById('saveLicenseBtn').addEventListener('click', async () => {
  const id = document.getElementById('licId').value;
  const productIds = [...document.querySelectorAll('#licProducts input:checked')].map(c => c.value);
  const payload = {
    holder: document.getElementById('licHolder').value,
    productIds,
    deviceLimit: Number(document.getElementById('licDeviceLimit').value),
    note: document.getElementById('licNote').value
  };
  try {
    let resp, data;
    if (id) {
      payload.devicesUsed = Number(document.getElementById('licDevicesUsed').value);
      const exp = document.getElementById('licExpires').value;
      if (exp) payload.expiresAt = new Date(exp).toISOString();
      resp = await api('/api/admin/licenses/' + id, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      payload.account = document.getElementById('licAccount').value.trim();
      payload.validDays = Number(document.getElementById('licValidDays').value);
      const act = document.getElementById('licActivated').value;
      if (act) payload.activatedAt = new Date(act).toISOString();
      const code = document.getElementById('licAuthCode').value.trim();
      if (code) payload.authCode = code;
      resp = await api('/api/admin/licenses', { method: 'POST', body: JSON.stringify(payload) });
    }
    data = await guard(resp);
    if (!data) return;
    if (data.ok) {
      toast(id ? '授权已更新' : '授权开通成功');
      closeModal('licenseModal');
      loadLicenses(); loadStats();
      if (!id && data.item && data.item.authCode) {
        // 展示自动生成的授权码，便于复制发放
        setTimeout(() => alert(`授权开通成功！\n\n账号：${data.item.account}\n授权码：${data.item.authCode}\n请妥善保存并发放给师生。`), 100);
      }
    } else {
      toast(data.message || '保存失败');
    }
  } catch {
    toast('网络异常，请稍后重试');
  }
});

// 停用 / 启用
document.getElementById('confirmDisableBtn').addEventListener('click', async () => {
  const id = document.getElementById('disableId').value;
  const reason = document.getElementById('disableReason').value.trim();
  const data = await guard(await api('/api/admin/licenses/' + id + '/disable', {
    method: 'POST', body: JSON.stringify({ reason })
  }));
  if (data && data.ok) { toast('已停用该授权'); closeModal('disableModal'); loadLicenses(); loadStats(); }
});
async function enableLicense(id) {
  const data = await guard(await api('/api/admin/licenses/' + id + '/enable', { method: 'POST' }));
  if (data && data.ok) { toast('已重新启用'); loadLicenses(); loadStats(); }
}

// ============ 产品管理 ============
async function loadProducts() {
  const data = await guard(await api('/api/admin/products'));
  if (!data || !data.ok) return;
  const all = await guard(await api('/api/admin/licenses?pageSize=500'));
  const countMap = {};
  (all.items || []).forEach(l => (l.products || []).forEach(p => countMap[p.id] = (countMap[p.id] || 0) + 1));

  const tbody = document.getElementById('productTbody');
  tbody.innerHTML = data.items.length ? data.items.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td class="small">${esc(p.version || '-')}</td>
      <td>${p.status === 'on' ? '<span class="badge badge-active">上架中</span>' : '<span class="badge badge-off">已下架</span>'}</td>
      <td>${countMap[p.id] || 0}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-prod-edit="${p.id}">编辑</button>
        ${p.status === 'on'
          ? `<button class="btn btn-danger btn-sm" data-prod-off="${p.id}">下架</button>`
          : `<button class="btn btn-success btn-sm" data-prod-on="${p.id}">上架</button>`}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">暂无产品，请点击右上角添加</div></td></tr>';

  tbody.querySelectorAll('[data-prod-edit]').forEach(b => b.addEventListener('click', () => openProductModal(b.dataset.prodEdit, data.items)));
  tbody.querySelectorAll('[data-prod-off]').forEach(b => b.addEventListener('click', () => setProductStatus(b.dataset.prodOff, 'off')));
  tbody.querySelectorAll('[data-prod-on]').forEach(b => b.addEventListener('click', () => setProductStatus(b.dataset.prodOn, 'on')));
}

function openProductModal(id, items) {
  const list = items || productsCache;
  const p = id ? list.find(x => x.id === id) : null;
  document.getElementById('productModalTitle').textContent = p ? '编辑产品' : '添加产品';
  document.getElementById('prodId').value = p ? p.id : '';
  document.getElementById('prodName').value = p ? p.name : '';
  document.getElementById('prodVersion').value = p ? (p.version === '-' ? '' : p.version) : '';
  document.getElementById('prodStatus').value = p ? p.status : 'on';
  openModal('productModal');
}
document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null, null));

document.getElementById('saveProductBtn').addEventListener('click', async () => {
  const id = document.getElementById('prodId').value;
  const payload = {
    name: document.getElementById('prodName').value.trim(),
    version: document.getElementById('prodVersion').value.trim(),
    status: document.getElementById('prodStatus').value
  };
  if (!payload.name) return toast('请填写产品名称');
  const url = id ? '/api/admin/products/' + id : '/api/admin/products';
  const data = await guard(await api(url, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }));
  if (data && data.ok) { toast('保存成功'); closeModal('productModal'); loadProducts(); loadProductsForFilter(); }
  else if (data) toast(data.message || '保存失败');
});
async function setProductStatus(id, status) {
  const data = await guard(await api('/api/admin/products/' + id, { method: 'PATCH', body: JSON.stringify({ status }) }));
  if (data && data.ok) { toast(status === 'on' ? '产品已上架' : '产品已下架'); loadProducts(); loadProductsForFilter(); }
}

// 初始化筛选下拉
loadProductsForFilter();
