// ========== Socket.IO 通信管理 ==========

class SocketManager {
    constructor() {
        this.socket = null;
        this.roomId = window.ROOM_ID;
        this.nickname = window.NICKNAME;
        this.connected = false;
        this.mySid = null;
        this.joinRetries = 0;
    }

    connect() {
        const loc = window.location;
        const socketUrl = loc.protocol + '//' + loc.host;

        console.log('[Socket] 连接到:', socketUrl, '房间:', this.roomId);

        this.socket = io(socketUrl, {
            transports: ['polling', 'websocket'],
            upgrade: true,
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 1000,
            timeout: 20000,
            forceNew: true
        });

        // ---- 连接成功 ----
        this.socket.on('connect', () => {
            this.connected = true;
            this.mySid = this.socket.id;
            console.log('[Socket] 已连接, sid:', this.mySid);

            // 立即加入房间
            this.joinRoom();
        });

        // ---- 加入房间成功 ----
        this.socket.on('room_joined', (data) => {
            console.log('[Socket] 已加入房间:', data.room_id, '在线:', data.online_count, '用户:', data.users);
            this.updateOnlineCount(data.online_count);
            this.joinRetries = 0;
        });

        // ---- 其他用户加入 ----
        this.socket.on('user_joined', (data) => {
            console.log('[Socket] 用户加入:', data.nickname, '在线:', data.online_count);
            this.updateOnlineCount(data.online_count);
            showToast(`${data.nickname} 加入了房间`);
        });

        // ---- 用户离开 ----
        this.socket.on('user_left', (data) => {
            console.log('[Socket] 用户离开:', data.nickname, '在线:', data.online_count);
            this.updateOnlineCount(data.online_count);
            if (data.nickname) {
                showToast(`${data.nickname} 离开了房间`);
            }
        });

        // ---- 在线人数更新 ----
        this.socket.on('online_count', (data) => {
            console.log('[Socket] 在线人数:', data.count);
            this.updateOnlineCount(data.count);
        });

        // ---- 核心：接收远程绘图数据 ----
        this.socket.on('draw_data', (data) => {
            if (!window.wb || !data.draw_data) return;

            // 跳过自己发的操作
            if (data.user_id === this.mySid) {
                return;
            }

            const drawData = data.draw_data;
            console.log('[Socket] 收到远程绘图, type:', drawData.type, 'from:', data.user_id);
            window.wb.replayDraw(drawData);
            window.wb.operations.push(drawData);
        });

        // ---- 远程撤销 ----
        this.socket.on('undo_data', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb) {
                window.wb.remoteUndo(data.operation_id);
            }
        });

        // ---- 远程重做 ----
        this.socket.on('redo_data', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb && data.draw_data) {
                window.wb.remoteRedo(data.draw_data);
            }
        });

        // ---- 远程批量删除 ----
        this.socket.on('batch_delete', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb && data.op_ids) {
                window.wb.remoteBatchDelete(data.op_ids);
            }
        });

        // ---- 远程批量移动 ----
        this.socket.on('batch_move', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb && data.op_ids) {
                window.wb.remoteBatchMove(data.op_ids, data.dx, data.dy);
            }
        });

        // ---- 远程批量换色 ----
        this.socket.on('batch_color', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb && data.op_ids) {
                window.wb.remoteBatchColor(data.op_ids, data.new_color);
            }
        });

        // ---- 远程批量撤销 ----
        this.socket.on('batch_undo_remote', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb && data.batch_op) {
                this.handleRemoteBatchUndo(data.batch_op);
            }
        });

        // ---- 远程批量变换 ----
        this.socket.on('batch_transform', (data) => {
            if (data.user_id === this.mySid) return;
            if (window.wb && data.op_ids) {
                window.wb.remoteBatchTransform(data.op_ids, data.transform_type, data.params);
            }
        });

        // ---- 远程光标 ----
        this.socket.on('cursor_move', (data) => {
            if (data.user_id === this.mySid) return;
            this.showRemoteCursor(data);
        });

        // ---- 断开连接 ----
        this.socket.on('disconnect', (reason) => {
            this.connected = false;
            console.log('[Socket] 断开连接:', reason);
        });

        // ---- 连接错误 ----
        this.socket.on('connect_error', (err) => {
            console.error('[Socket] 连接错误:', err.message);
        });

        // ---- 重连成功 ----
        this.socket.on('reconnect', (attempt) => {
            console.log('[Socket] 重连成功, 尝试次数:', attempt);
        });

        // ---- 重连失败 ----
        this.socket.on('reconnect_failed', () => {
            console.error('[Socket] 重连失败');
            showToast('实时连接已断开，请刷新页面');
        });
    }

    joinRoom() {
        if (!this.socket || !this.connected) {
            if (this.joinRetries < 5) {
                this.joinRetries++;
                setTimeout(() => this.joinRoom(), 500);
            }
            return;
        }

        console.log('[Socket] 发送 join_room, room_id:', this.roomId, 'nickname:', this.nickname);
        this.socket.emit('join_room', {
            room_id: this.roomId,
            nickname: this.nickname
        });
    }

    sendDraw(operation) {
        if (this.socket && this.connected) {
            this.socket.emit('draw', {
                room_id: this.roomId,
                draw_data: operation
            });
            console.log('[Socket] 发送绘图, type:', operation.type);
        } else {
            console.warn('[Socket] 未连接，绘图未发送');
        }
    }

    sendUndo(operationId, operation) {
        if (this.socket && this.connected) {
            this.socket.emit('undo', {
                room_id: this.roomId,
                operation_id: operationId,
                draw_data: operation
            });
        }
    }

    sendRedo(operationId, operation) {
        if (this.socket && this.connected) {
            this.socket.emit('redo', {
                room_id: this.roomId,
                operation_id: operationId,
                draw_data: operation
            });
        }
    }

    // 批量删除
    sendBatchDelete(opIds) {
        if (this.socket && this.connected) {
            this.socket.emit('batch_delete', {
                room_id: this.roomId,
                op_ids: opIds
            });
        }
    }

    // 批量移动
    sendBatchMove(opIds, dx, dy) {
        if (this.socket && this.connected) {
            this.socket.emit('batch_move', {
                room_id: this.roomId,
                op_ids: opIds,
                dx: dx,
                dy: dy
            });
        }
    }

    // 批量换色
    sendBatchColor(opIds, newColor) {
        if (this.socket && this.connected) {
            this.socket.emit('batch_color', {
                room_id: this.roomId,
                op_ids: opIds,
                new_color: newColor
            });
        }
    }

    // 批量撤销同步
    sendBatchUndo(batchId, batchOp) {
        if (this.socket && this.connected) {
            this.socket.emit('batch_undo', {
                room_id: this.roomId,
                batch_id: batchId,
                batch_op: batchOp
            });
        }
    }

    // 批量变换同步（旋转/翻转/边框）
    sendBatchTransform(opIds, transformType, params) {
        if (this.socket && this.connected) {
            this.socket.emit('batch_transform', {
                room_id: this.roomId,
                op_ids: opIds,
                transform_type: transformType,
                params: params
            });
        }
    }

    // 处理远程批量撤销
    handleRemoteBatchUndo(batchOp) {
        if (!window.wb) return;
        const type = batchOp.type;

        if (type === 'batch_delete') {
            // 远程用户撤销了批量删除 = 恢复被删除的操作
            if (batchOp.deleted_ops) {
                for (const op of batchOp.deleted_ops) {
                    window.wb.operations.push(op);
                }
                window.wb.redrawAll();
            }
        } else if (type === 'batch_move') {
            // 远程用户撤销了批量移动 = 反向移动
            if (batchOp.old_ops) {
                for (const oldInfo of batchOp.old_ops) {
                    const current = window.wb.operations.find(o => o.id === oldInfo.id);
                    if (current) Object.assign(current, oldInfo);
                }
                window.wb.redrawAll();
            }
        } else if (type === 'batch_color') {
            // 远程用户撤销了批量换色 = 恢复原色
            if (batchOp.old_ops) {
                for (const oldInfo of batchOp.old_ops) {
                    const current = window.wb.operations.find(o => o.id === oldInfo.id);
                    if (current) current.color = oldInfo.color;
                }
                window.wb.redrawAll();
            }
        } else if (type === 'batch_rotate' || type === 'batch_flip') {
            // 远程用户撤销了旋转/翻转 = 恢复原数据（包括 rotation/flipH/flipV/transformOrigin）
            if (batchOp.old_ops) {
                for (const oldOp of batchOp.old_ops) {
                    const current = window.wb.operations.find(o => o.id === oldOp.id);
                    if (current) {
                        delete current.rotation;
                        delete current.flipH;
                        delete current.flipV;
                        delete current.transformOrigin;
                        Object.assign(current, oldOp);
                    }
                }
                window.wb.redrawAll();
            }
        } else if (type === 'batch_border') {
            // 远程用户撤销了边框 = 恢复原边框
            if (batchOp.old_ops) {
                for (const oldInfo of batchOp.old_ops) {
                    const current = window.wb.operations.find(o => o.id === oldInfo.id);
                    if (current) current.borderStyle = oldInfo.borderStyle;
                }
                window.wb.redrawAll();
            }
        } else if (type === 'batch_resize') {
            // 远程用户撤销了缩放/拉伸 = 恢复原始操作数据
            if (batchOp.old_ops) {
                for (const oldOp of batchOp.old_ops) {
                    const current = window.wb.operations.find(o => o.id === oldOp.id);
                    if (current) {
                        delete current.rotation;
                        delete current.flipH;
                        delete current.flipV;
                        delete current.transformOrigin;
                        Object.assign(current, oldOp);
                    }
                }
                window.wb.redrawAll();
            }
        }
    }

    sendCursorMove(x, y) {
        if (this.socket && this.connected) {
            this.socket.emit('cursor_move', {
                room_id: this.roomId,
                x: x,
                y: y,
                nickname: this.nickname
            });
        }
    }

    updateOnlineCount(count) {
        const el = document.getElementById('online-count');
        if (el) {
            el.textContent = count + '人在线';
        }
    }

    showRemoteCursor(data) {
        if (!data.user_id) return;
        const container = document.getElementById('canvas-container');
        if (!container) return;

        if (!this.remoteCursors) this.remoteCursors = {};

        let cursor = this.remoteCursors[data.user_id];
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.innerHTML = `
                <div class="remote-cursor-icon"></div>
                <div class="remote-cursor-name">${data.nickname || '访客'}</div>
            `;
            container.appendChild(cursor);
            this.remoteCursors[data.user_id] = cursor;

            setTimeout(() => {
                cursor.remove();
                delete this.remoteCursors[data.user_id];
            }, 10000);
        }

        cursor.style.left = data.x + 'px';
        cursor.style.top = data.y + 'px';
    }

    disconnect() {
        if (this.socket) {
            this.socket.emit('leave_room', {
                room_id: this.roomId,
                nickname: this.nickname
            });
            this.socket.disconnect();
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    if (window.ROOM_ID) {
        window.socketManager = new SocketManager();
        window.socketManager.connect();

        window.addEventListener('beforeunload', () => {
            window.socketManager.disconnect();
        });
    }
});
