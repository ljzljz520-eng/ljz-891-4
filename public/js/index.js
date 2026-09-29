(function () {
  const form = document.getElementById('queryForm');
  const usernameEl = document.getElementById('username');
  const codeEl = document.getElementById('code');
  const btn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const resultPanel = document.getElementById('resultPanel');
  const failPanel = document.getElementById('failPanel');

  // 授权码输入自动分组 XXXX-XXXX-XXXX-XXXX
  codeEl.addEventListener('input', () => {
    const digits = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    codeEl.value = digits.replace(/(.{4})(?=.)/g, '$1-');
  });

  const STATE_META = {
    active: { badge: 'badge-active', text: '● 使用中' },
    expiring: { badge: 'badge-expiring', text: '● 即将到期' },
    expired: { badge: 'badge-expired', text: '● 已过期' },
    revoked: { badge: 'badge-revoked', text: '● 已停用' }
  };

  function showFail(payload) {
    resultPanel.classList.remove('show');
    failPanel.classList.add('show');
    document.getElementById('failTitle').textContent = payload.message || '暂时无法完成核验';
    document.getElementById('failMessage').textContent =
      payload.code === 'SERVICE_BUSY'
        ? '本次查询未能成功完成，请参考下列可能原因处理。'
        : '为保护账号安全，系统不会提示是账号还是授权码有误，请对照以下可能原因逐一排查：';
    const reasons = payload.reasons && payload.reasons.length
      ? payload.reasons
      : ['请稍后重新尝试，或联系管理员协助核实'];
    const suggestions = payload.suggestions && payload.suggestions.length
      ? payload.suggestions
      : ['请确认账号与授权码是否与发卡凭证一致'];
    document.getElementById('failReasons').innerHTML = reasons.map((r) => `<li>${esc(r)}</li>`).join('');
    document.getElementById('failSuggestions').innerHTML = suggestions.map((s) => `<li>${esc(s)}</li>`).join('');
    failPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showResult(data) {
    failPanel.classList.remove('show');
    const { account, license: lc, hints } = data;
    const meta = STATE_META[lc.state] || STATE_META.active;
    const roleText = account.role === 'teacher' ? '教师账号' : '学生账号';
    const deviceList = (lc.devices || [])
      .map(
        (d) => `
        <div class="d">
          <div>
            <strong>${esc(d.name)}</strong>
            <div class="meta">${esc(d.platform || '未知平台')} · 绑定于 ${fmtDate(d.boundAt)}</div>
          </div>
          <div class="meta">最近使用 ${fromNow(d.lastSeenAt)}</div>
        </div>`
      )
      .join('');

    const hintHtml = (hints || [])
      .map((h) => {
        const cls = lc.state === 'expired' ? 'state-expired' : 'state-expiring';
        return `<div class="state-banner ${cls}"><span class="icon">${lc.state === 'expired' ? '⛔' : '⏰'}</span><span>${esc(h)}</span></div>`;
      })
      .join('');

    resultPanel.innerHTML = `
      <div class="result-head">
        <div class="avatar">${esc(account.displayName.slice(0, 1))}</div>
        <div class="who">
          <div class="name">${esc(account.displayName)}</div>
          <div class="sub">账号 ${esc(account.username)}</div>
        </div>
        <span class="badge badge-role ${account.role === 'teacher' ? 'teacher' : ''}">${roleText}</span>
        <span class="badge ${meta.badge}">${meta.text}</span>
      </div>

      ${hintHtml}

      <div class="course-name">${esc(lc.productName)}</div>
      <div class="course-code">课程编号：${esc(lc.productCode || '—')}${lc.productStatus === 'off' ? ' · 该产品已下架（不影响已发放授权）' : ''}</div>

      <div class="info-grid">
        <div class="info-item">
          <div class="k">有效期至</div>
          <div class="v">${fmtDate(lc.expiresAt)}
            ${lc.state === 'active' ? `<small>剩余 ${lc.daysLeft} 天</small>` : lc.state === 'expiring' ? `<small style="color:var(--warning)">仅剩 ${lc.daysLeft} 天</small>` : '<small style="color:var(--danger)">已过期</small>'}
          </div>
        </div>
        <div class="info-item">
          <div class="k">设备数量</div>
          <div class="v">${lc.deviceCount} / ${lc.deviceLimit} <small>台已登记</small></div>
        </div>
        <div class="info-item">
          <div class="k">开通时间</div>
          <div class="v">${fmtDateTime(lc.activatedAt)}</div>
        </div>
        <div class="info-item">
          <div class="k">授权码</div>
          <div class="v" style="font-size:14px;letter-spacing:.5px">${esc(lc.code)}</div>
        </div>
        <div class="info-item full">
          <div class="k">最近核验时间</div>
          <div class="v" style="font-size:14px;font-weight:400">${fmtDateTime(lc.lastVerifiedAt)}</div>
        </div>
      </div>

      <div class="devices">
        <strong style="font-size:13.5px">已登记设备</strong>
        ${deviceList || '<div class="empty">暂无设备登记记录</div>'}
      </div>`;
    resultPanel.classList.add('show');
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span> 核验中…';
    resultPanel.classList.remove('show');
    failPanel.classList.remove('show');
    try {
      const resp = await api('/api/query', {
        method: 'POST',
        body: {
          username: usernameEl.value.trim(),
          code: codeEl.value.trim(),
          device: window.getDeviceInfo ? window.getDeviceInfo() : null
        }
      });
      showResult(resp.data);
    } catch (err) {
      showFail(err.payload && err.payload.code ? err.payload : { message: err.message });
    } finally {
      btn.disabled = false;
      btnText.textContent = '立即核验';
    }
  });
})();
