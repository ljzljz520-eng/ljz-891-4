# 课程软件授权核验站

面向学校 / 培训机构的课程软件授权核验系统：老师或学生输入**账号 + 授权码**即可查询授权信息，管理员通过后台完成授权发放、账号停用与产品管理。

- 零第三方依赖：Node.js ≥ 18 内置 `http` + JSON 文件存储，无需数据库
- 数据保存在 `data/db.json`（首次启动自动生成演示数据）

## 快速开始

```bash
npm start
# 或：node server.js
# 自定义端口：PORT=8080 node server.js
```

| 入口 | 地址 |
| --- | --- |
| 师生核验页 | http://localhost:3000/ |
| 管理后台 | http://localhost:3000/admin |
| 默认管理员 | `admin` / `admin123`（登录后请修改密码） |

重置演示数据：`npm run seed`（会自动备份旧库为 `db.json.bak-*`）

## 演示账号与授权码

| 场景 | 账号 | 授权码 |
| --- | --- | --- |
| 正常使用（2 台设备） | `student01` | `K7MP-Q2WE-8XHA-N4TV` |
| 教师多机授权（30 台） | `teacher01` | `ZR9F-5KJL-VCB6-M3QD` |
| 未绑定新码（首次核验自动绑定） | 任意已开通账号 | `UNBN-8D2K-Q5RM-X7SZ` |
| 已停用授权 | 任意账号 | `REV0-KED0-LIC0-0000` |
| 停用账号 | `student02` | `P4WX-7HBN-YT2E-9FKA`（且已过期） |

## 功能

### 师生核验页
- 输入账号 + 授权码（16 位，连字符可省略，输入时自动分组）
- 展示：授权课程、有效期（含剩余天数）、设备数量（已登记/上限）、开通时间、已登记设备清单
- 首次核验自动完成“一码绑一号”，后续换账号使用会被友好拦截
- 设备指纹自动登记（localStorage 持久化），超出设备上限给出处理建议
- 查询失败**不出现“系统错误”字样**，而是列出可能原因与建议处理方式

### 管理后台
- 概览：账号/授权/产品统计、今日核验次数、最近 60 条核验日志
- 授权管理：添加授权（选产品、绑定账号、设备数、有效天数、可自定义授权码或自动生成）、停用/恢复、换绑/解绑、编辑设备上限与备注、查看/清除设备、复制授权码、按状态与授权码筛选
- 账号管理：添加账号（教师/学生）、编辑、停用/启用、删除（同步解绑其授权）
- 产品管理：添加/编辑课程产品、上下架（下架不影响已发授权）
- 修改管理员密码；会话基于 HttpOnly Cookie，8 小时滑动过期

## 目录结构

```
server.js            HTTP 服务 / API 路由 / 静态托管 / 友好错误目录
lib/
  config.js          端口、数据文件等配置
  store.js           JSON 文件持久化（原子写、串行写队列）
  seed.js            演示数据
  license.js         授权状态计算（使用中/即将到期/已过期/已停用）
  session.js         管理员会话
  util.js            授权码生成、哈希等工具
public/
  index.html         师生核验页
  admin.html         管理后台
  css/ js/           前端资源
data/db.json         运行后生成（已在 .gitignore）
```

## API 摘要

- `POST /api/query` — 公开核验 `{username, code, device}`
- `POST /api/admin/login` / `logout`
- `GET/POST /api/admin/accounts[/:id]`，`PATCH/DELETE`
- `GET/POST /api/admin/products[/:id]`，`PATCH`
- `GET/POST /api/admin/licenses[/:id]`，`PATCH/DELETE`，`DELETE /:id/devices`
- `GET /api/admin/stats`、`GET /api/admin/logs`、`POST /api/admin/password`

## 安全说明

本项目定位为轻量部署的教学演示/内网工具：密码经 SHA-256 + 随机盐存储，管理接口有会话校验与输入校验。若用于公网生产，建议在前置 Nginx 启用 HTTPS、按实际需要增加登录限流与定期备份 `data/` 目录。
