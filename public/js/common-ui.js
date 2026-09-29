/* 公共 UI 工具：请求封装、Toast、弹窗、时间格式化、转义 */
async function api(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin'
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok || !data || data.ok === false) {
    const err = new Error((data && data.message) || '网络开小差了，请稍后再试');
    err.payload = data || {};
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, type = '') {
  const box = document.getElementById('toast');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromNow(iso) {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

/* 简易弹窗：Modal.open({title, bodyHTML, okText, onOk}) 或 confirm */
const Modal = {
  current: null,
  open({ title = '', bodyHTML = '', okText = '确定', cancelText = '取消', onOk, hideFooter }) {
    this.close();
    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="modal-close" data-close>×</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${hideFooter ? '' : `
        <div class="modal-foot">
          <button class="btn btn-default" data-close>${esc(cancelText)}</button>
          <button class="btn btn-primary" data-ok>${esc(okText)}</button>
        </div>`}
      </div>`;
    mask.addEventListener('click', (e) => {
      if (e.target === mask || e.target.hasAttribute('data-close')) this.close();
    });
    const okBtn = mask.querySelector('[data-ok]');
    if (okBtn) {
      okBtn.addEventListener('click', async () => {
        try {
          okBtn.disabled = true;
          okBtn.innerHTML = '<span class="spinner"></span>';
          const ret = onOk && (await onOk(mask));
          if (ret !== false) this.close();
        } catch (e) {
          toast(e.message || '操作失败', 'error');
        } finally {
          okBtn.disabled = false;
          okBtn.textContent = okText;
        }
      });
    }
    document.body.appendChild(mask);
    this.current = mask;
    const first = mask.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 50);
    return mask;
  },
  close() {
    if (this.current) {
      this.current.remove();
      this.current = null;
    }
  }
};
