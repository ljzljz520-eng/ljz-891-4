'use strict';
/**
 * 首次启动时自动生成演示数据：
 *   管理员 admin / admin123
 *   演示账号 teacher01 / student01 / student02
 *   4 门课程产品 + 若干不同状态的授权（含已过期、停用案例）
 */
const crypto = require('crypto');
const { uuid } = require('./util');

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function build() {
  const salt = crypto.randomBytes(8).toString('hex');
  const adminHash = crypto
    .createHash('sha256')
    .update('admin123' + salt)
    .digest('hex');

  const t1 = uuid(); // 张老师
  const s1 = uuid(); // 李小明
  const s2 = uuid(); // 王小雨

  const p1 = uuid(); // Python 编程入门
  const p2 = uuid(); // 数据结构与算法
  const p3 = uuid(); // 三维建模实战
  const p4 = uuid(); // 高考试题精练

  return {
    version: 1,
    admin: { username: 'admin', passwordHash: adminHash, salt },
    accounts: [
      {
        id: t1,
        username: 'teacher01',
        displayName: '张老师',
        role: 'teacher',
        status: 'active',
        createdAt: daysAgo(120)
      },
      {
        id: s1,
        username: 'student01',
        displayName: '李小明',
        role: 'student',
        status: 'active',
        createdAt: daysAgo(60)
      },
      {
        id: s2,
        username: 'student02',
        displayName: '王小雨',
        role: 'student',
        status: 'disabled',
        createdAt: daysAgo(30)
      }
    ],
    products: [
      {
        id: p1,
        name: 'Python 编程入门（配套实训软件）',
        code: 'COURSE-PY101',
        description: '零基础 Python 语法与实训环境，含课堂练习与自动评测。',
        status: 'on',
        createdAt: daysAgo(120)
      },
      {
        id: p2,
        name: '数据结构与算法（专业版）',
        code: 'COURSE-DS201',
        description: '链表、树、图等可视化教学软件与题库系统。',
        status: 'on',
        createdAt: daysAgo(100)
      },
      {
        id: p3,
        name: '三维建模实战（实验室授权）',
        code: 'COURSE-3D301',
        description: '三维建模课程专用软件，支持机房多设备部署。',
        status: 'on',
        createdAt: daysAgo(80)
      },
      {
        id: p4,
        name: '高考试题精练（冲刺版）',
        code: 'COURSE-GK401',
        description: '历年真题、模拟卷与错题本，考前冲刺专用。',
        status: 'off',
        createdAt: daysAgo(200)
      }
    ],
    licenses: [
      {
        id: uuid(),
        productId: p1,
        accountId: s1,
        code: 'K7MP-Q2WE-8XHA-N4TV',
        deviceLimit: 2,
        devices: [
          {
            fingerprint: 'demo-device-li-001',
            name: '李小明的笔记本',
            platform: 'Windows 11',
            boundAt: daysAgo(45),
            lastSeenAt: daysAgo(2)
          }
        ],
        status: 'active',
        createdAt: daysAgo(50),
        activatedAt: daysAgo(45),
        expiresAt: daysFromNow(315),
        lastVerifiedAt: daysAgo(2),
        note: '新生开学统一发放'
      },
      {
        id: uuid(),
        productId: p3,
        accountId: t1,
        code: 'ZR9F-5KJL-VCB6-M3QD',
        deviceLimit: 30,
        devices: [],
        status: 'active',
        createdAt: daysAgo(80),
        activatedAt: daysAgo(79),
        expiresAt: daysFromNow(285),
        lastVerifiedAt: daysAgo(9),
        note: '机房教师机授权'
      },
      {
        id: uuid(),
        productId: p2,
        accountId: s2,
        code: 'P4WX-7HBN-YT2E-9FKA',
        deviceLimit: 1,
        devices: [],
        status: 'active',
        createdAt: daysAgo(200),
        activatedAt: daysAgo(198),
        expiresAt: daysAgo(18),
        lastVerifiedAt: daysAgo(25),
        note: '该账号已停用，授权也已过期（演示用）'
      },
      {
        id: uuid(),
        productId: p1,
        accountId: null,
        code: 'UNBN-8D2K-Q5RM-X7SZ',
        deviceLimit: 1,
        devices: [],
        status: 'active',
        createdAt: daysAgo(3),
        activatedAt: null,
        expiresAt: daysFromNow(365),
        lastVerifiedAt: null,
        note: '待发放：首次用正确账号+授权码核验时自动绑定'
      },
      {
        id: uuid(),
        productId: p2,
        accountId: null,
        code: 'REV0-KED0-LIC0-0000',
        deviceLimit: 1,
        devices: [],
        status: 'revoked',
        createdAt: daysAgo(90),
        activatedAt: null,
        expiresAt: daysFromNow(275),
        lastVerifiedAt: null,
        note: '演示：已吊销/停用的授权'
      }
    ],
    queryLogs: []
  };
}

if (require.main === module) {
  // 手动重置：node lib/seed.js （会备份旧库）
  const fs = require('fs');
  const path = require('path');
  const target = path.join(__dirname, '..', 'data', 'db.json');
  if (fs.existsSync(target)) {
    fs.renameSync(target, target + '.bak-' + Date.now());
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(build(), null, 2));
  console.log('演示数据已写入:', target);
  console.log('管理员账号: admin / admin123');
  console.log('师生账号: teacher01、student01、student02（演示授权码见后台）');
}

module.exports = { build };
