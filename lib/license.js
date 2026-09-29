'use strict';
/**
 * 授权状态与展示数据组装（纯函数，方便核验页与后台共用）
 */
function daysLeft(expiresAt, now = Date.now()) {
  return Math.ceil((new Date(expiresAt).getTime() - now) / 86400000);
}

/**
 * 综合状态：
 *  revoked   已停用（管理员吊销）
 *  expired   已过期
 *  expiring  30 天内到期
 *  active    使用中
 */
function licenseState(lc, now = Date.now()) {
  if (lc.status === 'revoked') return 'revoked';
  const left = daysLeft(lc.expiresAt, now);
  if (left < 0) return 'expired';
  if (left <= 30) return 'expiring';
  return 'active';
}

function enrichLicense(lc, product, account, now = Date.now()) {
  const state = licenseState(lc, now);
  return {
    id: lc.id,
    code: lc.code,
    productId: lc.productId,
    productName: product ? product.name : '（产品已删除）',
    productCode: product ? product.code : '',
    productStatus: product ? product.status : 'off',
    accountId: lc.accountId,
    accountName: account ? account.displayName : '',
    accountUsername: account ? account.username : '',
    accountStatus: account ? account.status : 'unknown',
    deviceLimit: lc.deviceLimit,
    deviceCount: (lc.devices || []).length,
    devices: lc.devices || [],
    status: lc.status,
    state,
    daysLeft: daysLeft(lc.expiresAt, now),
    createdAt: lc.createdAt,
    activatedAt: lc.activatedAt,
    expiresAt: lc.expiresAt,
    lastVerifiedAt: lc.lastVerifiedAt,
    note: lc.note || ''
  };
}

module.exports = { licenseState, enrichLicense, daysLeft };
