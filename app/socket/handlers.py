from app import socketio, redis_client
from flask import request
from flask_socketio import join_room, leave_room, emit

# 内存模式：Redis 不可用时用 dict 追踪在线状态
# 格式: { room_id: { sid: nickname } }
_online_users = {}


def get_online_count(room_id):
    """获取房间在线人数（兼容 Redis 和内存模式，供外部模块调用）"""
    if redis_client:
        return redis_client.scard(f'room:{room_id}:online')
    return len(_online_users.get(room_id, {}))


def _get_online_users(room_id):
    """获取房间在线用户（兼容 Redis 和内存模式）"""
    if redis_client:
        members = redis_client.smembers(f'room:{room_id}:online')
        return {m.split(':', 1)[0]: m.split(':', 1)[1] for m in members if ':' in m}
    return dict(_online_users.get(room_id, {}))


def _add_online_user(room_id, sid, nickname):
    """添加在线用户"""
    if redis_client:
        redis_client.sadd(f'room:{room_id}:online', f'{sid}:{nickname}')
    else:
        if room_id not in _online_users:
            _online_users[room_id] = {}
        _online_users[room_id][sid] = nickname


def _remove_online_user(room_id, sid):
    """移除在线用户"""
    if redis_client:
        members = redis_client.smembers(f'room:{room_id}:online')
        for m in members:
            if m.startswith(f'{sid}:'):
                redis_client.srem(f'room:{room_id}:online', m)
                return m.split(':', 1)[1] if ':' in m else '访客'
        return None
    else:
        if room_id in _online_users and sid in _online_users[room_id]:
            nickname = _online_users[room_id].pop(sid)
            if not _online_users[room_id]:
                del _online_users[room_id]
            return nickname
        return None


def register_socket_handlers(sio):

    @sio.on('connect')
    def handle_connect():
        print(f'[Socket] 客户端连接: {request.sid}')

    @sio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        print(f'[Socket] 客户端断开: {sid}')

        if redis_client:
            for key in redis_client.scan_iter('room:*:online'):
                members = redis_client.smembers(key)
                for member in members:
                    if member.startswith(f'{sid}:'):
                        redis_client.srem(key, member)
                        room_id = key.split(':')[1]
                        online_count = len(redis_client.smembers(key))
                        nickname = member.split(':', 1)[1] if ':' in member else '访客'
                        emit('user_left', {
                            'nickname': nickname,
                            'online_count': online_count
                        }, room=room_id)
                        break
        else:
            for room_id in list(_online_users.keys()):
                if sid in _online_users.get(room_id, {}):
                    nickname = _remove_online_user(room_id, sid)
                    online_count = len(_get_online_users(room_id))
                    print(f'[Socket] {nickname} 离开房间 {room_id}, 在线: {online_count}')
                    emit('user_left', {
                        'nickname': nickname or '访客',
                        'online_count': online_count
                    }, room=room_id)

    @sio.on('join_room')
    def handle_join_room(data):
        room_id = data.get('room_id')
        nickname = data.get('nickname', '访客')

        if not room_id:
            print('[Socket] join_room 缺少 room_id')
            return

        # 使用 flask_socketio 的 join_room 函数（不是 sio 的方法！）
        join_room(room_id)
        _add_online_user(room_id, request.sid, nickname)

        online_users = _get_online_users(room_id)
        online_count = len(online_users)

        print(f'[Socket] {nickname} 加入房间 {room_id}, 在线: {online_count}, sid: {request.sid}')
        print(f'[Socket]   房间内用户: {list(online_users.values())}')

        # 1. 通知房间内其他用户
        emit('user_joined', {
            'nickname': nickname,
            'online_count': online_count,
            'user_id': request.sid
        }, room=room_id, skip_sid=request.sid)

        # 2. 通知当前用户加入成功
        emit('room_joined', {
            'room_id': room_id,
            'nickname': nickname,
            'online_count': online_count,
            'users': list(online_users.values())
        }, room=request.sid)

        # 3. 广播在线人数给房间所有人
        emit('online_count', {'count': online_count}, room=room_id)

    @sio.on('leave_room')
    def handle_leave_room(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        nickname = _remove_online_user(room_id, request.sid)
        leave_room(room_id)

        online_count = len(_get_online_users(room_id))
        print(f'[Socket] {nickname} 离开房间 {room_id}, 在线: {online_count}')

        emit('user_left', {
            'nickname': nickname or '访客',
            'online_count': online_count
        }, room=room_id)

    @sio.on('draw')
    def handle_draw(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        draw_data = data.get('draw_data')
        tool_type = draw_data.get('type') if draw_data else '?'
        print(f'[Socket] 绘图: {tool_type} from {request.sid} in {room_id}')

        # 广播绘图数据到房间内其他用户（跳过发送者）
        emit('draw_data', {
            'draw_data': draw_data,
            'user_id': request.sid
        }, room=room_id, skip_sid=request.sid)

    @sio.on('undo')
    def handle_undo(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        emit('undo_data', {
            'user_id': request.sid,
            'operation_id': data.get('operation_id'),
            'draw_data': data.get('draw_data')
        }, room=room_id, skip_sid=request.sid)

    @sio.on('redo')
    def handle_redo(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        emit('redo_data', {
            'user_id': request.sid,
            'operation_id': data.get('operation_id'),
            'draw_data': data.get('draw_data')
        }, room=room_id, skip_sid=request.sid)

    @sio.on('cursor_move')
    def handle_cursor_move(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        emit('cursor_move', {
            'user_id': request.sid,
            'x': data.get('x'),
            'y': data.get('y'),
            'nickname': data.get('nickname', '')
        }, room=room_id, skip_sid=request.sid)

    # ===== 批量操作事件 =====

    @sio.on('batch_delete')
    def handle_batch_delete(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        op_ids = data.get('op_ids', [])
        print(f'[Socket] 批量删除: {len(op_ids)} 个操作 from {request.sid} in {room_id}')

        emit('batch_delete', {
            'user_id': request.sid,
            'op_ids': op_ids
        }, room=room_id, skip_sid=request.sid)

    @sio.on('batch_move')
    def handle_batch_move(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        op_ids = data.get('op_ids', [])
        dx = data.get('dx', 0)
        dy = data.get('dy', 0)
        print(f'[Socket] 批量移动: {len(op_ids)} 个操作 dx={dx} dy={dy} from {request.sid} in {room_id}')

        emit('batch_move', {
            'user_id': request.sid,
            'op_ids': op_ids,
            'dx': dx,
            'dy': dy
        }, room=room_id, skip_sid=request.sid)

    @sio.on('batch_color')
    def handle_batch_color(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        op_ids = data.get('op_ids', [])
        new_color = data.get('new_color', '#000000')
        print(f'[Socket] 批量换色: {len(op_ids)} 个操作 color={new_color} from {request.sid} in {room_id}')

        emit('batch_color', {
            'user_id': request.sid,
            'op_ids': op_ids,
            'new_color': new_color
        }, room=room_id, skip_sid=request.sid)

    @sio.on('batch_undo')
    def handle_batch_undo(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        batch_op = data.get('batch_op', {})
        batch_type = batch_op.get('type', '?')
        print(f'[Socket] 批量撤销: {batch_type} from {request.sid} in {room_id}')

        # 广播给其他用户，让他们也执行反向操作
        emit('batch_undo_remote', {
            'user_id': request.sid,
            'batch_op': batch_op
        }, room=room_id, skip_sid=request.sid)

    @sio.on('batch_transform')
    def handle_batch_transform(data):
        room_id = data.get('room_id')
        if not room_id:
            return

        op_ids = data.get('op_ids', [])
        transform_type = data.get('transform_type', '?')
        params = data.get('params', {})
        print(f'[Socket] 批量变换: {transform_type} {len(op_ids)} ops from {request.sid} in {room_id}')

        emit('batch_transform', {
            'user_id': request.sid,
            'op_ids': op_ids,
            'transform_type': transform_type,
            'params': params
        }, room=room_id, skip_sid=request.sid)

    print('[Socket] WebSocket 事件处理器已注册')
