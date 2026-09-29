'use strict';
const crypto = require('crypto');
const config = require('./config');

const sessions = new Map();

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function create(username) {
  const token = createToken();
  sessions.set(token, { username, expireAt: Date.now() + config.SESSION_TTL_MS });
  return token;
}

function get(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expireAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  s.expireAt = Date.now() + config.SESSION_TTL_MS; // 滑动续期
  return s;
}

function destroy(token) {
  sessions.delete(token);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

module.exports = { create, get, destroy, parseCookies };
