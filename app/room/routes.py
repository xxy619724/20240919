from flask import Blueprint, request, jsonify, session
from app import db, redis_client
from app.models import Room, RoomParticipant, User
from app.utils.helpers import generate_room_id
from app.auth.routes import api_response, login_required
from app.socket.handlers import get_online_count
import json
import os
import base64
from datetime import datetime

room_bp = Blueprint('room', __name__)


@room_bp.route('', methods=['POST'])
def create_room():
    data = request.get_json() or {}
    name = data.get('name', '').strip() or '未命名房间'

    # 生成唯一房间ID
    room_id = generate_room_id()
    while Room.query.get(room_id):
        room_id = generate_room_id()

    creator_id = session.get('user_id')

    room = Room(id=room_id, name=name, creator_id=creator_id)
    db.session.add(room)

    # 创建者自动加入
    nickname = session.get('username', '访客')
    if creator_id:
        participant = RoomParticipant(room_id=room_id, user_id=creator_id, nickname=nickname)
    else:
        nickname = f'访客{room_id[:4]}'
        participant = RoomParticipant(room_id=room_id, user_id=None, nickname=nickname)
    db.session.add(participant)
    db.session.commit()

    return api_response('SUCCESS', '房间创建成功', data={
        'id': room.id,
        'name': room.name,
        'creator_id': room.creator_id,
        'nickname': nickname
    })


@room_bp.route('/<room_id>', methods=['GET'])
def get_room(room_id):
    room = Room.query.get(room_id)
    if not room:
        return api_response('ROOM_NOT_FOUND', '房间不存在', status=404)

    # 获取在线人数（兼容 Redis 和内存模式）
    online_count = get_online_count(room_id)

    result = room.to_dict()
    result['online_count'] = online_count
    result['snapshot'] = room.snapshot

    return api_response('SUCCESS', '获取成功', data=result)


@room_bp.route('/<room_id>/join', methods=['POST'])
def join_room(room_id):
    room = Room.query.get(room_id)
    if not room:
        return api_response('ROOM_NOT_FOUND', '房间不存在', status=404)

    data = request.get_json() or {}
    nickname = data.get('nickname', '').strip()

    user_id = session.get('user_id')
    if not nickname:
        if user_id:
            user = User.query.get(user_id)
            nickname = user.username if user else f'访客{room_id[:4]}'
        else:
            nickname = f'访客{room_id[:4]}'

    # 检查是否已加入（注册用户）
    if user_id:
        existing = RoomParticipant.query.filter_by(room_id=room_id, user_id=user_id).first()
        if existing:
            return api_response('SUCCESS', '已在该房间中', data={'nickname': existing.nickname})

    participant = RoomParticipant(room_id=room_id, user_id=user_id, nickname=nickname)
    db.session.add(participant)
    db.session.commit()

    return api_response('SUCCESS', '加入房间成功', data={
        'room_id': room_id,
        'nickname': nickname
    })


@room_bp.route('', methods=['GET'])
@login_required
def list_rooms():
    user_id = session.get('user_id')
    participations = RoomParticipant.query.filter_by(user_id=user_id).all()
    room_ids = [p.room_id for p in participations]
    rooms = Room.query.filter(Room.id.in_(room_ids)).order_by(Room.updated_at.desc()).all() if room_ids else []

    result = []
    for room in rooms:
        online_count = get_online_count(room.id)
        room_dict = room.to_dict()
        room_dict['online_count'] = online_count
        result.append(room_dict)

    return api_response('SUCCESS', '获取成功', data=result)


@room_bp.route('/<room_id>/save', methods=['POST'])
@login_required
def save_room(room_id):
    room = Room.query.get(room_id)
    if not room:
        return api_response('ROOM_NOT_FOUND', '房间不存在', status=404)

    data = request.get_json()
    if not data or 'snapshot' not in data:
        return api_response('MISSING_FIELD', '快照数据不能为空', status=400)

    room.snapshot = json.dumps(data['snapshot'], ensure_ascii=False)
    from datetime import datetime
    room.updated_at = datetime.utcnow()
    db.session.commit()

    return api_response('SUCCESS', '保存成功')


@room_bp.route('/<room_id>/export', methods=['POST'])
def export_room_image(room_id):
    """将白板图片缓存到服务器本地"""
    room = Room.query.get(room_id)
    if not room:
        return api_response('ROOM_NOT_FOUND', '房间不存在', status=404)

    data = request.get_json()
    if not data or 'image' not in data:
        return api_response('MISSING_FIELD', '图片数据不能为空', status=400)

    try:
        # 解析 base64 图片数据
        image_data = data['image']
        fmt = data.get('format', 'png')

        # 去掉 data:image/xxx;base64, 前缀
        if ',' in image_data:
            image_data = image_data.split(',', 1)[1]

        image_bytes = base64.b64decode(image_data)

        # 生成文件名：房间名_时间戳.ext
        ext = 'jpg' if fmt == 'jpg' else 'png'
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_name = room.name.replace(' ', '_')[:20]
        filename = f"{safe_name}_{timestamp}.{ext}"

        # 确保 exports 目录存在
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
        exports_dir = os.path.join(base_dir, 'exports')
        os.makedirs(exports_dir, exist_ok=True)

        # 保存文件
        filepath = os.path.join(exports_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(image_bytes)

        print(f'[EXPORT] 图片已缓存: {filepath} ({len(image_bytes)} bytes)')

        return api_response('SUCCESS', '图片已缓存到服务器', data={
            'filename': filename,
            'size': len(image_bytes)
        })
    except Exception as e:
        print(f'[EXPORT] 导出失败: {e}')
        return api_response('EXPORT_ERROR', '图片缓存失败', status=500)
