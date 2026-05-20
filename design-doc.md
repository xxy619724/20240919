# 在线白板协作软件 - 设计文档

> 版本：v1.0 | 日期：2026-04-29 | 状态：待确认

---

## 一、项目概述

### 1.1 产品定位
一个轻量级在线白板协作工具，支持多人实时绘图、房间管理与内容持久化。低门槛（匿名可用）+ 价值驱动（注册持久化）。

### 1.2 核心价值
- **零门槛**：无需注册即可创建房间并开始协作
- **实时同步**：多人同时绘图，毫秒级同步
- **简单可靠**：SQLite 存储 + Redis 广播，部署简单

---

## 二、技术架构

### 2.1 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端 | HTML + CSS + JavaScript | 页面渲染与交互 |
| 后端 | Python Flask | HTTP API 服务器 |
| 实时通信 | Flask-SocketIO + Redis | WebSocket 实时协作 |
| 数据库 | SQLite | 持久化存储 |
| 消息队列 | Redis | Pub/Sub 实时广播 |

### 2.2 架构图

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│   Browser   │ ◄──────────────► │  Flask-SocketIO   │
│  (HTML/JS)  │     HTTP REST     │    (Flask App)    │
└─────────────┘ ◄──────────────► │                   │
                                  │  ┌─────────────┐ │
┌─────────────┐     WebSocket      │  │   SQLite    │ │
│   Browser   │ ◄──────────────► │  │  (持久化)    │ │
│  (HTML/JS)  │     HTTP REST     │  └─────────────┘ │
└─────────────┘ ◄──────────────► │  ┌─────────────┐ │
                                  │  │    Redis     │ │
                                  │  │  (消息广播)   │ │
                                  │  └─────────────┘ │
                                  └──────────────────┘
```

### 2.3 通信模式

| 场景 | 协议 | 说明 |
|------|------|------|
| 用户注册/登录 | HTTP REST | 无需实时 |
| 创建/加入房间 | HTTP REST | 一次性操作 |
| 绘图数据同步 | WebSocket | 实时双向 |
| 在线状态同步 | WebSocket | 实时双向 |
| 房间列表/白板加载 | HTTP REST | 拉取初始数据 |
| 白板快照保存 | HTTP REST | 定期保存 |

---

## 三、数据模型

### 3.1 用户表 (users)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 主键 |
| email | VARCHAR(120) | UNIQUE, NOT NULL | 邮箱 |
| username | VARCHAR(80) | UNIQUE, NOT NULL | 用户名 |
| password_hash | VARCHAR(256) | NOT NULL | 密码哈希（werkzeug） |
| created_at | DATETIME | NOT NULL | 创建时间 |

### 3.2 房间表 (rooms)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | VARCHAR(8) | PK | 房间ID（随机生成8位） |
| name | VARCHAR(100) | NOT NULL | 房间名称 |
| creator_id | INTEGER | FK → users.id, NULLABLE | 创建者（匿名则为NULL） |
| snapshot | TEXT | NULLABLE | 白板快照（JSON序列化） |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 最后更新时间 |

### 3.3 房间参与者表 (room_participants)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 主键 |
| room_id | VARCHAR(8) | FK → rooms.id | 房间ID |
| user_id | INTEGER | FK → users.id, NULLABLE | 用户ID（匿名为NULL） |
| nickname | VARCHAR(50) | NOT NULL | 显示昵称 |
| joined_at | DATETIME | NOT NULL | 加入时间 |

---

## 四、功能模块详细设计

### 4.1 用户模块

#### 4.1.1 注册
- **接口**：`POST /api/auth/register`
- **参数**：email, username, password, confirm_password
- **校验**：
  - 邮箱格式校验
  - 用户名 3-20 字符
  - 密码 ≥ 6 位
  - 两次密码一致
  - 邮箱/用户名唯一性
- **密码存储**：werkzeug.security 的 generate_password_hash

#### 4.1.2 登录
- **接口**：`POST /api/auth/login`
- **参数**：email, password
- **返回**：用户信息 + session token
- **Session**：Flask session（cookie-based）

#### 4.1.3 登出
- **接口**：`POST /api/auth/logout`

#### 4.1.4 获取当前用户
- **接口**：`GET /api/auth/me`

### 4.2 匿名访问模块

- 用户访问首页时自动分配匿名身份（nickname: "访客XXXX"）
- 匿名用户可创建房间、加入房间、绘图
- 匿名用户的绘图实时可见，但**白板快照不持久化**
- 注册用户登录后，其操作和白板快照持久化保存

### 4.3 房间模块

#### 4.3.1 创建房间
- **接口**：`POST /api/rooms`
- **参数**：name（可选，默认"未命名房间"）
- **逻辑**：生成8位随机房间ID，创建者自动加入
- **返回**：房间信息 + 房间ID

#### 4.3.2 获取房间信息
- **接口**：`GET /api/rooms/<room_id>`
- **返回**：房间名称、创建者、在线人数、白板快照

#### 4.3.3 加入房间
- **接口**：`POST /api/rooms/<room_id>/join`
- **参数**：nickname（匿名用户自动生成）
- **逻辑**：
  - 验证房间存在
  - 添加参与者记录
  - 通过 WebSocket 通知房间内其他用户

#### 4.3.4 在线人数
- 通过 WebSocket 连接/断开事件实时维护
- 存储在 Redis 中：`room:{room_id}:online` → SET 类型
- 变更时广播给房间内所有用户

#### 4.3.5 房间列表（注册用户）
- **接口**：`GET /api/rooms`
- **返回**：当前用户参与的房间列表

### 4.4 绘图模块

#### 4.4.1 绘图工具列表

| 工具 | 说明 | 实现方式 |
|------|------|---------|
| 画笔 | 自由绘制 | Canvas path + 坐标序列 |
| 橡皮擦 | 擦除内容 | Canvas destination-out |
| 直线 | 画直线 | 起点终点坐标 |
| 矩形 | 画矩形 | 起点终点坐标 |
| 圆形 | 画圆形 | 圆心+半径 |
| 文本 | 输入文字 | 坐标+文本内容 |
| 颜色选择 | 选择画笔颜色 | 预设调色板 |
| 线宽调节 | 调整线条粗细 | 滑块控制 1-20px |

#### 4.4.2 绘图数据格式

```json
{
  "type": "draw",
  "tool": "pen",
  "points": [[x1, y1], [x2, y2], ...],
  "color": "#000000",
  "width": 2,
  "userId": "user123",
  "timestamp": 1234567890
}
```

#### 4.4.3 绘图同步流程

```
用户A绘图 → 前端捕获操作 → WebSocket发送到服务器
→ 服务器通过Redis Pub/Sub广播到房间
→ 房间内所有用户（含A）收到 → Canvas重绘
```

### 4.5 撤销/重做模块

- **范围**：个人撤销，只撤销自己的操作
- **实现**：
  - 每个用户维护独立的操作栈（undo_stack / redo_stack）
  - 存储在内存中（前端 JS）
  - 撤销操作通过 WebSocket 同步给其他用户（以"反向操作"形式）
- **操作**：
  - `Ctrl+Z`：撤销
  - `Ctrl+Y`：重做

### 4.6 持久化模块

#### 4.6.1 白板快照
- **触发条件**：
  - 用户手动保存（仅注册用户）
  - 定时自动保存（每5分钟，仅注册用户创建的房间）
  - 最后一个用户离开房间时
- **存储方式**：将 Canvas 内容序列化为 JSON，存入 rooms.snapshot
- **加载方式**：进入房间时，如果有快照则恢复

#### 4.6.2 快照数据结构
```json
{
  "version": 1,
  "objects": [
    { "type": "pen", "points": [...], "color": "#000", "width": 2 },
    { "type": "line", "start": [x1,y1], "end": [x2,y2], "color": "#000", "width": 2 },
    { "type": "rect", "start": [x1,y1], "end": [x2,y2], "color": "#000", "width": 2 },
    { "type": "circle", "center": [x,y], "radius": r, "color": "#000", "width": 2 },
    { "type": "text", "position": [x,y], "content": "hello", "color": "#000", "fontSize": 16 }
  ],
  "timestamp": 1234567890
}
```

---

## 五、WebSocket 事件定义

### 5.1 客户端 → 服务器

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `join_room` | `{ room_id, nickname, user_id }` | 加入房间 |
| `leave_room` | `{ room_id }` | 离开房间 |
| `draw` | `{ room_id, draw_data }` | 绘图数据 |
| `undo` | `{ room_id, operation_id }` | 撤销操作 |
| `redo` | `{ room_id, operation_id }` | 重做操作 |
| `cursor_move` | `{ room_id, x, y }` | 光标位置（可选） |

### 5.2 服务器 → 客户端

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `user_joined` | `{ nickname, online_count }` | 用户加入通知 |
| `user_left` | `{ nickname, online_count }` | 用户离开通知 |
| `draw_data` | `{ draw_data }` | 绘图数据广播 |
| `undo_data` | `{ user_id, operation_id }` | 撤销操作广播 |
| `redo_data` | `{ user_id, operation_id }` | 重做操作广播 |
| `online_count` | `{ count }` | 在线人数更新 |

---

## 六、API 接口汇总

### 6.1 认证相关

| 方法 | 路径 | 说明 | 需登录 |
|------|------|------|--------|
| POST | /api/auth/register | 用户注册 | ❌ |
| POST | /api/auth/login | 用户登录 | ❌ |
| POST | /api/auth/logout | 用户登出 | ✅ |
| GET | /api/auth/me | 获取当前用户 | ✅ |

### 6.2 房间相关

| 方法 | 路径 | 说明 | 需登录 |
|------|------|------|--------|
| POST | /api/rooms | 创建房间 | ❌ |
| GET | /api/rooms | 房间列表 | ✅ |
| GET | /api/rooms/\<room_id\> | 房间详情 | ❌ |
| POST | /api/rooms/\<room_id\>/join | 加入房间 | ❌ |
| POST | /api/rooms/\<room_id\>/save | 保存白板快照 | ✅ |

### 6.3 页面路由

| 路径 | 说明 |
|------|------|
| / | 首页（创建/加入房间） |
| /room/\<room_id\> | 白板页面 |

---

## 七、前端页面设计

### 7.1 首页
- 顶部导航栏：Logo + 登录/注册按钮（已登录显示用户名+登出）
- 中央区域：
  - 创建房间按钮
  - 加入房间输入框（输入房间ID）
- 底部：匿名用户提示"注册可保存白板内容"

### 7.2 白板页面
- 顶部：房间名称 + 在线人数 + 分享链接 + 保存按钮
- 左侧工具栏：画笔/橡皮/直线/矩形/圆形/文本/颜色/线宽
- 中央：Canvas 白板区域
- 右下角：撤销/重做按钮

---

## 八、项目目录结构

```
baiban/
├── app/
│   ├── __init__.py          # Flask app 工厂
│   ├── config.py            # 配置文件
│   ├── models.py            # 数据模型
│   ├── auth/
│   │   ├── __init__.py
│   │   └── routes.py        # 认证路由
│   ├── room/
│   │   ├── __init__.py
│   │   └── routes.py        # 房间路由
│   ├── socket/
│   │   ├── __init__.py
│   │   └── handlers.py      # WebSocket 事件处理
│   └── utils/
│       ├── __init__.py
│       └── helpers.py       # 工具函数
├── static/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── main.js          # 主入口
│   │   ├── whiteboard.js    # 白板绘图逻辑
│   │   ├── socket.js        # WebSocket 通信
│   │   └── tools.js         # 绘图工具
│   └── img/
├── templates/
│   ├── base.html
│   ├── index.html           # 首页
│   ├── room.html            # 白板页
│   ├── login.html
│   └── register.html
├── migrations/               # 数据库迁移（可选）
├── requirements.txt
├── run.py                    # 启动入口
└── README.md
```

---

## 九、依赖清单

```
Flask==3.0.0
Flask-SocketIO==5.3.6
Flask-SQLAlchemy==3.1.1
redis==5.0.1
werkzeug==3.0.1
gevent==23.9.1
python-dotenv==1.0.0
```

> gevent 作为 Flask-SocketIO 的异步模式，性能优于默认的 threading

---

## 十、安全设计

- 密码使用 werkzeug 的 pbkdf2 哈希存储
- Session 使用 Flask 签名 cookie
- WebSocket 连接验证房间权限
- CORS 限制（生产环境）
- 输入校验防止 XSS/SQL 注入

---

## 十一、确认清单

- [x] 匿名用户：可创建/加入房间、绘图，但不持久化
- [x] 注册用户：完整功能含持久化
- [x] 实时协作：Flask-SocketIO + Redis Pub/Sub
- [x] 绘图工具：画笔、橡皮、直线、矩形、圆形、文本、颜色、线宽
- [x] 持久化：快照方式，注册用户手动/自动保存
- [x] 撤销重做：个人操作栈，前端维护
- [x] 错误处理：`{ "code": "...", "message": "中文提示" }`
- [x] 部署：本地开发优先
