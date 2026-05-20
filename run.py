# gevent monkey patch 必须在所有其他 import 之前！
from gevent import monkey
monkey.patch_all()

import sys
import io

# 修复 Windows GBK 编码问题，确保 emoji 和中文不会导致崩溃
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
    print('=' * 50)
    print('[OK] 在线白板协作服务器启动中...')
    print('[OK] 本地访问: http://127.0.0.1:5000')
    print('[OK] 局域网访问: http://0.0.0.0:5000')
    print('=' * 50)
    socketio.run(app, host='0.0.0.0', debug=False, port=5000)
