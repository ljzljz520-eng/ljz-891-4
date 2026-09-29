// 查询页逻辑
const form = document.getElementById('queryForm');
const resultEl = document.getElementById('result');
const btn = document.getElementById('queryBtn');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escAttr(s) { return esc(s); }

function renderFail(payload) {
  const reasons = (payload.reasons || []).map(r => `<li>${esc(r)}</li>`).join('');
  return `
    <div class="alert alert-error">
      <h3>⚠️ ${esc(payload.title || '未能完成查询')}</h3>
      <div>${esc(payload.message || '请核对信息后重试。')}</div>
      ${reasons ? `<ul>${reasons}</ul>` : ''}
      <div class="small muted" style="margin-top:10px">如确认信息无误仍无法查询，请联系课程管理员或在工作日拨打教务支持电话。</div>
    </div>`;
}

function renderBlocked(payload) {
  const d = payload.data || {};
  return `
    <div class="alert alert-block">
      <h3>⛔ ${esc(payload.title || '授权已停用')}</h3>
      <div>${esc(payload.message || '')}</div>
      <div style="margin-top:10px;font-size:14px">
        <div>账号：<strong>${esc(d.account)}</strong>${d.holder ? '（' + esc(d.holder) + '）' : ''}</div>
        <div style="margin-top:6px">停用原因：${esc(d.reason || '该授权已被管理员停用')}</div>
        ${d.activatedAt ? `<div class="small muted" style="margin-top:6px">开通时间：${fmtDate(d.activatedAt)}</div>` : ''}
      </div>
      <div class="small" style="margin-top:12px">如有异议，请联系管理员或任课老师核实处理。</div>
    </div>`;
}

function renderExpired(payload) {
  return renderLicense(payload.data, { expired: true }) + `
    <div class="alert alert-warn" style="margin-top:14px">
      <h3>⏳ 授权已到期</h3>
      <div>${esc(payload.message)}</div>
    </div>`;
}

function renderLicense(d, opts = {}) {
  const expired = opts.expired;
  const badge = expired
    ? '<span class="badge badge-expired">已到期</span>'
    : d.state === 'expiring'
      ? '<span class="badge badge-expiring">即将到期 · 剩余 ' + d.daysLeft + ' 天</span>'
      : '<span class="badge badge-active">✓ 授权有效</span>';

  const courses = (d.products || []).map(p => `
    <div class="course-item">
      <div>
        <span class="cname">${esc(p.name)}</span>
        <span class="cver">${esc(p.version)}</span>
        ${p.available ? '' : '<span class="badge badge-off" style="margin-left:8px">产品已下架</span>'}
      </div>
    </div>`).join('') || '<div class="empty">暂无可显示的课程产品</div>';

  const pct = d.deviceLimit ? Math.min(100, Math.round(d.devicesUsed / d.deviceLimit * 100)) : 0;
  const full = d.devicesUsed >= d.deviceLimit;

  return `
  <div class="license-card">
    <div class="license-head">
      <div>
        <div class="who">${esc(d.holder || '未登记用户')} <span class="muted small">@${esc(d.account)}</span></div>
        <div class="sub">核验时间：${fmtDate(new Date().toISOString())}</div>
      </div>
      ${badge}
    </div>

    <div class="course-list">
      <div class="k small muted" style="padding:14px 0 4px">授权课程（${(d.products || []).length} 门）</div>
      ${courses}
    </div>

    <div class="info-grid">
      <div class="info-cell">
        <div class="k">开通时间</div>
        <div class="v">${fmtDate(d.activatedAt)}</div>
      </div>
      <div class="info-cell">
        <div class="k">有效期至</div>
        <div class="v" ${expired ? 'style="color:var(--muted)"' : ''}>${fmtDate(d.expiresAt)}
          ${!expired && d.daysLeft != null ? `<span class="small muted">（剩 ${d.daysLeft} 天）</span>` : ''}
        </div>
      </div>
      <div class="info-cell">
        <div class="k">可登录设备数量</div>
        <div class="v">${d.devicesUsed} / ${d.deviceLimit} 台
          ${full ? '<span class="small" style="color:var(--amber);margin-left:6px">设备数已满</span>' : ''}
        </div>
        <div class="device-bar"><i style="width:${pct}%;${full ? 'background:var(--amber)' : ''}"></i></div>
      </div>
      <div class="info-cell">
        <div class="k">授权状态</div>
        <div class="v" style="color:${expired ? 'var(--muted)' : 'var(--green)'}">
          ${expired ? '已到期，请续费' : d.state === 'expiring' ? '有效（即将到期）' : '正常使用中'}
        </div>
      </div>
    </div>
  </div>`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const account = document.getElementById('account').value.trim();
  const authCode = document.getElementById('authCode').value.trim();
  if (!account || !authCode) {
    resultEl.innerHTML = '<div class="alert alert-error"><h3>⚠️ 信息未填写完整</h3><div>请同时输入账号和授权码后再进行查询。</div></div>';
    return;
  }
  btn.disabled = true; btn.textContent = '核验中…';
  resultEl.innerHTML = '';
  try {
    const resp = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, authCode })
    });
    const data = await resp.json();

    if (!data.ok) {
      resultEl.innerHTML = renderFail(data);
    } else if (data.status === 'disabled') {
      resultEl.innerHTML = renderBlocked(data);
    } else if (data.status === 'expired') {
      resultEl.innerHTML = renderExpired(data);
    } else {
      resultEl.innerHTML = renderLicense(data.data);
    }
  } catch (err) {
    resultEl.innerHTML = `
      <div class="alert alert-error">
        <h3>⚠️ 查询暂时未能完成</h3>
        <div>网络连接可能不稳定，请检查网络后稍后重试。若多次出现该提示，请记录您的账号并联系管理员协助核验。</div>
      </div>`;
  } finally {
    btn.disabled = false; btn.textContent = '立即核验';
  }
});
