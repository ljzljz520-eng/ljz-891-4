'use strict';
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  DB_FILE: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json'),
  SESSION_TTL_MS: 1000 * 60 * 60 * 8, // 管理员会话 8 小时
  DEFAULT_DEVICE_LIMIT: 1,
  MAX_DEVICE_LIMIT: 100
};
