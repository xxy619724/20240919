// ========== 白板绘图引擎 ==========

class Whiteboard {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.mainCanvas = document.getElementById('main-canvas');
        this.previewCanvas = document.getElementById('preview-canvas');
        this.mainCtx = this.mainCanvas.getContext('2d');
        this.previewCtx = this.previewCanvas.getContext('2d');

        // 操作记录（用于撤销重做和持久化）
        this.operations = [];       // 所有操作（含远程）
        this.myUndoStack = [];      // 我的撤销栈
        this.myRedoStack = [];      // 我的重做栈

        // 绘图状态
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.currentPath = [];

        // 喷枪状态
        this.sprayTimer = null;
        this.sprayCurrentPos = { x: 0, y: 0 };
        this.sprayDots = [];       // 记录所有喷点 [{x,y}]

        // 书法笔状态
        this.calliLastPos = null;
        this.calliLastWidth = 2;
        this.calliSegments = [];   // [{x1,y1,x2,y2,w}]

        // 选择工具状态
        this.selectedOps = [];      // 当前选中的操作 ID 列表
        this.selectionRect = null;  // 框选区域 {x, y, w, h}
        this.isSelecting = false;   // 正在框选
        this.isDragging = false;    // 正在拖拽选中项
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragOffsets = [];      // 拖拽偏移记录

        // 工具管理
        this.toolManager = new ToolManager();

        // 远程光标
        this.remoteCursors = {};

        this.initCanvas();
        this.bindEvents();
    }

    initCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // 加载快照
        if (window.SNAPSHOT) {
            this.loadSnapshot(window.SNAPSHOT);
        }
    }

    resizeCanvas() {
        const rect = this.container.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        // 保存当前内容
        let imageData = null;
        if (this.mainCanvas.width > 0 && this.mainCanvas.height > 0) {
            try { imageData = this.mainCtx.getImageData(0, 0, this.mainCanvas.width, this.mainCanvas.height); } catch(e) {}
        }

        this.mainCanvas.width = w;
        this.mainCanvas.height = h;
        this.previewCanvas.width = w;
        this.previewCanvas.height = h;

        // 恢复内容
        if (imageData) {
            try { this.mainCtx.putImageData(imageData, 0, 0); } catch(e) {}
        }

        // 如果有操作记录，重新绘制（更可靠）
        if (this.operations.length > 0) {
            this.redrawAll();
        }
    }

    bindEvents() {
        // 让 preview canvas 接收鼠标事件
        this.previewCanvas.style.pointerEvents = 'auto';

        this.previewCanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.previewCanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.previewCanvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.previewCanvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));

        // 触摸支持
        this.previewCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.onMouseDown(this.touchToMouse(touch));
        });
        this.previewCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.onMouseMove(this.touchToMouse(touch));
        });
        this.previewCanvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.onMouseUp({});
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
                e.preventDefault();
                this.batchUndo();
            } else if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                this.redo();
            }
            // Delete 键删除选中项
            if (e.key === 'Delete' && this.selectedOps.length > 0) {
                e.preventDefault();
                this.batchDelete();
            }
            // Escape 取消选择
            if (e.key === 'Escape') {
                this.clearSelection();
            }
        });
    }

    touchToMouse(touch) {
        const rect = this.previewCanvas.getBoundingClientRect();
        return {
            offsetX: touch.clientX - rect.left,
            offsetY: touch.clientY - rect.top
        };
    }

    getMousePos(e) {
        return { x: e.offsetX, y: e.offsetY };
    }

    // ========== 获取操作的包围盒 ==========
    getOpBounds(op) {
        switch (op.type) {
            case 'pen':
            case 'eraser': {
                if (!op.points || op.points.length === 0) return null;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of op.points) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                }
                const pad = (op.width || 2) / 2;
                return { x: minX - pad, y: minY - pad, w: maxX - minX + op.width, h: maxY - minY + op.width };
            }
            case 'line': {
                if (!op.start || !op.end) return null;
                const pad = (op.width || 2) / 2;
                const x1 = Math.min(op.start[0], op.end[0]) - pad;
                const y1 = Math.min(op.start[1], op.end[1]) - pad;
                const x2 = Math.max(op.start[0], op.end[0]) + pad;
                const y2 = Math.max(op.start[1], op.end[1]) + pad;
                return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
            }
            case 'rect': {
                if (!op.start || !op.end) return null;
                const pad = (op.width || 2) / 2;
                const x = Math.min(op.start[0], op.end[0]) - pad;
                const y = Math.min(op.start[1], op.end[1]) - pad;
                return { x, y, w: Math.abs(op.end[0] - op.start[0]) + op.width, h: Math.abs(op.end[1] - op.start[1]) + op.width };
            }
            case 'circle': {
                if (!op.center || !op.radius) return null;
                const r = op.radius + (op.width || 2) / 2;
                return { x: op.center[0] - r, y: op.center[1] - r, w: r * 2, h: r * 2 };
            }
            case 'text': {
                if (!op.position || !op.content) return null;
                const fs = op.fontSize || 16;
                // 粗略估算文本宽度
                const tw = op.content.length * fs * 0.6;
                return { x: op.position[0], y: op.position[1], w: tw, h: fs * 1.4 };
            }
            case 'filled_rect': {
                if (!op.start || !op.end) return null;
                const x = Math.min(op.start[0], op.end[0]);
                const y = Math.min(op.start[1], op.end[1]);
                return { x, y, w: Math.abs(op.end[0]-op.start[0]), h: Math.abs(op.end[1]-op.start[1]) };
            }
            case 'filled_circle': {
                if (!op.center || !op.radius) return null;
                return { x: op.center[0]-op.radius, y: op.center[1]-op.radius, w: op.radius*2, h: op.radius*2 };
            }
            case 'filled_triangle': {
                if (!op.points || op.points.length < 3) return null;
                const xs = op.points.map(p=>p[0]), ys = op.points.map(p=>p[1]);
                const bx = Math.min(...xs), by = Math.min(...ys);
                return { x: bx, y: by, w: Math.max(...xs)-bx, h: Math.max(...ys)-by };
            }
            case 'spray': {
                if (!op.dots || op.dots.length === 0) return null;
                const r = op.radius || 20;
                let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                for (const d of op.dots) {
                    minX=Math.min(minX,d.x); minY=Math.min(minY,d.y);
                    maxX=Math.max(maxX,d.x); maxY=Math.max(maxY,d.y);
                }
                return { x: minX-r, y: minY-r, w: maxX-minX+r*2, h: maxY-minY+r*2 };
            }
            case 'calligraphy': {
                if (!op.segments || op.segments.length === 0) return null;
                let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                for (const s of op.segments) {
                    minX=Math.min(minX,s.x1,s.x2); minY=Math.min(minY,s.y1,s.y2);
                    maxX=Math.max(maxX,s.x1,s.x2); maxY=Math.max(maxY,s.y1,s.y2);
                }
                return { x: minX-10, y: minY-10, w: maxX-minX+20, h: maxY-minY+20 };
            }
        }
        return null;
    }

    // 判断操作是否与矩形区域相交
    isOpInRect(op, rect) {
        const bounds = this.getOpBounds(op);
        if (!bounds) return false;
        // AABB 碰撞检测
        return !(bounds.x + bounds.w < rect.x ||
                 bounds.x > rect.x + rect.w ||
                 bounds.y + bounds.h < rect.y ||
                 bounds.y > rect.y + rect.h);
    }

    // 判断点是否在操作上（用于点击选择）
    isOpAtPoint(op, px, py) {
        const bounds = this.getOpBounds(op);
        if (!bounds) return false;
        const pad = 4; // 点击容差
        return px >= bounds.x - pad && px <= bounds.x + bounds.w + pad &&
               py >= bounds.y - pad && py <= bounds.y + bounds.h + pad;
    }

    // ========== 选择逻辑 ==========
    clearSelection() {
        this.selectedOps = [];
        this.selectionRect = null;
        this.drawSelectionOverlay();
        this.updateBatchBar();
    }

    selectOpsInRect(rect) {
        this.selectedOps = [];
        for (const op of this.operations) {
            if (this.isOpInRect(op, rect)) {
                this.selectedOps.push(op.id);
            }
        }
        this.drawSelectionOverlay();
        this.updateBatchBar();
    }

    selectOpAtPoint(px, py) {
        // 从最上层开始找，优先选择后绘制的
        for (let i = this.operations.length - 1; i >= 0; i--) {
            if (this.isOpAtPoint(this.operations[i], px, py)) {
                const opId = this.operations[i].id;
                if (this.selectedOps.includes(opId)) {
                    // 已选中则取消
                    this.selectedOps = this.selectedOps.filter(id => id !== opId);
                } else {
                    this.selectedOps.push(opId);
                }
                this.drawSelectionOverlay();
                this.updateBatchBar();
                return;
            }
        }
        // 点击空白处取消选择
        this.clearSelection();
    }

    drawSelectionOverlay() {
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        
        if (this.selectedOps.length === 0 && !this.selectionRect) return;

        // 绘制选中项高亮
        for (const op of this.operations) {
            if (!this.selectedOps.includes(op.id)) continue;
            const bounds = this.getOpBounds(op);
            if (!bounds) continue;

            this.previewCtx.save();
            this.previewCtx.strokeStyle = '#4361ee';
            this.previewCtx.lineWidth = 1.5;
            this.previewCtx.setLineDash([5, 3]);
            this.previewCtx.strokeRect(bounds.x - 3, bounds.y - 3, bounds.w + 6, bounds.h + 6);
            this.previewCtx.restore();
        }

        // 绘制选中区域总包围盒
        if (this.selectedOps.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const op of this.operations) {
                if (!this.selectedOps.includes(op.id)) continue;
                const b = this.getOpBounds(op);
                if (!b) continue;
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
            }
            if (minX !== Infinity) {
                this.previewCtx.save();
                this.previewCtx.strokeStyle = '#4361ee';
                this.previewCtx.lineWidth = 2;
                this.previewCtx.setLineDash([8, 4]);
                this.previewCtx.strokeRect(minX - 6, minY - 6, maxX - minX + 12, maxY - minY + 12);

                // 四角控制点
                const corners = [
                    [minX - 6, minY - 6],
                    [maxX + 6, minY - 6],
                    [minX - 6, maxY + 6],
                    [maxX + 6, maxY + 6]
                ];
                this.previewCtx.fillStyle = '#4361ee';
                for (const [cx, cy] of corners) {
                    this.previewCtx.fillRect(cx - 4, cy - 4, 8, 8);
                }
                this.previewCtx.restore();
            }
        }

        // 框选中的虚线矩形
        if (this.selectionRect) {
            this.previewCtx.save();
            this.previewCtx.strokeStyle = '#4361ee';
            this.previewCtx.lineWidth = 1;
            this.previewCtx.setLineDash([4, 4]);
            this.previewCtx.fillStyle = 'rgba(67, 97, 238, 0.08)';
            const sr = this.selectionRect;
            this.previewCtx.fillRect(sr.x, sr.y, sr.w, sr.h);
            this.previewCtx.strokeRect(sr.x, sr.y, sr.w, sr.h);
            this.previewCtx.restore();
        }
    }

    // ========== 批量操作 UI ==========
    updateBatchBar() {
        let bar = document.getElementById('batch-bar');
        if (this.selectedOps.length === 0) {
            if (bar) bar.remove();
            return;
        }

        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'batch-bar';
            bar.className = 'batch-bar';
            document.querySelector('.whiteboard-page').appendChild(bar);
        }

        bar.innerHTML = `
            <span class="batch-info">${this.selectedOps.length} 个对象已选中</span>
            <button class="btn btn-outline btn-sm" onclick="wb.batchDelete()" title="删除选中 (Delete)">
                <span style="color:#e53935">删除</span>
            </button>
            <button class="btn btn-outline btn-sm" onclick="wb.batchMoveStart()" title="移动选中">
                移动
            </button>
            <button class="btn btn-outline btn-sm" onclick="wb.batchChangeColor()" title="批量换色">
                换色
            </button>
            <button class="btn btn-outline btn-sm" onclick="wb.clearSelection()" title="取消选择 (Esc)">
                取消
            </button>
        `;
    }

    // ========== 鼠标事件 ==========
    onMouseDown(e) {
        const pos = this.getMousePos(e);
        const tool = this.toolManager.getTool();

        // 选择工具
        if (tool === 'select') {
            // 检查是否点击在已选中项上（开始拖拽）
            if (this.selectedOps.length > 0) {
                const hitOp = this.operations.find(op => this.selectedOps.includes(op.id) && this.isOpAtPoint(op, pos.x, pos.y));
                if (hitOp) {
                    this.isDragging = true;
                    this.dragStartX = pos.x;
                    this.dragStartY = pos.y;
                    // 记录每个选中操作的初始位置
                    this.dragOffsets = this.operations
                        .filter(op => this.selectedOps.includes(op.id))
                        .map(op => ({ id: op.id, ...this.getOpAnchor(op) }));
                    return;
                }
            }

            // 开始框选
            this.isSelecting = true;
            this.startX = pos.x;
            this.startY = pos.y;
            this.selectionRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
            return;
        }

        this.isDrawing = true;
        this.startX = pos.x;
        this.startY = pos.y;

        if (tool === 'text') {
            this.showTextInput(pos.x, pos.y);
            this.isDrawing = false;
            return;
        }

        if (tool === 'pen' || tool === 'eraser') {
            this.currentPath = [{ x: pos.x, y: pos.y }];
            this.mainCtx.beginPath();
            this.mainCtx.moveTo(pos.x, pos.y);

            if (tool === 'eraser') {
                this.mainCtx.globalCompositeOperation = 'destination-out';
                this.mainCtx.lineWidth = this.toolManager.getWidth() * 3;
            } else {
                this.mainCtx.globalCompositeOperation = 'source-over';
                this.mainCtx.strokeStyle = this.toolManager.getColor();
                this.mainCtx.lineWidth = this.toolManager.getWidth();
            }
            this.mainCtx.lineCap = 'round';
            this.mainCtx.lineJoin = 'round';
        }

        if (tool === 'spray') {
            this.sprayDots = [];
            this.sprayCurrentPos = { x: pos.x, y: pos.y };
            this._startSpray();
        }

        if (tool === 'calligraphy') {
            this.calliLastPos = { x: pos.x, y: pos.y };
            this.calliLastWidth = this.toolManager.getWidth() * 2;
            this.calliSegments = [];
        }
    }

    onMouseMove(e) {
        const pos = this.getMousePos(e);

        // 发送光标位置
        if (window.socketManager && window.socketManager.connected) {
            window.socketManager.sendCursorMove(pos.x, pos.y);
        }

        const tool = this.toolManager.getTool();

        // 选择工具 - 框选
        if (tool === 'select') {
            if (this.isDragging) {
                // 拖拽预览
                const dx = pos.x - this.dragStartX;
                const dy = pos.y - this.dragStartY;
                // 实时预览移动：重绘 + 偏移选中项
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
                // 画原始位置虚影
                this.previewCtx.save();
                this.previewCtx.globalAlpha = 0.3;
                for (const off of this.dragOffsets) {
                    const op = this.operations.find(o => o.id === off.id);
                    if (op) this.replayDraw(op);
                }
                this.previewCtx.restore();
                // 画移动后位置
                this.mainCtx.save();
                this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
                for (const op of this.operations) {
                    if (this.selectedOps.includes(op.id)) {
                        this.replayDraw(this.translateOp(op, dx, dy));
                    } else {
                        this.replayDraw(op);
                    }
                }
                this.mainCtx.restore();
                return;
            }
            
            if (this.isSelecting) {
                const x = Math.min(this.startX, pos.x);
                const y = Math.min(this.startY, pos.y);
                const w = Math.abs(pos.x - this.startX);
                const h = Math.abs(pos.y - this.startY);
                this.selectionRect = { x, y, w, h };
                this.drawSelectionOverlay();
                return;
            }
            return;
        }

        if (!this.isDrawing) return;

        if (tool === 'pen' || tool === 'eraser') {
            this.mainCtx.lineTo(pos.x, pos.y);
            this.mainCtx.stroke();
            this.currentPath.push({ x: pos.x, y: pos.y });
        } else if (['line', 'rect', 'circle', 'filled_rect', 'filled_circle', 'filled_triangle'].includes(tool)) {
            // 预览层绘制
            this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            const color = this.toolManager.getColor();
            const width = this.toolManager.getWidth();
            this.previewCtx.strokeStyle = color;
            this.previewCtx.fillStyle = color;
            this.previewCtx.lineWidth = width;
            this.previewCtx.lineCap = 'round';
            this.previewCtx.lineJoin = 'round';
            this.previewCtx.beginPath();

            if (tool === 'line') {
                this.previewCtx.moveTo(this.startX, this.startY);
                this.previewCtx.lineTo(pos.x, pos.y);
                this.previewCtx.stroke();
            } else if (tool === 'rect') {
                this.previewCtx.rect(this.startX, this.startY, pos.x - this.startX, pos.y - this.startY);
                this.previewCtx.stroke();
            } else if (tool === 'circle') {
                const radius = Math.sqrt(Math.pow(pos.x-this.startX,2)+Math.pow(pos.y-this.startY,2));
                this.previewCtx.arc(this.startX, this.startY, radius, 0, Math.PI*2);
                this.previewCtx.stroke();
            } else if (tool === 'filled_rect') {
                this.previewCtx.fillRect(this.startX, this.startY, pos.x-this.startX, pos.y-this.startY);
            } else if (tool === 'filled_circle') {
                const radius = Math.sqrt(Math.pow(pos.x-this.startX,2)+Math.pow(pos.y-this.startY,2));
                this.previewCtx.arc(this.startX, this.startY, radius, 0, Math.PI*2);
                this.previewCtx.fill();
            } else if (tool === 'filled_triangle') {
                // 以起点为顶点，当前点确定底边
                const [ax, ay] = [this.startX, this.startY];
                const [bx, by] = [pos.x, pos.y];
                const mx = (ax + bx) / 2;
                const half = Math.abs(bx - ax) / 2;
                this.previewCtx.moveTo(ax, ay);
                this.previewCtx.lineTo(bx, by);
                this.previewCtx.lineTo(mx * 2 - bx, by);
                this.previewCtx.closePath();
                this.previewCtx.fill();
            }
        } else if (tool === 'spray') {
            this.sprayCurrentPos = { x: pos.x, y: pos.y };
        } else if (tool === 'calligraphy') {
            this._drawCalliSegment(pos);
        }
    }

    onMouseUp(e) {
        const tool = this.toolManager.getTool();

        // 选择工具
        if (tool === 'select') {
            if (this.isDragging) {
                // 完成拖拽移动
                const pos = this.getMousePos(e);
                const dx = (e.offsetX !== undefined ? e.offsetX : this.dragStartX) - this.dragStartX;
                const dy = (e.offsetY !== undefined ? e.offsetY : this.dragStartY) - this.dragStartY;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                    this.batchMove(dx, dy);
                } else {
                    // 没有实际移动，重绘恢复
                    this.redrawAll();
                }
                this.isDragging = false;
                this.dragOffsets = [];
                this.drawSelectionOverlay();
                return;
            }
            
            if (this.isSelecting) {
                const rect = this.selectionRect;
                this.isSelecting = false;

                if (rect && rect.w > 5 && rect.h > 5) {
                    // 框选
                    this.selectOpsInRect(rect);
                } else {
                    // 点击选择
                    this.selectOpAtPoint(this.startX, this.startY);
                }
                this.selectionRect = null;
                return;
            }
            return;
        }

        if (!this.isDrawing) return;
        this.isDrawing = false;

        const color = this.toolManager.getColor();
        const width = this.toolManager.getWidth();
        let operation = null;

        if (tool === 'pen') {
            this.mainCtx.globalCompositeOperation = 'source-over';
            operation = {
                type: 'pen',
                points: [...this.currentPath],
                color: color,
                width: width
            };
        } else if (tool === 'eraser') {
            this.mainCtx.globalCompositeOperation = 'source-over';
            operation = {
                type: 'eraser',
                points: [...this.currentPath],
                width: width * 3
            };
        } else if (tool === 'spray') {
            this._stopSpray();
            if (this.sprayDots.length > 0) {
                operation = {
                    type: 'spray',
                    dots: [...this.sprayDots],
                    color: color,
                    radius: this.toolManager.getWidth() * 3 + 10,
                    dotSize: Math.max(1, this.toolManager.getWidth() * 0.5)
                };
            }
            this.sprayDots = [];
        } else if (tool === 'calligraphy') {
            if (this.calliSegments.length > 0) {
                operation = {
                    type: 'calligraphy',
                    segments: [...this.calliSegments],
                    color: color
                };
            }
            this.calliLastPos = null;
            this.calliSegments = [];
        } else if (['line', 'rect', 'circle', 'filled_rect', 'filled_circle', 'filled_triangle'].includes(tool)) {
            const pos = e.offsetX !== undefined ? this.getMousePos(e) : { x: this.startX, y: this.startY };
            this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

            // 在主 canvas 上绘制
            this.mainCtx.globalCompositeOperation = 'source-over';
            this.mainCtx.strokeStyle = color;
            this.mainCtx.fillStyle = color;
            this.mainCtx.lineWidth = width;
            this.mainCtx.lineCap = 'round';
            this.mainCtx.lineJoin = 'round';
            this.mainCtx.beginPath();

            if (tool === 'line') {
                this.mainCtx.moveTo(this.startX, this.startY);
                this.mainCtx.lineTo(pos.x, pos.y);
                this.mainCtx.stroke();
                operation = { type: 'line', start: [this.startX, this.startY], end: [pos.x, pos.y], color, width };
            } else if (tool === 'rect') {
                this.mainCtx.rect(this.startX, this.startY, pos.x-this.startX, pos.y-this.startY);
                this.mainCtx.stroke();
                operation = { type: 'rect', start: [this.startX, this.startY], end: [pos.x, pos.y], color, width };
            } else if (tool === 'circle') {
                const radius = Math.sqrt(Math.pow(pos.x-this.startX,2)+Math.pow(pos.y-this.startY,2));
                this.mainCtx.arc(this.startX, this.startY, radius, 0, Math.PI*2);
                this.mainCtx.stroke();
                operation = { type: 'circle', center: [this.startX, this.startY], radius, color, width };
            } else if (tool === 'filled_rect') {
                this.mainCtx.fillRect(this.startX, this.startY, pos.x-this.startX, pos.y-this.startY);
                operation = { type: 'filled_rect', start: [this.startX, this.startY], end: [pos.x, pos.y], color };
            } else if (tool === 'filled_circle') {
                const radius = Math.sqrt(Math.pow(pos.x-this.startX,2)+Math.pow(pos.y-this.startY,2));
                this.mainCtx.arc(this.startX, this.startY, radius, 0, Math.PI*2);
                this.mainCtx.fill();
                operation = { type: 'filled_circle', center: [this.startX, this.startY], radius, color };
            } else if (tool === 'filled_triangle') {
                const [ax, ay] = [this.startX, this.startY];
                const [bx, by] = [pos.x, pos.y];
                const [cx, cy] = [ax*2-bx, by];
                this.mainCtx.moveTo(ax, ay);
                this.mainCtx.lineTo(bx, by);
                this.mainCtx.lineTo(cx, cy);
                this.mainCtx.closePath();
                this.mainCtx.fill();
                operation = { type: 'filled_triangle', points: [[ax,ay],[bx,by],[cx,cy]], color };
            }
        }

        if (operation) {
            operation.id = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            operation.isLocal = true;

            this.operations.push(operation);
            this.myUndoStack.push(operation);
            this.myRedoStack = [];

            // 发送到服务器
            if (window.socketManager) {
                window.socketManager.sendDraw(operation);
            }

            console.log('[WB] 本地绘图完成:', operation.type, 'id:', operation.id);
        }

        this.currentPath = [];
    }

    showTextInput(x, y) {
        const existing = document.querySelector('.text-input-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.className = 'text-input-popup';
        popup.style.left = x + 'px';
        popup.style.top = y + 'px';
        popup.innerHTML = `
            <input type="text" id="text-input" placeholder="输入文本..." autofocus>
            <div class="text-confirm">
                <button class="cancel-btn" onclick="this.closest('.text-input-popup').remove()">取消</button>
                <button class="confirm-btn" id="text-confirm-btn">确认</button>
            </div>
        `;
        this.container.appendChild(popup);

        const input = document.getElementById('text-input');
        const confirmBtn = document.getElementById('text-confirm-btn');

        const confirmText = () => {
            const text = input.value.trim();
            if (text) {
                const color = this.toolManager.getColor();
                const fontSize = Math.max(16, this.toolManager.getWidth() * 6);

                this.mainCtx.font = `${fontSize}px sans-serif`;
                this.mainCtx.fillStyle = color;
                this.mainCtx.fillText(text, x, y + fontSize);

                const operation = {
                    id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    type: 'text',
                    position: [x, y],
                    content: text,
                    color: color,
                    fontSize: fontSize,
                    isLocal: true
                };

                this.operations.push(operation);
                this.myUndoStack.push(operation);
                this.myRedoStack = [];

                if (window.socketManager) {
                    window.socketManager.sendDraw(operation);
                }

                console.log('[WB] 文本绘制完成:', operation.type);
            }
            popup.remove();
        };

        confirmBtn.addEventListener('click', confirmText);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmText();
            if (e.key === 'Escape') popup.remove();
        });
        input.focus();
    }

    // ========== 获取操作锚点（用于移动计算） ==========
    getOpAnchor(op) {
        switch (op.type) {
            case 'pen':
            case 'eraser':
                return { x: op.points[0].x, y: op.points[0].y };
            case 'line':
                return { x: op.start[0], y: op.start[1] };
            case 'rect':
            case 'filled_rect':
                return { x: op.start[0], y: op.start[1] };
            case 'circle':
            case 'filled_circle':
                return { x: op.center[0], y: op.center[1] };
            case 'filled_triangle':
                return { x: op.points[0][0], y: op.points[0][1] };
            case 'text':
                return { x: op.position[0], y: op.position[1] };
            case 'spray':
                return op.dots.length > 0 ? { x: op.dots[0].x, y: op.dots[0].y } : { x: 0, y: 0 };
            case 'calligraphy':
                return op.segments.length > 0 ? { x: op.segments[0].x1, y: op.segments[0].y1 } : { x: 0, y: 0 };
        }
        return { x: 0, y: 0 };
    }

    // ========== 平移操作 ==========
    translateOp(op, dx, dy) {
        const moved = JSON.parse(JSON.stringify(op));
        switch (moved.type) {
            case 'pen':
            case 'eraser':
                moved.points = moved.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                break;
            case 'line':
                moved.start = [moved.start[0] + dx, moved.start[1] + dy];
                moved.end = [moved.end[0] + dx, moved.end[1] + dy];
                break;
            case 'rect':
            case 'filled_rect':
                moved.start = [moved.start[0] + dx, moved.start[1] + dy];
                moved.end = [moved.end[0] + dx, moved.end[1] + dy];
                break;
            case 'circle':
            case 'filled_circle':
                moved.center = [moved.center[0] + dx, moved.center[1] + dy];
                break;
            case 'filled_triangle':
                moved.points = moved.points.map(p => [p[0]+dx, p[1]+dy]);
                break;
            case 'text':
                moved.position = [moved.position[0] + dx, moved.position[1] + dy];
                break;
            case 'spray':
                moved.dots = moved.dots.map(d => ({ x: d.x+dx, y: d.y+dy }));
                break;
            case 'calligraphy':
                moved.segments = moved.segments.map(s => ({ x1:s.x1+dx, y1:s.y1+dy, x2:s.x2+dx, y2:s.y2+dy, w:s.w }));
                break;
        }
        return moved;
    }

    // ========== 批量删除 ==========
    batchDelete() {
        if (this.selectedOps.length === 0) return;

        const deletedOps = this.operations.filter(op => this.selectedOps.includes(op.id));

        // 批量操作记录：记录被删除的操作，以便撤销
        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_delete',
            deletedIds: [...this.selectedOps],
            deletedOps: deletedOps.map(op => JSON.parse(JSON.stringify(op))),
            isLocal: true
        };

        // 从操作列表移除
        this.operations = this.operations.filter(op => !this.selectedOps.includes(op.id));
        this.redrawAll();

        // 记入撤销栈
        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];

        // 同步到其他用户
        if (window.socketManager) {
            window.socketManager.sendBatchDelete(this.selectedOps);
        }

        const count = this.selectedOps.length;
        this.clearSelection();
        showToast(`已删除 ${count} 个对象`);
        console.log('[WB] 批量删除:', count, '个对象');
    }

    // ========== 批量移动 ==========
    batchMove(dx, dy) {
        if (this.selectedOps.length === 0) return;

        const movedOps = [];
        const oldOps = [];

        for (const op of this.operations) {
            if (this.selectedOps.includes(op.id)) {
                oldOps.push(JSON.parse(JSON.stringify(op)));
                const moved = this.translateOp(op, dx, dy);
                // 更新原操作
                Object.assign(op, moved);
                movedOps.push(op);
            }
        }

        // 批量操作记录
        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_move',
            opIds: [...this.selectedOps],
            dx: dx,
            dy: dy,
            oldOps: oldOps,
            isLocal: true
        };

        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];
        this.redrawAll();

        // 同步到其他用户
        if (window.socketManager) {
            window.socketManager.sendBatchMove(this.selectedOps, dx, dy);
        }

        console.log('[WB] 批量移动:', this.selectedOps.length, '个对象, dx:', dx, 'dy:', dy);
    }

    batchMoveStart() {
        // 提示用户拖拽移动
        showToast('请在画布上拖拽移动选中对象');
        // 确保工具切换到选择模式
        this.toolManager.currentTool = 'select';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="select"]').classList.add('active');
    }

    // ========== 批量换色 ==========
    batchChangeColor() {
        if (this.selectedOps.length === 0) return;

        const newColor = this.toolManager.getColor();
        const oldOps = [];

        for (const op of this.operations) {
            if (this.selectedOps.includes(op.id)) {
                oldOps.push({ id: op.id, color: op.color });
                if (op.color !== undefined) {
                    op.color = newColor;
                }
            }
        }

        // 批量操作记录
        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_color',
            opIds: [...this.selectedOps],
            newColor: newColor,
            oldOps: oldOps,
            isLocal: true
        };

        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];
        this.redrawAll();

        // 同步到其他用户
        if (window.socketManager) {
            window.socketManager.sendBatchColor(this.selectedOps, newColor);
        }

        showToast(`已将 ${this.selectedOps.length} 个对象颜色改为 ${colorName(newColor)}`);
        console.log('[WB] 批量换色:', this.selectedOps.length, '个对象, color:', newColor);
    }

    // ========== 批量撤销（撤销最近5步） ==========
    batchUndo() {
        const count = Math.min(5, this.myUndoStack.length);
        if (count === 0) return;

        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_undo',
            undoneOps: [],
            isLocal: true
        };

        for (let i = 0; i < count; i++) {
            const op = this.myUndoStack.pop();
            if (!op) break;

            // 处理普通操作的撤销
            if (op.type !== 'batch_delete' && op.type !== 'batch_move' && op.type !== 'batch_color' && op.type !== 'batch_undo') {
                this.operations = this.operations.filter(o => o.id !== op.id);
            }

            batchOp.undoneOps.push(op);
        }

        if (batchOp.undoneOps.length > 0) {
            this.myRedoStack.push(batchOp);
            this.redrawAll();
            showToast(`批量撤销了 ${batchOp.undoneOps.length} 步操作`);
            console.log('[WB] 批量撤销:', batchOp.undoneOps.length, '步');
        }
    }

    // ========== 喷枪工具 ==========
    _startSpray() {
        this._stopSpray();
        this.sprayTimer = setInterval(() => {
            if (!this.isDrawing) { this._stopSpray(); return; }
            const pos = this.sprayCurrentPos;
            const radius = this.toolManager.getWidth() * 3 + 10;
            const density = Math.floor(radius * 1.5);
            const dotSize = Math.max(1, this.toolManager.getWidth() * 0.5);
            const color = this.toolManager.getColor();

            this.mainCtx.fillStyle = color;
            for (let i = 0; i < density; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * radius;
                const dx = pos.x + Math.cos(angle) * r;
                const dy = pos.y + Math.sin(angle) * r;
                this.mainCtx.beginPath();
                this.mainCtx.arc(dx, dy, dotSize, 0, Math.PI * 2);
                this.mainCtx.fill();
                this.sprayDots.push({ x: dx, y: dy });
            }
        }, 30);
    }

    _stopSpray() {
        if (this.sprayTimer) {
            clearInterval(this.sprayTimer);
            this.sprayTimer = null;
        }
    }

    // ========== 书法笔工具 ==========
    _drawCalliSegment(pos) {
        if (!this.calliLastPos) return;
        const dx = pos.x - this.calliLastPos.x;
        const dy = pos.y - this.calliLastPos.y;
        const speed = Math.sqrt(dx * dx + dy * dy);

        // 速度越快线越细，越慢线越粗（模拟毛笔压感）
        const baseWidth = this.toolManager.getWidth() * 3;
        const targetWidth = Math.max(baseWidth * 0.15, baseWidth - speed * 0.8);
        // 平滑过渡
        this.calliLastWidth = this.calliLastWidth * 0.6 + targetWidth * 0.4;

        const color = this.toolManager.getColor();
        const ctx = this.mainCtx;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 用梯形模拟粗细变化
        const w1 = this.calliLastWidth;
        const w2 = this.calliLastWidth; // 下一段用当前宽度
        const [x1, y1] = [this.calliLastPos.x, this.calliLastPos.y];
        const [x2, y2] = [pos.x, pos.y];

        // 计算垂直方向偏移
        const len = Math.max(1, Math.sqrt(dx*dx + dy*dy));
        const nx = -dy / len;
        const ny = dx / len;

        ctx.beginPath();
        ctx.moveTo(x1 + nx * w1/2, y1 + ny * w1/2);
        ctx.lineTo(x2 + nx * w2/2, y2 + ny * w2/2);
        ctx.lineTo(x2 - nx * w2/2, y2 - ny * w2/2);
        ctx.lineTo(x1 - nx * w1/2, y1 - ny * w1/2);
        ctx.closePath();
        ctx.fill();

        this.calliSegments.push({ x1, y1, x2, y2, w: this.calliLastWidth });
        this.calliLastPos = { x: pos.x, y: pos.y };
    }

    // ========== 重放远程操作 ==========
    replayDraw(operation) {
        const ctx = this.mainCtx;

        if (operation.type === 'pen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = operation.color;
            ctx.lineWidth = operation.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (operation.points && operation.points.length > 0) {
                ctx.moveTo(operation.points[0].x, operation.points[0].y);
                for (let i = 1; i < operation.points.length; i++) {
                    ctx.lineTo(operation.points[i].x, operation.points[i].y);
                }
                ctx.stroke();
            }
        } else if (operation.type === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = operation.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (operation.points && operation.points.length > 0) {
                ctx.moveTo(operation.points[0].x, operation.points[0].y);
                for (let i = 1; i < operation.points.length; i++) {
                    ctx.lineTo(operation.points[i].x, operation.points[i].y);
                }
                ctx.stroke();
            }
            ctx.globalCompositeOperation = 'source-over';
        } else if (operation.type === 'line') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = operation.color;
            ctx.lineWidth = operation.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(operation.start[0], operation.start[1]);
            ctx.lineTo(operation.end[0], operation.end[1]);
            ctx.stroke();
        } else if (operation.type === 'rect') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = operation.color;
            ctx.lineWidth = operation.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.rect(operation.start[0], operation.start[1],
                     operation.end[0] - operation.start[0],
                     operation.end[1] - operation.start[1]);
            ctx.stroke();
        } else if (operation.type === 'circle') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = operation.color;
            ctx.lineWidth = operation.width;
            ctx.beginPath();
            ctx.arc(operation.center[0], operation.center[1], operation.radius, 0, Math.PI * 2);
            ctx.stroke();
        } else if (operation.type === 'text') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.font = `${operation.fontSize}px sans-serif`;
            ctx.fillStyle = operation.color;
            ctx.fillText(operation.content, operation.position[0], operation.position[1] + operation.fontSize);
        } else if (operation.type === 'filled_rect') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = operation.color;
            ctx.fillRect(operation.start[0], operation.start[1],
                operation.end[0] - operation.start[0],
                operation.end[1] - operation.start[1]);
        } else if (operation.type === 'filled_circle') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = operation.color;
            ctx.beginPath();
            ctx.arc(operation.center[0], operation.center[1], operation.radius, 0, Math.PI * 2);
            ctx.fill();
        } else if (operation.type === 'filled_triangle') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = operation.color;
            const pts = operation.points;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.lineTo(pts[2][0], pts[2][1]);
            ctx.closePath();
            ctx.fill();
        } else if (operation.type === 'spray') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = operation.color;
            const dotSize = operation.dotSize || 1;
            for (const d of operation.dots) {
                ctx.beginPath();
                ctx.arc(d.x, d.y, dotSize, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (operation.type === 'calligraphy') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = operation.color;
            for (const s of operation.segments) {
                const dx = s.x2 - s.x1;
                const dy = s.y2 - s.y1;
                const len = Math.max(1, Math.sqrt(dx*dx + dy*dy));
                const nx = -dy / len;
                const ny = dx / len;
                const w = s.w;
                ctx.beginPath();
                ctx.moveTo(s.x1 + nx*w/2, s.y1 + ny*w/2);
                ctx.lineTo(s.x2 + nx*w/2, s.y2 + ny*w/2);
                ctx.lineTo(s.x2 - nx*w/2, s.y2 - ny*w/2);
                ctx.lineTo(s.x1 - nx*w/2, s.y1 - ny*w/2);
                ctx.closePath();
                ctx.fill();
            }
        }

        console.log('[WB] 重放远程操作:', operation.type, 'id:', operation.id);
    }

    // 重绘所有操作
    redrawAll() {
        this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        for (const op of this.operations) {
            this.replayDraw(op);
        }
        // 重新绘制选中高亮
        if (this.selectedOps.length > 0) {
            this.drawSelectionOverlay();
        }
    }

    // ========== 撤销重做 ==========
    undo() {
        if (this.myUndoStack.length === 0) return;
        const op = this.myUndoStack.pop();
        
        // 处理批量操作类型的撤销
        if (op.type === 'batch_delete') {
            // 撤销批量删除 = 恢复被删除的操作
            for (const deletedOp of op.deletedOps) {
                this.operations.push(deletedOp);
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销批量删除, 恢复', op.deletedOps.length, '个操作');
            return;
        }
        
        if (op.type === 'batch_move') {
            // 撤销批量移动 = 反向移动
            for (const oldOp of op.oldOps) {
                const current = this.operations.find(o => o.id === oldOp.id);
                if (current) Object.assign(current, oldOp);
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销批量移动');
            return;
        }
        
        if (op.type === 'batch_color') {
            // 撤销批量换色 = 恢复原来的颜色
            for (const oldInfo of op.oldOps) {
                const current = this.operations.find(o => o.id === oldInfo.id);
                if (current) current.color = oldInfo.color;
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销批量换色');
            return;
        }
        
        if (op.type === 'batch_undo') {
            // 撤销"批量撤销" = 重做那些操作
            for (const undoneOp of op.undoneOps) {
                this.myUndoStack.push(undoneOp);
                this.operations.push(undoneOp);
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销批量撤销');
            return;
        }

        // 普通操作撤销
        this.myRedoStack.push(op);
        this.operations = this.operations.filter(o => o.id !== op.id);
        this.redrawAll();

        if (window.socketManager) {
            window.socketManager.sendUndo(op.id, op);
        }
        console.log('[WB] 撤销:', op.type);
    }

    redo() {
        if (this.myRedoStack.length === 0) return;
        const op = this.myRedoStack.pop();
        this.myUndoStack.push(op);

        if (op.type === 'batch_undo') {
            // 重做"批量撤销" = 再次撤销那些操作
            for (const undoneOp of op.undoneOps) {
                this.operations = this.operations.filter(o => o.id !== undoneOp.id);
            }
            this.redrawAll();
        } else {
            this.operations.push(op);
            this.replayDraw(op);
        }

        if (window.socketManager) {
            window.socketManager.sendRedo(op.id, op);
        }
        console.log('[WB] 重做:', op.type);
    }

    // 远程撤销
    remoteUndo(operationId) {
        this.operations = this.operations.filter(o => o.id !== operationId);
        this.redrawAll();
        console.log('[WB] 远程撤销:', operationId);
    }

    // 远程重做
    remoteRedo(operation) {
        this.operations.push(operation);
        this.replayDraw(operation);
        console.log('[WB] 远程重做:', operation.type);
    }

    // 远程批量删除
    remoteBatchDelete(opIds) {
        this.operations = this.operations.filter(o => !opIds.includes(o.id));
        this.redrawAll();
        this.clearSelection();
        console.log('[WB] 远程批量删除:', opIds.length, '个操作');
    }

    // 远程批量移动
    remoteBatchMove(opIds, dx, dy) {
        for (const op of this.operations) {
            if (opIds.includes(op.id)) {
                const moved = this.translateOp(op, dx, dy);
                Object.assign(op, moved);
            }
        }
        this.redrawAll();
        console.log('[WB] 远程批量移动:', opIds.length, '个操作');
    }

    // 远程批量换色
    remoteBatchColor(opIds, newColor) {
        for (const op of this.operations) {
            if (opIds.includes(op.id) && op.color !== undefined) {
                op.color = newColor;
            }
        }
        this.redrawAll();
        console.log('[WB] 远程批量换色:', opIds.length, '个操作');
    }

    // 加载快照
    loadSnapshot(snapshot) {
        if (snapshot && snapshot.objects) {
            this.operations = snapshot.objects;
            this.redrawAll();
            console.log('[WB] 加载快照, 操作数:', this.operations.length);
        }
    }

    // 获取快照数据
    getSnapshot() {
        return {
            version: 1,
            objects: this.operations.map(op => {
                const clean = {...op};
                delete clean.isLocal;
                return clean;
            }),
            timestamp: Date.now()
        };
    }
}

// 颜色名称映射
const COLOR_NAMES = {
    '#000000': '黑色', '#FF0000': '红色', '#0000FF': '蓝色',
    '#00AA00': '绿色', '#FF6600': '橙色', '#9900CC': '紫色',
    '#FFCC00': '黄色', '#FFFFFF': '白色', '#FF0000': '红色',
    '#00FF00': '亮绿', '#00FFFF': '青色', '#FF00FF': '品红',
    '#808080': '灰色', '#800000': '暗红', '#008000': '深绿',
    '#000080': '深蓝', '#808000': '橄榄', '#800080': '暗紫',
    '#C0C0C0': '银色', '#FF69B4': '粉色', '#A52A2A': '棕色',
    '#FFD700': '金色', '#4169E1': '宝蓝', '#2E8B57': '海绿',
};

function colorName(hex) {
    if (!hex) return '未知颜色';
    const key = hex.toUpperCase();
    const name = COLOR_NAMES[key];
    const swatch = `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${hex};vertical-align:middle;margin:0 4px;border:1px solid #aaa"></span>`;
    if (name) return swatch + name;
    // 未映射的颜色直接显示色块+十六进制
    return swatch + hex;
}

// 全局撤销/重做函数（供按钮调用）
function undo() {
    if (window.wb) window.wb.undo();
}

function redo() {
    if (window.wb) window.wb.redo();
}

// 保存快照
async function saveSnapshot() {
    if (!window.IS_LOGGED_IN) {
        showToast('请先登录');
        return;
    }
    if (!window.wb) return;

    const snapshot = window.wb.getSnapshot();
    try {
        const res = await fetch(`/api/rooms/${window.ROOM_ID}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot })
        });
        const data = await res.json();
        if (data.code === 'SUCCESS') {
            showToast('保存成功');
        } else {
            showToast(data.message);
        }
    } catch (e) {
        showToast('保存失败');
    }
}

// 初始化白板
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('main-canvas')) {
        window.wb = new Whiteboard();
        console.log('[WB] 白板初始化完成');
    }
});
