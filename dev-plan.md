# 在线白板协作软件 - 开发计划

> 版本：v1.0 | 日期：2026-04-29 | 状态：待确认

---

## 开发阶段总览

| 阶段 | 内容 | 预估 |
|------|------|------|
| P0 | 项目骨架搭建 | 1 个任务 |
| P1 | 用户认证模块 | 2 个任务 |
| P2 | 房间模块 | 2 个任务 |
| P3 | 白板绘图模块 | 3 个任务 |
| P4 | 实时协作模块 | 2 个任务 |
| P5 | 持久化与撤销重做 | 2 个任务 |
| P6 | 集成测试与打磨 | 1 个任务 |

---

## P0 - 项目骨架搭建

### Task 0.1：初始化项目结构与配置

**目标**：搭建完整的项目骨架，确保能启动运行

**具体内容**：
- 创建目录结构（app/, static/, templates/）
- 编写 `app/config.py`：DevelopmentConfig（SQLite路径、SecretKey、Redis配置）
- 编写 `app/__init__.py`：Flask app 工厂函数，注册蓝图、初始化 SQLAlchemy/SocketIO
- 编写 `app/models.py`：定义 User、Room、RoomParticipant 三个模型
- 编写 `run.py`：启动入口（gevent 模式）
- 编写 `requirements.txt`：锁定依赖版本
- 编写 `templates/base.html`：基础模板（引入 CSS/JS）
- 初始化数据库（首次运行自动建表）

**验收标准**：
- [x] `python run.py` 能正常启动
- [x] 访问首页不报错
- [x] SQLite 数据库文件自动创建

---

## P1 - 用户认证模块

### Task 1.1：后端认证 API

**目标**：实现注册、登录、登出、获取当前用户四个接口

**具体内容**：
- `app/auth/routes.py`：
  - `POST /api/auth/register`：邮箱/用户名/密码/确认密码校验 → 入库
  - `POST /api/auth/login`：邮箱+密码验证 → 写入 session
  - `POST /api/auth/logout`：清除 session
  - `GET /api/auth/me`：返回当前登录用户信息
- 所有接口统一返回 `{ "code": "...", "message": "中文提示" }`
- 密码使用 `werkzeug.security` 的 `generate_password_hash` / `check_password_hash`
- 编写登录态装饰器 `login_required`

**验收标准**：
- [x] 注册成功返回 200 + 用户信息
- [x] 重复邮箱/用户名返回错误提示
- [x] 登录成功写入 session
- [x] 未登录访问 /api/auth/me 返回 401

### Task 1.2：前端认证页面

**目标**：实现登录、注册页面与首页导航栏

**具体内容**：
- `templates/login.html`：邮箱+密码表单，提交到 API
- `templates/register.html`：邮箱+用户名+密码+确认密码表单
- `static/js/auth.js`：表单提交逻辑，调用 API，处理错误 message 显示
- `templates/index.html`：首页，含导航栏（登录/注册按钮 OR 用户名+登出）
- 导航栏状态根据登录态切换

**验收标准**：
- [x] 注册表单校验通过后提交
- [x] API 返回错误时页面显示中文 message
- [x] 登录后导航栏显示用户名+登出按钮
- [x] 登出后跳回首页

---

## P2 - 房间模块

### Task 2.1：后端房间 API

**目标**：实现房间创建、查询、加入、列表接口

**具体内容**：
- `app/room/routes.py`：
  - `POST /api/rooms`：生成8位随机ID，创建房间，创建者自动加入
  - `GET /api/rooms/<room_id>`：返回房间信息（名称、在线人数、快照）
  - `POST /api/rooms/<room_id>/join`：加入房间，记录参与者
  - `GET /api/rooms`：返回当前用户参与的房间列表（需登录）
  - `POST /api/rooms/<room_id>/save`：保存白板快照（需登录）
- `app/utils/helpers.py`：生成随机房间ID的工具函数

**验收标准**：
- [x] 创建房间返回房间ID
- [x] 房间ID为8位随机字符串
- [x] 加入不存在的房间返回错误
- [x] 注册用户可查看自己的房间列表

### Task 2.2：前端房间页面

**目标**：首页创建/加入房间，白板页面布局

**具体内容**：
- `templates/index.html` 完善：
  - 创建房间按钮 → 调用 API → 跳转到白板页
  - 加入房间输入框 → 输入房间ID → 跳转到白板页
  - 已登录用户显示"我的房间"列表
- `templates/room.html`：
  - 顶部栏：房间名称 + 在线人数 + 复制链接 + 保存按钮
  - 左侧工具栏（占位，P3填充）
  - 中央 Canvas 白板区域
  - 右下角撤销/重做按钮（占位，P5填充）

**验收标准**：
- [x] 点击创建房间跳转到白板页
- [x] 输入房间ID可加入房间
- [x] 白板页显示房间名称和在线人数
- [x] 复制链接功能正常

---

## P3 - 白板绘图模块

### Task 3.1：Canvas 基础绘图引擎

**目标**：实现画笔、橡皮擦工具，支持颜色和线宽

**具体内容**：
- `static/js/whiteboard.js`：
  - Whiteboard 类：管理 Canvas 上下文
  - 绘图状态管理（当前工具、颜色、线宽）
  - 画笔实现：mousedown 开始路径 → mousemove 绘制 → mouseup 结束
  - 橡皮擦实现：使用 `globalCompositeOperation = 'destination-out'`
  - 颜色选择：预设调色板（8色 + 自定义颜色输入）
  - 线宽调节：滑块 1-20px
  - Canvas 自适应窗口大小（resize 事件）

**验收标准**：
- [x] 画笔可自由绘制，线条流畅
- [x] 橡皮擦可擦除内容
- [x] 颜色切换立即生效
- [x] 线宽调节实时反映
- [x] 窗口缩放 Canvas 跟随

### Task 3.2：形状与文本工具

**目标**：实现直线、矩形、圆形、文本工具

**具体内容**：
- `static/js/whiteboard.js` 扩展：
  - 直线：mousedown 记录起点 → mousemove 实时预览 → mouseup 确认
  - 矩形：同上，绘制矩形
  - 圆形：同上，绘制圆形
  - 文本：点击位置弹出输入框 → 确认后绘制文本
  - 形状预览：使用临时 Canvas 层绘制预览，确认后绘制到主 Canvas
- `static/js/tools.js`：工具切换逻辑，高亮当前工具

**验收标准**：
- [x] 直线拖拽绘制，松开确认
- [x] 矩形/圆形拖拽绘制，有实时预览
- [x] 文本工具点击输入文字
- [x] 工具切换正常，高亮当前选中

### Task 3.3：前端工具栏 UI

**目标**：完善左侧工具栏与交互

**具体内容**：
- `static/css/style.css`：工具栏样式
  - 工具图标按钮（使用 Unicode/emoji 图标）
  - 颜色选择面板
  - 线宽滑块
  - 活动工具高亮
- `templates/room.html`：工具栏 HTML 结构完善

**验收标准**：
- [x] 工具栏布局美观，工具图标清晰
- [x] 点击工具切换，当前工具高亮
- [x] 颜色面板展开/收起流畅
- [x] 线宽滑块操作顺畅

---

## P4 - 实时协作模块

### Task 4.1：WebSocket 事件处理（后端）

**目标**：实现所有 WebSocket 事件的收发与 Redis 广播

**具体内容**：
- `app/socket/handlers.py`：
  - `join_room`：加入 SocketIO 房间，广播 user_joined
  - `leave_room`：离开 SocketIO 房间，广播 user_left
  - `draw`：接收绘图数据，广播到房间（emit 到其他用户）
  - `disconnect`：清理在线状态，广播 user_left
- Redis 在线状态管理：
  - 连接时 SADD `room:{id}:online` nickname
  - 断开时 SREM
  - 获取在线人数 SCARD
- 连接认证：验证 session 中的用户身份

**验收标准**：
- [x] 用户加入/离开房间触发广播
- [x] 绘图数据实时转发到房间其他用户
- [x] 在线人数准确
- [x] 断开连接自动清理

### Task 4.2：前端 WebSocket 集成

**目标**：前端 Socket.IO 客户端连接与事件处理

**具体内容**：
- `static/js/socket.js`：
  - 连接 Socket.IO 服务器
  - 发送：join_room、leave_room、draw 事件
  - 接收：user_joined、user_left、draw_data 事件
  - draw_data 接收后调用 whiteboard.replayDraw() 重绘
- `static/js/whiteboard.js` 集成：
  - 绘图操作完成后自动通过 socket.js 发送
  - replayDraw() 方法：根据接收的绘图数据在 Canvas 上重绘

**验收标准**：
- [x] 两个浏览器窗口打开同一房间，绘图实时同步
- [x] 在线人数实时更新
- [x] 用户加入/离开有提示

---

## P5 - 持久化与撤销重做

### Task 5.1：白板快照持久化

**目标**：实现白板内容的保存与加载

**具体内容**：
- 后端 `POST /api/rooms/<room_id>/save`：
  - 接收前端序列化的操作列表
  - 存入 rooms.snapshot 字段（JSON 字符串）
  - 更新 rooms.updated_at
  - 仅注册用户可保存
- 后端 `GET /api/rooms/<room_id>` 扩展：
  - 返回 snapshot 数据
- 前端保存逻辑：
  - 手动保存：点击保存按钮
  - 自动保存：每5分钟触发一次（仅注册用户创建的房间）
  - 离开房间时保存（仅注册用户创建的房间）
- 前端加载逻辑：
  - 进入房间时，如果有快照数据则恢复白板
  - `whiteboard.loadSnapshot(snapshot)` 方法

**验收标准**：
- [x] 注册用户可手动保存白板
- [x] 重新进入房间可恢复白板内容
- [x] 匿名用户无保存按钮
- [x] 自动保存定时触发

### Task 5.2：撤销重做

**目标**：实现个人操作的撤销与重做

**具体内容**：
- `static/js/whiteboard.js` 扩展：
  - undoStack[] 和 redoStack[] 数组
  - 每次绘图操作完成后，操作数据入 undoStack，清空 redoStack
  - 撤销：从 undoStack 弹出 → 执行反向操作 → 入 redoStack → 通过 socket 同步
  - 重做：从 redoStack 弹出 → 重新执行 → 入 undoStack → 通过 socket 同步
  - 键盘快捷键：Ctrl+Z 撤销，Ctrl+Y 重做
  - 按钮点击：右下角撤销/重做按钮
- 撤销同步：发送 undo 事件到服务器，广播到房间其他用户
  - 其他用户收到后，在本地找到对应操作并执行反向操作

**验收标准**：
- [x] Ctrl+Z 撤销自己的上一笔
- [x] Ctrl+Y 重做
- [x] 撤销后其他用户同步看到
- [x] 撤销栈/重做栈正确维护

---

## P6 - 集成测试与打磨

### Task 6.1：集成联调与 UI 打磨

**目标**：全流程联调，修复问题，UI 细节打磨

**具体内容**：
- 全流程测试：
  - 匿名用户：创建房间 → 绘图 → 其他用户加入 → 实时同步
  - 注册用户：注册 → 登录 → 创建房间 → 绘图 → 保存 → 退出 → 重新进入 → 恢复
  - 撤销重做：绘图 → 撤销 → 重做 → 其他用户同步
- UI 打磨：
  - 响应式布局适配
  - 工具栏 hover 效果
  - 在线人数变化的动画提示
  - 保存成功/失败提示
  - 页面加载 loading 状态
- 边界处理：
  - Canvas 为空时保存提示
  - 房间不存在时的友好提示
  - 网络断开重连处理
  - 并发绘制的冲突处理

**验收标准**：
- [x] 全流程无报错
- [x] UI 交互流畅
- [x] 边界情况有友好提示

---

## 开发依赖关系

```
P0 (骨架)
 ├── P1 (认证) ── P2 (房间)
 │                     │
 ├── P3 (绘图引擎)     │
 │       │             │
 │       ├── P4 (实时协作) ← 依赖 P2 + P3
 │       │
 │       └── P5 (持久化+撤销) ← 依赖 P3 + P4
 │
 └── P6 (集成测试) ← 依赖全部
```

## 可并行任务

- P1 和 P3 可并行开发（认证与绘图引擎无依赖）
- Task 3.2 和 Task 3.3 可并行（形状工具与工具栏UI）
