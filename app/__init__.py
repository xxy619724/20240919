import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO
from redis import Redis

db = SQLAlchemy()
socketio = SocketIO()
redis_client = None


def create_app(config_name='development'):
    # 指定模板和静态文件路径为项目根目录下的 templates 和 static
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    app = Flask(__name__,
                template_folder=os.path.join(base_dir, 'templates'),
                static_folder=os.path.join(base_dir, 'static'))
    app.config.from_object(get_config(config_name))

    # 初始化扩展
    db.init_app(app)

    # Redis 连接 + SocketIO 初始化
    # run.py 已做 gevent monkey patch，始终使用 gevent 模式
    global redis_client
    try:
        redis_client = Redis(
            host=app.config.get('REDIS_HOST', 'localhost'),
            port=app.config.get('REDIS_PORT', 6379),
            db=app.config.get('REDIS_DB', 0),
            decode_responses=True
        )
        redis_client.ping()
        socketio.init_app(app, cors_allowed_origins="*", async_mode='gevent',
                         message_queue='redis://')
        print('[INFO] Redis 连接成功（gevent + Redis 消息队列）')
    except Exception:
        redis_client = None
        # Redis 不可用，仍用 gevent 模式（单进程内存消息队列）
        socketio.init_app(app, cors_allowed_origins="*", async_mode='gevent')
        print('[INFO] Redis 不可用（gevent 内存模式，单进程）')

    # 注册蓝图
    from app.auth.routes import auth_bp
    from app.room.routes import room_bp

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(room_bp, url_prefix='/api/rooms')

    # 注册页面路由
    from app.views import views_bp
    app.register_blueprint(views_bp)

    # 注册 WebSocket 事件
    from app.socket.handlers import register_socket_handlers
    register_socket_handlers(socketio)

    # 自动建表
    with app.app_context():
        from app import models
        db.create_all()

    return app


def get_config(config_name):
    from app.config import DevelopmentConfig, ProductionConfig
    configs = {
        'development': DevelopmentConfig,
        'production': ProductionConfig,
    }
    return configs.get(config_name, DevelopmentConfig)
