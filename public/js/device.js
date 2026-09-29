/* 生成稳定的本机设备标识（localStorage 持久化），用于“设备数量”校验 */
(function () {
  function getFp() {
    let fp = null;
    try { fp = localStorage.getItem('dev_fp'); } catch (e) {}
    if (fp) return fp;
    const rnd = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    fp = 'web-' + rnd.replace(/-/g, '').slice(0, 24);
    try { localStorage.setItem('dev_fp', fp); } catch (e) {}
    return fp;
  }
  function osName(ua) {
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iOS/.test(ua)) return 'iOS';
    if (/Linux/.test(ua)) return 'Linux';
    return '';
  }
  window.getDeviceInfo = function () {
    const ua = navigator.userAgent || '';
    return {
      fingerprint: getFp(),
      name: (osName(ua) ? osName(ua) + ' 设备' : '网页端设备') + '（' + (navigator.userAgent.includes('Edg') ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : '浏览器') + '）',
      platform: osName(ua)
    };
  };
})();
