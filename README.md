# 在线白板协作软件

一个基于 Flask + SocketIO 的实时协作白板应用，支持多人同时在线绘图、房间管理、撤销重做和数据持久化。

## 功能特性

### 绘图工具
- **画笔** - 基础画笔，支持颜色和线宽调节
- **画笔选择组** - 8 种笔触：毛笔(压感梯形)、书写笔(轻微压感)、喷枪(散点)、油画笔(厚重条带)、蜡笔(抖动半透明)、记号笔(宽平半透明)、铅笔(细线+噪声)、水彩笔(多层扩散)
- **橡皮擦** - 擦除已有内容
- **文本** - 在画布上添加文字
- **形状工具组** - 直线/曲线/椭圆/矩形/三角形/梯形/菱形/正五边形/正六边形/四方向箭头/三种五角星/心形
- **实心图形** - 实心矩形/实心圆形/实心三角形
- **填充工具** - Flood Fill 算法，点击填充当前颜色
- **取色器** - 点击拾取画布颜色，自动切回画笔
- **缩放工具** - 左键放大/右键缩小/Ctrl+滚轮，范围 0.1x-5x

### 选择与编辑
- **选择工具** - 框选区域内的图形，点击选择单个图形
- **8 控制点缩放** - 侧边控制点单向拉伸，四角控制点等比例缩放，实时预览
- **批量操作** - 选中后批量删除、批量移动、批量换色
- **右键上下文菜单** - 复制/粘贴/删除/旋转(90°/180°/自定义)/翻转(水平/垂直)/边框(实线/虚线/无边框)
- **旋转手柄** - 选中框顶部旋转手柄支持拖拽自定义旋转

### 撤销与重做
- **个人操作栈** - Ctrl+Z 撤销，Ctrl+Y 重做
- **批量撤销** - Ctrl+Shift+Z 一次撤销 5 步

### 协作功能
- **实时同步** - 基于 SocketIO 的实时绘图同步
- **房间管理** - 创建/加入房间，在线人数显示
- **光标追踪** - 查看其他用户的鼠标位置
- **批量操作同步** - 删除/移动/换色/旋转/翻转/缩放均支持 Socket 同步

### 导出与持久化
- **图片导出** - 支持 PNG/JPG 格式
- **数据持久化** - 登录用户可保存白板快照

## 技术栈

- **后端**: Python Flask + Flask-SocketIO + Flask-SQLAlchemy
- **数据库**: SQLite (开发环境)
- **实时通信**: Socket.IO (WebSocket + Polling)
- **消息队列**: Redis (可选，不可用时自动降级为 gevent 内存模式)
- **前端**: HTML5 Canvas + 原生 JavaScript + CSS3
- **异步模式**: gevent + gevent-websocket

## 项目结构

```
├── app/                    # Flask 应用包
│   ├── __init__.py         # App 工厂 + Redis/SocketIO 初始化
│   ├── config.py           # 配置 (开发/生产)
│   ├── models.py           # 数据模型 (User, Room, RoomParticipant)
│   ├── views.py            # 页面路由
│   ├── auth/               # 认证模块 (注册/登录/登出)
│   ├── room/               # 房间模块 (CRUD/保存/导出)
│   ├── socket/             # WebSocket 模块 (实时事件处理)
│   └── utils/              # 工具函数
├── static/                 # 静态资源
│   ├── css/
│   │   ├── style.css       # 首页样式
│   │   └── whiteboard.css  # 白板页面样式
│   └── js/
│       ├── main.js         # 全局工具函数
│       ├── tools.js        # 绘图工具管理
│       ├── whiteboard.js   # 白板绘图引擎
│       └── socket.js       # Socket.IO 通信管理
├── templates/              # Jinja2 模板
│   ├── base.html           # 基础布局
│   ├── index.html          # 首页
│   ├── login.html          # 登录页
│   ├── register.html       # 注册页
│   └── room.html           # 白板房间页
├── run.py                  # 启动入口
├── requirements.txt        # Python 依赖
└── .gitignore
```

## 快速开始

### 环境要求

- Python 3.10+
- Redis (可选，不安装则自动使用内存模式)

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/online-whiteboard.git
cd online-whiteboard

# 2. 创建虚拟环境
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/macOS
source venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 4. 启动服务器
python run.py
```

服务器启动后访问：
- 本地: http://127.0.0.1:5000
- 局域网: http://你的IP:5000

### 可选：配置 Redis

安装 Redis 后，应用会自动检测并使用 Redis 作为消息队列，支持多进程部署。

## 使用说明

1. **创建房间** - 在首页输入房间名称，点击创建
2. **加入房间** - 通过房间链接或房间 ID 加入
3. **绘图** - 选择左侧工具栏的工具开始绘图
4. **选择编辑** - 切换到选择工具(👆)，点击或框选图形，右键弹出编辑菜单
5. **撤销/重做** - 右下角按钮或快捷键 Ctrl+Z / Ctrl+Y
6. **保存** - 登录用户可点击保存按钮持久化白板数据

## 许可证

MIT License
