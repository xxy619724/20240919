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

        // 形状工具状态
        this.currentShape = null;  // 当前选中的形状名称

        // 形状工具内的选中+拖拽状态
        this.selectedShapeId = null;   // 形状工具内选中的操作 ID
        this.isShapeDragging = false;  // 正在拖拽选中的形状
        this.shapeDragStartX = 0;
        this.shapeDragStartY = 0;
        this.shapeDragOrigOp = null;   // 拖拽前的操作原始数据

        // 画笔工具状态
        this.currentBrush = 'inkbrush';  // 当前选中的画笔类型

        // 缩放状态
        this.zoomScale = 1;
        this.zoomOrigin = { x: 0, y: 0 };

        // 选择工具状态
        this.selectedOps = [];      // 当前选中的操作 ID 列表
        this.selectionRect = null;  // 框选区域 {x, y, w, h}
        this.isSelecting = false;   // 正在框选
        this.isDragging = false;    // 正在拖拽选中项
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragOffsets = [];      // 拖拽偏移记录

        // 右键菜单 + 变换状态
        this.clipboard = [];        // 剪贴板（复制的操作）
        this.isRotating = false;    // 正在旋转自定义
        this.rotateStartAngle = 0;  // 旋转起始角度
        this.rotateCenterX = 0;     // 旋转中心 X
        this.rotateCenterY = 0;     // 旋转中心 Y
        this.rotateOrigOps = [];    // 旋转前的操作原始数据

        // 缩放/拉伸控制点状态
        this.isResizing = false;    // 正在拖拽控制点缩放/拉伸
        this.resizeHandle = null;   // 当前拖拽的控制点: 'tl','tc','tr','ml','mr','bl','bc','br'
        this.resizeStartBounds = null; // 拖拽开始时的总包围盒
        this.resizeOrigOps = [];    // 拖拽前的操作原始数据
        this.resizeStartX = 0;      // 拖拽起始鼠标位置
        this.resizeStartY = 0;

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

        // 缩放工具右键缩小 / 选择工具右键菜单
        this.previewCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const tool = this.toolManager.getTool();
            if (tool === 'zoom') {
                const pos = this.getMousePos(e);
                this.zoomOut(pos.x, pos.y);
            } else if (tool === 'select') {
                const pos = this.getMousePos(e);
                // 如果没有选中项，先尝试选中点击位置的图形
                if (this.selectedOps.length === 0) {
                    for (let i = this.operations.length - 1; i >= 0; i--) {
                        if (this.isOpAtPoint(this.operations[i], pos.x, pos.y)) {
                            this.selectedOps = [this.operations[i].id];
                            this.drawSelectionOverlay();
                            this.updateBatchBar();
                            break;
                        }
                    }
                }
                if (this.selectedOps.length > 0) {
                    this._showContextMenu(e.clientX, e.clientY);
                }
            } else if (this.selectedOps.length > 0) {
                this._showContextMenu(e.clientX, e.clientY);
            }
        });

        // 滚轮缩放（任何工具下 Ctrl+滚轮）
        this.previewCanvas.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const pos = this.getMousePos(e);
                if (e.deltaY < 0) {
                    this.zoomIn(pos.x, pos.y);
                } else {
                    this.zoomOut(pos.x, pos.y);
                }
            }
        }, { passive: false });

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
                this.clearShapeSelection();
                this._hideContextMenu();
            }
            // Ctrl+C 复制
            if (e.ctrlKey && e.key === 'c' && this.selectedOps.length > 0) {
                e.preventDefault();
                this.copySelected();
            }
            // Ctrl+V 粘贴
            if (e.ctrlKey && e.key === 'v' && this.clipboard.length > 0) {
                e.preventDefault();
                this.pasteClipboard();
            }
        });
    }

    touchToMouse(touch) {
        const rect = this.previewCanvas.getBoundingClientRect();
        return {
            clientX: touch.clientX,
            clientY: touch.clientY,
            offsetX: touch.clientX - rect.left,
            offsetY: touch.clientY - rect.top
        };
    }

    getMousePos(e) {
        // 使用 clientX/clientY + getBoundingClientRect 计算坐标
        // 这样不受 CSS transform 对 offsetX/offsetY 的影响
        let clientX, clientY;
        if (e.clientX !== undefined) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (e.offsetX !== undefined) {
            // touchToMouse 返回的对象只有 offsetX
            // 此时直接使用 offsetX/offsetY（触摸事件没有 CSS transform 问题）
            return { x: e.offsetX, y: e.offsetY };
        } else {
            return { x: 0, y: 0 };
        }

        const rect = this.previewCanvas.getBoundingClientRect();
        // rect 是 CSS transform 后的实际尺寸
        // canvas 逻辑尺寸是 this.mainCanvas.width/height
        const canvasW = this.mainCanvas.width;
        const canvasH = this.mainCanvas.height;
        const x = (clientX - rect.left) / rect.width * canvasW;
        const y = (clientY - rect.top) / rect.height * canvasH;
        return { x, y };
    }

    // ========== 形状路径绘制引擎 ==========
    drawShapePath(ctx, shapeName, x1, y1, x2, y2) {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const w = maxX - minX, h = maxY - minY;

        ctx.beginPath();

        switch (shapeName) {
            case 'line':
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                break;

            case 'rect':
                ctx.rect(minX, minY, w, h);
                break;

            case 'curve':
                ctx.moveTo(minX, maxY);
                ctx.bezierCurveTo(minX, minY, maxX, maxY, maxX, minY);
                break;

            case 'ellipse':
                ctx.ellipse(cx, cy, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
                break;

            case 'triangle':
                ctx.moveTo(cx, minY);
                ctx.lineTo(maxX, maxY);
                ctx.lineTo(minX, maxY);
                ctx.closePath();
                break;

            case 'trapezoid': {
                const inset = w * 0.2;
                ctx.moveTo(minX + inset, minY);
                ctx.lineTo(maxX - inset, minY);
                ctx.lineTo(maxX, maxY);
                ctx.lineTo(minX, maxY);
                ctx.closePath();
                break;
            }

            case 'diamond':
                ctx.moveTo(cx, minY);
                ctx.lineTo(maxX, cy);
                ctx.lineTo(cx, maxY);
                ctx.lineTo(minX, cy);
                ctx.closePath();
                break;

            case 'pentagon':
                this._drawRegularPolygon(ctx, cx, cy, Math.min(w, h) / 2, 5, -Math.PI / 2);
                break;

            case 'hexagon':
                this._drawRegularPolygon(ctx, cx, cy, Math.min(w, h) / 2, 6, 0);
                break;

            case 'arrow_right': {
                const aw = w * 0.35, bh = h * 0.3;
                ctx.moveTo(minX, cy - bh / 2);
                ctx.lineTo(maxX - aw, cy - bh / 2);
                ctx.lineTo(maxX - aw, minY);
                ctx.lineTo(maxX, cy);
                ctx.lineTo(maxX - aw, maxY);
                ctx.lineTo(maxX - aw, cy + bh / 2);
                ctx.lineTo(minX, cy + bh / 2);
                ctx.closePath();
                break;
            }

            case 'arrow_left': {
                const aw2 = w * 0.35, bh2 = h * 0.3;
                ctx.moveTo(maxX, cy - bh2 / 2);
                ctx.lineTo(minX + aw2, cy - bh2 / 2);
                ctx.lineTo(minX + aw2, minY);
                ctx.lineTo(minX, cy);
                ctx.lineTo(minX + aw2, maxY);
                ctx.lineTo(minX + aw2, cy + bh2 / 2);
                ctx.lineTo(maxX, cy + bh2 / 2);
                ctx.closePath();
                break;
            }

            case 'arrow_up': {
                const aw3 = w * 0.3, bh3 = h * 0.35;
                ctx.moveTo(cx - aw3 / 2, maxY);
                ctx.lineTo(cx - aw3 / 2, minY + bh3);
                ctx.lineTo(minX, minY + bh3);
                ctx.lineTo(cx, minY);
                ctx.lineTo(maxX, minY + bh3);
                ctx.lineTo(cx + aw3 / 2, minY + bh3);
                ctx.lineTo(cx + aw3 / 2, maxY);
                ctx.closePath();
                break;
            }

            case 'arrow_down': {
                const aw4 = w * 0.3, bh4 = h * 0.35;
                ctx.moveTo(cx - aw4 / 2, minY);
                ctx.lineTo(cx - aw4 / 2, maxY - bh4);
                ctx.lineTo(minX, maxY - bh4);
                ctx.lineTo(cx, maxY);
                ctx.lineTo(maxX, maxY - bh4);
                ctx.lineTo(cx + aw4 / 2, maxY - bh4);
                ctx.lineTo(cx + aw4 / 2, minY);
                ctx.closePath();
                break;
            }

            case 'star_5':
                this._drawStar(ctx, cx, cy, Math.min(w, h) / 2, 5, 0.4);
                break;

            case 'star_5_slim':
                this._drawStar(ctx, cx, cy, Math.min(w, h) / 2, 5, 0.25);
                break;

            case 'star_5_bold':
                this._drawStar(ctx, cx, cy, Math.min(w, h) / 2, 5, 0.55);
                break;

            case 'heart':
                this._drawHeart(ctx, cx, cy, w, h);
                break;

            default:
                // 未知形状，回退为矩形
                ctx.rect(minX, minY, w, h);
                break;
        }
    }

    // 正多边形辅助
    _drawRegularPolygon(ctx, cx, cy, radius, sides, startAngle) {
        radius = Math.max(1, radius);
        for (let i = 0; i < sides; i++) {
            const angle = startAngle + (2 * Math.PI * i) / sides;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    }

    // 五角星辅助
    _drawStar(ctx, cx, cy, radius, points, innerRatio) {
        radius = Math.max(1, radius);
        const innerRadius = radius * innerRatio;
        for (let i = 0; i < points * 2; i++) {
            const angle = -Math.PI / 2 + (Math.PI * i) / points;
            const r = i % 2 === 0 ? radius : innerRadius;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    }

    // 心形辅助
    _drawHeart(ctx, cx, cy, w, h) {
        const topY = cy - h * 0.35;
        const bottomY = cy + h * 0.5;
        ctx.moveTo(cx, bottomY);
        // 左半心
        ctx.bezierCurveTo(
            cx - w * 0.02, cy + h * 0.1,
            cx - w * 0.5, cy + h * 0.05,
            cx - w * 0.5, topY
        );
        ctx.bezierCurveTo(
            cx - w * 0.5, cy - h * 0.5,
            cx - w * 0.05, cy - h * 0.5,
            cx, topY + h * 0.05
        );
        // 右半心
        ctx.bezierCurveTo(
            cx + w * 0.05, cy - h * 0.5,
            cx + w * 0.5, cy - h * 0.5,
            cx + w * 0.5, topY
        );
        ctx.bezierCurveTo(
            cx + w * 0.5, cy + h * 0.05,
            cx + w * 0.02, cy + h * 0.1,
            cx, bottomY
        );
        ctx.closePath();
    }

    // ========== 获取操作的包围盒 ==========
    getOpBounds(op) {
        // 获取原始包围盒
        const raw = this._getRawBounds(op);
        if (!raw) return null;

        // 如果没有变换属性，直接返回原始包围盒
        const hasRotation = op.rotation != null && op.rotation !== 0;
        const hasFlip = op.flipH || op.flipV;
        if (!hasRotation && !hasFlip) return raw;

        // 有变换属性：对包围盒四个角点做变换后取新的外接矩形
        const [ox, oy] = op.transformOrigin || [raw.x + raw.w / 2, raw.y + raw.h / 2];
        const corners = [
            [raw.x, raw.y],
            [raw.x + raw.w, raw.y],
            [raw.x, raw.y + raw.h],
            [raw.x + raw.w, raw.y + raw.h]
        ];

        const cos = hasRotation ? Math.cos(op.rotation) : 1;
        const sin = hasRotation ? Math.sin(op.rotation) : 0;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [px, py] of corners) {
            let x = px, y = py;
            // 翻转
            if (op.flipH) x = 2 * ox - x;
            if (op.flipV) y = 2 * oy - y;
            // 旋转
            if (hasRotation) {
                const dx = x - ox, dy = y - oy;
                x = ox + dx * cos - dy * sin;
                y = oy + dx * sin + dy * cos;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // 获取操作的包围盒中心（不考虑 rotation/flip 变换）
    _getOpCenter(op) {
        const b = this._getRawBounds(op);
        if (!b) return [0, 0];
        return [b.x + b.w / 2, b.y + b.h / 2];
    }

    // 获取操作的原始包围盒（不考虑 rotation/flip 变换）
    _getRawBounds(op) {
        switch (op.type) {
            case 'pen':
            case 'eraser': {
                if (!op.points || op.points.length === 0) return null;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of op.points) {
                    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
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
            case 'shape': {
                if (!op.start || !op.end) return null;
                const pad = (op.width || 2) / 2;
                const x = Math.min(op.start[0], op.end[0]) - pad;
                const y = Math.min(op.start[1], op.end[1]) - pad;
                return { x, y, w: Math.abs(op.end[0] - op.start[0]) + op.width, h: Math.abs(op.end[1] - op.start[1]) + op.width };
            }
            case 'brush': {
                // brush 可能有 points/dots/segments
                let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                const pad = (op.width || 2) / 2;
                if (op.points && op.points.length > 0) {
                    for (const p of op.points) {
                        minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
                        maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
                    }
                    return { x: minX-pad, y: minY-pad, w: maxX-minX+op.width, h: maxY-minY+op.width };
                }
                if (op.dots && op.dots.length > 0) {
                    for (const d of op.dots) {
                        minX=Math.min(minX,d.x); minY=Math.min(minY,d.y);
                        maxX=Math.max(maxX,d.x); maxY=Math.max(maxY,d.y);
                    }
                    const r = op.radius || 20;
                    return { x: minX-r, y: minY-r, w: maxX-minX+r*2, h: maxY-minY+r*2 };
                }
                if (op.segments && op.segments.length > 0) {
                    for (const s of op.segments) {
                        minX=Math.min(minX,s.x1,s.x2); minY=Math.min(minY,s.y1,s.y2);
                        maxX=Math.max(maxX,s.x1,s.x2); maxY=Math.max(maxY,s.y1,s.y2);
                        // 考虑线宽偏移
                        const maxW = Math.max(s.w1 || s.w || 0, s.w2 || s.w || 0);
                        minX = Math.min(minX, s.x1 - maxW/2, s.x2 - maxW/2);
                        minY = Math.min(minY, s.y1 - maxW/2, s.y2 - maxW/2);
                        maxX = Math.max(maxX, s.x1 + maxW/2, s.x2 + maxW/2);
                        maxY = Math.max(maxY, s.y1 + maxW/2, s.y2 + maxW/2);
                    }
                    const segPad = Math.max(4, (op.width || 2) / 2);
                    return { x: minX-segPad, y: minY-segPad, w: maxX-minX+segPad*2, h: maxY-minY+segPad*2 };
                }
                return null;
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

    // 判断点是否点击在旋转手柄上
    _hitRotateHandle(px, py) {
        if (this.selectedOps.length === 0) return null;
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
        if (minX === Infinity) return null;
        const pad = 6;
        const handleCX = (minX + maxX) / 2;
        const handleCY = minY - pad - 30;
        // 检测点击在旋转圆内（半径12px的容差区）
        const dist = Math.sqrt((px - handleCX) ** 2 + (py - handleCY) ** 2);
        if (dist <= 12) {
            return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
        }
        return null;
    }

    // ========== 选择逻辑 ==========
    clearSelection() {
        this.selectedOps = [];
        this.selectionRect = null;
        this.isResizing = false;
        this.resizeHandle = null;
        this.resizeStartBounds = null;
        this.resizeOrigOps = [];
        this.container.style.cursor = '';
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

        // 绘制选中区域总包围盒 + 控制点 + 旋转手柄
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
                const pad = 6;
                const bx = minX - pad, by = minY - pad;
                const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;

                this.previewCtx.save();
                this.previewCtx.strokeStyle = '#4361ee';
                this.previewCtx.lineWidth = 2;
                this.previewCtx.setLineDash([8, 4]);
                this.previewCtx.strokeRect(bx, by, bw, bh);

                // 8个控制点: 四角 + 四边中点
                const handles = this._getResizeHandles(bx, by, bw, bh);
                this.previewCtx.fillStyle = '#fff';
                this.previewCtx.strokeStyle = '#4361ee';
                this.previewCtx.lineWidth = 2;
                this.previewCtx.setLineDash([]);
                for (const key in handles) {
                    const h = handles[key];
                    this.previewCtx.beginPath();
                    this.previewCtx.arc(h.x, h.y, 5, 0, Math.PI * 2);
                    this.previewCtx.fill();
                    this.previewCtx.stroke();
                }

                // 旋转手柄：顶部中心上方
                const handleCX = (minX + maxX) / 2;
                const handleTopY = minY - pad;
                // 连接线
                this.previewCtx.strokeStyle = '#4361ee';
                this.previewCtx.lineWidth = 1.5;
                this.previewCtx.setLineDash([3, 3]);
                this.previewCtx.beginPath();
                this.previewCtx.moveTo(handleCX, handleTopY);
                this.previewCtx.lineTo(handleCX, handleTopY - 24);
                this.previewCtx.stroke();
                this.previewCtx.setLineDash([]);
                // 旋转圆
                this.previewCtx.beginPath();
                this.previewCtx.arc(handleCX, handleTopY - 30, 7, 0, Math.PI * 2);
                this.previewCtx.strokeStyle = '#4361ee';
                this.previewCtx.lineWidth = 2;
                this.previewCtx.stroke();
                this.previewCtx.fillStyle = '#fff';
                this.previewCtx.fill();
                // 旋转箭头
                this.previewCtx.beginPath();
                this.previewCtx.arc(handleCX, handleTopY - 30, 4, -Math.PI * 0.8, Math.PI * 0.4);
                this.previewCtx.strokeStyle = '#4361ee';
                this.previewCtx.lineWidth = 1.5;
                this.previewCtx.stroke();

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

    // 获取8个控制点的坐标
    _getResizeHandles(bx, by, bw, bh) {
        return {
            tl: { x: bx,        y: by },          // 左上
            tc: { x: bx + bw/2, y: by },          // 上中
            tr: { x: bx + bw,   y: by },          // 右上
            ml: { x: bx,        y: by + bh/2 },   // 左中
            mr: { x: bx + bw,   y: by + bh/2 },   // 右中
            bl: { x: bx,        y: by + bh },      // 左下
            bc: { x: bx + bw/2, y: by + bh },      // 下中
            br: { x: bx + bw,   y: by + bh }       // 右下
        };
    }

    // 检测鼠标是否在控制点上，返回控制点名称或null
    _hitResizeHandle(px, py) {
        if (this.selectedOps.length === 0) return null;
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
        if (minX === Infinity) return null;
        const pad = 6;
        const bx = minX - pad, by = minY - pad;
        const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
        const handles = this._getResizeHandles(bx, by, bw, bh);
        const hitRadius = 8; // 命中半径
        for (const key in handles) {
            const h = handles[key];
            const dist = Math.sqrt((px - h.x) ** 2 + (py - h.y) ** 2);
            if (dist <= hitRadius) return key;
        }
        return null;
    }

    // 控制点对应的光标样式
    _getResizeCursor(handle) {
        const cursorMap = {
            tl: 'nwse-resize',
            tr: 'nesw-resize',
            bl: 'nesw-resize',
            br: 'nwse-resize',
            tc: 'ns-resize',
            bc: 'ns-resize',
            ml: 'ew-resize',
            mr: 'ew-resize'
        };
        return cursorMap[handle] || 'default';
    }

    // 计算控制点拖拽后的新包围盒
    _calcResizedBounds(handle, startBounds, dx, dy) {
        const { minX, minY, maxX, maxY } = startBounds;
        let newMinX = minX, newMinY = minY, newMaxX = maxX, newMaxY = maxY;

        // 四角控制点：等比例缩放
        if (handle === 'tl') {
            newMinX = minX + dx;
            newMinY = minY + dy;
            // 保持等比例：以对角点为锚点
            const origW = maxX - minX;
            const origH = maxY - minY;
            if (origW > 0 && origH > 0) {
                const ratio = origH / origW;
                const newW = maxX - newMinX;
                if (newW > 5) {
                    newMinY = maxY - newW * ratio;
                }
            }
        } else if (handle === 'tr') {
            newMaxX = maxX + dx;
            newMinY = minY + dy;
            const origW = maxX - minX;
            const origH = maxY - minY;
            if (origW > 0 && origH > 0) {
                const ratio = origH / origW;
                const newW = newMaxX - minX;
                if (newW > 5) {
                    newMinY = maxY - newW * ratio;
                }
            }
        } else if (handle === 'bl') {
            newMinX = minX + dx;
            newMaxY = maxY + dy;
            const origW = maxX - minX;
            const origH = maxY - minY;
            if (origW > 0 && origH > 0) {
                const ratio = origH / origW;
                const newW = maxX - newMinX;
                if (newW > 5) {
                    newMaxY = minY + newW * ratio;
                }
            }
        } else if (handle === 'br') {
            newMaxX = maxX + dx;
            newMaxY = maxY + dy;
            const origW = maxX - minX;
            const origH = maxY - minY;
            if (origW > 0 && origH > 0) {
                const ratio = origH / origW;
                const newW = newMaxX - minX;
                if (newW > 5) {
                    newMaxY = minY + newW * ratio;
                }
            }
        }
        // 侧边控制点：单向拉伸
        else if (handle === 'tc') {
            newMinY = minY + dy;
        } else if (handle === 'bc') {
            newMaxY = maxY + dy;
        } else if (handle === 'ml') {
            newMinX = minX + dx;
        } else if (handle === 'mr') {
            newMaxX = maxX + dx;
        }

        // 防止翻转（宽高不能为负）
        if (newMaxX - newMinX < 5) newMinX = newMaxX - 5;
        if (newMaxY - newMinY < 5) newMinY = newMaxY - 5;

        return { minX: newMinX, minY: newMinY, maxX: newMaxX, maxY: newMaxY };
    }

    // 缩放/拉伸实时预览
    _applyResizePreview(mx, my) {
        // 设置拖拽过程中的光标
        this.container.style.cursor = this._getResizeCursor(this.resizeHandle);

        const dx = mx - this.resizeStartX;
        const dy = my - this.resizeStartY;
        const handle = this.resizeHandle;
        const startBounds = this.resizeStartBounds;

        const newBounds = this._calcResizedBounds(handle, startBounds, dx, dy);

        // 恢复原始操作数据
        for (const origOp of this.resizeOrigOps) {
            const op = this.operations.find(o => o.id === origOp.id);
            if (op) {
                // 清除可能存在的变换属性
                delete op.rotation;
                delete op.flipH;
                delete op.flipV;
                delete op.transformOrigin;
                Object.assign(op, JSON.parse(JSON.stringify(origOp)));
            }
        }

        // 将选中操作从旧包围盒映射到新包围盒
        const oldBounds = startBounds;
        const oldW = oldBounds.maxX - oldBounds.minX;
        const oldH = oldBounds.maxY - oldBounds.minY;
        const newW = newBounds.maxX - newBounds.minX;
        const newH = newBounds.maxY - newBounds.minY;

        for (const origOp of this.resizeOrigOps) {
            const op = this.operations.find(o => o.id === origOp.id);
            if (!op) continue;

            const origBounds = this._getBoundsOfOp(origOp);
            if (!origBounds) continue;

            // 计算操作在旧包围盒中的相对位置
            const relX = (origBounds.x - oldBounds.minX) / (oldW || 1);
            const relY = (origBounds.y - oldBounds.minY) / (oldH || 1);
            const relW = origBounds.w / (oldW || 1);
            const relH = origBounds.h / (oldH || 1);

            // 映射到新包围盒
            const destX = newBounds.minX + relX * newW;
            const destY = newBounds.minY + relY * newH;
            const destW = relW * newW;
            const destH = relH * newH;

            // 根据操作类型应用缩放
            this._scaleOp(op, origOp, origBounds, destX, destY, destW, destH);
        }

        this.redrawAll();
        this.drawSelectionOverlay();
    }

    // 获取单个操作的包围盒（不依赖 this.getOpBounds 避免实时变化问题）
    _getBoundsOfOp(op) {
        // 复用 getOpBounds
        return this.getOpBounds(op);
    }

    // 缩放单个操作到目标位置和尺寸
    _scaleOp(op, origOp, origBounds, destX, destY, destW, destH) {
        const sx = destW / (origBounds.w || 1);
        const sy = destH / (origBounds.h || 1);
        const tx = destX - origBounds.x * sx;
        const ty = destY - origBounds.y * sy;

        switch (origOp.type) {
            case 'pen':
            case 'eraser':
                op.points = origOp.points.map(p => ({
                    x: p.x * sx + tx,
                    y: p.y * sy + ty
                }));
                break;
            case 'line':
                op.start = [origOp.start[0] * sx + tx, origOp.start[1] * sy + ty];
                op.end = [origOp.end[0] * sx + tx, origOp.end[1] * sy + ty];
                break;
            case 'rect':
            case 'filled_rect':
                op.start = [origOp.start[0] * sx + tx, origOp.start[1] * sy + ty];
                op.end = [origOp.end[0] * sx + tx, origOp.end[1] * sy + ty];
                break;
            case 'circle':
            case 'filled_circle':
                op.center = [origOp.center[0] * sx + tx, origOp.center[1] * sy + ty];
                op.radius = origOp.radius * Math.max(Math.abs(sx), Math.abs(sy));
                break;
            case 'text':
                op.position = [origOp.position[0] * sx + tx, origOp.position[1] * sy + ty];
                op.fontSize = Math.max(8, Math.round(origOp.fontSize * Math.max(Math.abs(sx), Math.abs(sy))));
                break;
            case 'shape':
                op.start = [origOp.start[0] * sx + tx, origOp.start[1] * sy + ty];
                op.end = [origOp.end[0] * sx + tx, origOp.end[1] * sy + ty];
                break;
            case 'spray':
                op.dots = origOp.dots.map(d => ({
                    x: d.x * sx + tx,
                    y: d.y * sy + ty
                }));
                break;
            case 'calligraphy':
                op.segments = origOp.segments.map(s => ({
                    x1: s.x1 * sx + tx, y1: s.y1 * sy + ty,
                    x2: s.x2 * sx + tx, y2: s.y2 * sy + ty,
                    w: s.w * Math.max(Math.abs(sx), Math.abs(sy))
                }));
                break;
            case 'filled_triangle':
                if (origOp.points && Array.isArray(origOp.points[0])) {
                    op.points = origOp.points.map(p => [p[0] * sx + tx, p[1] * sy + ty]);
                } else if (origOp.points) {
                    op.points = origOp.points.map(p => ({ x: p.x * sx + tx, y: p.y * sy + ty }));
                }
                break;
            case 'brush':
                // brush 类型：根据子类型不同，有 segments 或 points 或 dots
                if (origOp.segments) {
                    op.segments = origOp.segments.map(s => ({
                        x1: s.x1 * sx + tx, y1: s.y1 * sy + ty,
                        x2: s.x2 * sx + tx, y2: s.y2 * sy + ty,
                        w: s.w * Math.max(Math.abs(sx), Math.abs(sy))
                    }));
                } else if (origOp.points) {
                    op.points = origOp.points.map(p => ({
                        x: p.x * sx + tx,
                        y: p.y * sy + ty
                    }));
                } else if (origOp.dots) {
                    op.dots = origOp.dots.map(d => ({
                        x: d.x * sx + tx,
                        y: d.y * sy + ty
                    }));
                }
                break;
        }
    }

    // 完成缩放/拉伸
    _finishResize(e) {
        this.isResizing = false;
        this.container.style.cursor = '';

        const pos = e.offsetX !== undefined ? this.getMousePos(e) : { x: this.resizeStartX, y: this.resizeStartY };
        const dx = pos.x - this.resizeStartX;
        const dy = pos.y - this.resizeStartY;

        // 如果几乎没有移动，恢复原始状态
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
            // 恢复原始操作数据
            for (const origOp of this.resizeOrigOps) {
                const op = this.operations.find(o => o.id === origOp.id);
                if (op) {
                    delete op.rotation;
                    delete op.flipH;
                    delete op.flipV;
                    delete op.transformOrigin;
                    Object.assign(op, JSON.parse(JSON.stringify(origOp)));
                }
            }
            this.redrawAll();
            this.drawSelectionOverlay();
            return;
        }

        // 保存最终状态并创建撤销记录
        const newOps = this.operations
            .filter(op => this.selectedOps.includes(op.id))
            .map(op => JSON.parse(JSON.stringify(op)));

        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_resize',
            opIds: [...this.selectedOps],
            handle: this.resizeHandle,
            dx, dy,
            oldOps: this.resizeOrigOps,
            newOps,
            isLocal: true
        };
        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];

        // Socket 同步
        if (window.socketManager) {
            window.socketManager.sendBatchTransform(this.selectedOps, 'resize', {
                handle: this.resizeHandle,
                dx, dy,
                startBounds: this.resizeStartBounds
            });
        }

        this.redrawAll();
        this.drawSelectionOverlay();
        showToast('图形尺寸已调整');
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
            // 检查是否点击旋转手柄
            if (this.selectedOps.length > 0 && !this.isRotating && !this.isResizing) {
                const handleInfo = this._hitRotateHandle(pos.x, pos.y);
                if (handleInfo) {
                    this.isRotating = true;
                    this.rotateCenterX = handleInfo.cx;
                    this.rotateCenterY = handleInfo.cy;
                    this.rotateStartAngle = Math.atan2(pos.y - this.rotateCenterY, pos.x - this.rotateCenterX);
                    this.rotateOrigOps = this.operations
                        .filter(op => this.selectedOps.includes(op.id))
                        .map(op => JSON.parse(JSON.stringify(op)));
                    this.container.classList.add('rotating');
                    return;
                }
            }

            // 检查是否点击控制点（缩放/拉伸）
            if (this.selectedOps.length > 0 && !this.isRotating && !this.isResizing) {
                const handle = this._hitResizeHandle(pos.x, pos.y);
                if (handle) {
                    this.isResizing = true;
                    this.resizeHandle = handle;
                    this.resizeStartX = pos.x;
                    this.resizeStartY = pos.y;
                    // 计算当前总包围盒
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
                    this.resizeStartBounds = { minX, minY, maxX, maxY };
                    // 保存原始操作数据
                    this.resizeOrigOps = this.operations
                        .filter(op => this.selectedOps.includes(op.id))
                        .map(op => JSON.parse(JSON.stringify(op)));
                    return;
                }
            }

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

        // 填充工具：点击即填充
        if (tool === 'fill') {
            this._floodFill(pos.x, pos.y);
            this.isDrawing = false;
            return;
        }

        // 取色器工具：点击拾取颜色
        if (tool === 'eyedropper') {
            this._pickColor(pos.x, pos.y);
            this.isDrawing = false;
            return;
        }

        // 缩放工具：左键放大，右键缩小
        if (tool === 'zoom') {
            // 缩放由缩放控制条处理，点击画布也支持放大
            this.zoomIn(pos.x, pos.y);
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

        if (tool === 'brush') {
            this._initBrushStroke(pos);
        }

        if (tool === 'shape') {
            // 形状工具：优先检测是否点击了已有形状 → 选中+拖拽
            if (this.currentShape) {
                for (let i = this.operations.length - 1; i >= 0; i--) {
                    const op = this.operations[i];
                    if (op.type === 'shape' && op.shape === this.currentShape && this.isOpAtPoint(op, pos.x, pos.y)) {
                        this.selectedShapeId = op.id;
                        this.isShapeDragging = true;
                        this.shapeDragStartX = pos.x;
                        this.shapeDragStartY = pos.y;
                        this.shapeDragOrigOp = JSON.parse(JSON.stringify(op));
                        // 更新光标为移动
                        this.container.classList.add('shape-move-dragging');
                        // 绘制选中高亮
                        this._drawShapeSelectionOverlay(op);
                        return;
                    }
                }
            }
            // 没有点击到已有形状 → 清除之前的选中，正常绘制新形状
            this.clearShapeSelection();
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
            // 旋转中
            if (this.isRotating) {
                const currentAngle = Math.atan2(pos.y - this.rotateCenterY, pos.x - this.rotateCenterX);
                const angleDiff = currentAngle - this.rotateStartAngle;
                // 属性存储方式：临时修改操作的 rotation 属性进行预览
                // 先恢复原始数据，再应用旋转
                for (const op of this.operations) {
                    if (this.selectedOps.includes(op.id)) {
                        const origOp = this.rotateOrigOps.find(o => o.id === op.id);
                        if (origOp) {
                            // 恢复原始坐标和属性
                            delete op.rotation;
                            delete op.flipH;
                            delete op.flipV;
                            delete op.transformOrigin;
                            Object.assign(op, JSON.parse(JSON.stringify(origOp)));
                            // 使用 _applyRotationToOp 模拟旋转
                            this._applyRotationToOp(op, this.rotateCenterX, this.rotateCenterY, angleDiff);
                        }
                    }
                }
                this.redrawAll();
                this.drawSelectionOverlay();
                return;
            }

            // 控制点拖拽缩放/拉伸中
            if (this.isResizing) {
                this._applyResizePreview(pos.x, pos.y);
                return;
            }

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
            
            // 旋转手柄悬浮检测 + 控制点光标检测 + 图形移动光标
            if (this.selectedOps.length > 0 && !this.isDragging && !this.isSelecting) {
                const handleInfo = this._hitRotateHandle(pos.x, pos.y);
                if (handleInfo) {
                    this.container.classList.add('rotate-hover');
                    this.container.style.cursor = '';
                } else {
                    this.container.classList.remove('rotate-hover');
                    // 检测控制点光标
                    const resizeHandle = this._hitResizeHandle(pos.x, pos.y);
                    if (resizeHandle) {
                        this.container.style.cursor = this._getResizeCursor(resizeHandle);
                    } else {
                        // 检测是否悬浮在已选中图形上（显示移动光标）
                        const hitOp = this.operations.find(op => this.selectedOps.includes(op.id) && this.isOpAtPoint(op, pos.x, pos.y));
                        if (hitOp) {
                            this.container.style.cursor = 'move';
                        } else {
                            this.container.style.cursor = '';
                        }
                    }
                }
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

        if (!this.isDrawing) {
            // 形状工具拖拽选中形状
            if (tool === 'shape' && this.isShapeDragging && this.selectedShapeId) {
                const dx = pos.x - this.shapeDragStartX;
                const dy = pos.y - this.shapeDragStartY;
                // 实时预览：重绘 + 偏移选中形状
                this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
                for (const op of this.operations) {
                    if (op.id === this.selectedShapeId) {
                        this.replayDraw(this.translateOp(op, dx, dy));
                    } else {
                        this.replayDraw(op);
                    }
                }
                // 绘制选中高亮（偏移后）
                const movedOp = this.translateOp(this.operations.find(o => o.id === this.selectedShapeId), dx, dy);
                this._drawShapeSelectionOverlay(movedOp);
                return;
            }

            // 形状工具悬浮检测：鼠标在形状上时切换为移动光标
            if (tool === 'shape' && this.currentShape && !this.isShapeDragging) {
                let overShape = false;
                for (let i = this.operations.length - 1; i >= 0; i--) {
                    const op = this.operations[i];
                    if (op.type === 'shape' && op.shape === this.currentShape && this.isOpAtPoint(op, pos.x, pos.y)) {
                        overShape = true;
                        break;
                    }
                }
                if (overShape) {
                    this.container.classList.add('shape-move-hover');
                } else {
                    this.container.classList.remove('shape-move-hover');
                }
            }
            return;
        }

        if (tool === 'pen' || tool === 'eraser') {
            this.mainCtx.lineTo(pos.x, pos.y);
            this.mainCtx.stroke();
            this.currentPath.push({ x: pos.x, y: pos.y });
        } else if (tool === 'brush') {
            this._drawBrushMove(pos);
        } else if (tool === 'shape' && this.currentShape) {
            // 形状预览
            this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            this.previewCtx.strokeStyle = this.toolManager.getColor();
            this.previewCtx.lineWidth = this.toolManager.getWidth();
            this.previewCtx.lineCap = 'round';
            this.previewCtx.lineJoin = 'round';
            this.drawShapePath(this.previewCtx, this.currentShape, this.startX, this.startY, pos.x, pos.y);
            this.previewCtx.stroke();
        }
    }

    onMouseUp(e) {
        const tool = this.toolManager.getTool();

        // 选择工具
        if (tool === 'select') {
            // 控制点拖拽缩放/拉伸完成
            if (this.isResizing) {
                this._finishResize(e);
                return;
            }

            // 旋转完成
            if (this.isRotating) {
                this.isRotating = false;
                this.container.classList.remove('rotating');
                const pos = e.offsetX !== undefined ? this.getMousePos(e) : { x: this.rotateCenterX, y: this.rotateCenterY };
                const endAngle = Math.atan2(pos.y - this.rotateCenterY, pos.x - this.rotateCenterX);
                const angleDiff = endAngle - this.rotateStartAngle;
                const angleDeg = angleDiff * 180 / Math.PI;

                if (Math.abs(angleDeg) > 1) {
                    // 有实际旋转 → 操作的 rotation/transformOrigin 已在预览时正确设置
                    // oldOps 中保存的是旋转前的完整状态（包含旧变换属性和坐标）
                    const batchOp = {
                        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                        type: 'batch_rotate',
                        opIds: [...this.selectedOps],
                        angle: angleDeg,
                        cx: this.rotateCenterX,
                        cy: this.rotateCenterY,
                        oldOps: this.rotateOrigOps,
                        isLocal: true
                    };
                    this.myUndoStack.push(batchOp);
                    this.myRedoStack = [];
                    if (window.socketManager) {
                        window.socketManager.sendBatchTransform(this.selectedOps, 'rotate', { angle: angleDeg, cx: this.rotateCenterX, cy: this.rotateCenterY });
                    }
                } else {
                    // 无实际旋转 → 恢复原始状态
                    for (const op of this.operations) {
                        if (this.selectedOps.includes(op.id)) {
                            const origOp = this.rotateOrigOps.find(o => o.id === op.id);
                            if (origOp) {
                                delete op.rotation;
                                delete op.flipH;
                                delete op.flipV;
                                delete op.transformOrigin;
                                Object.assign(op, JSON.parse(JSON.stringify(origOp)));
                            }
                        }
                    }
                }
                this.redrawAll();
                this.drawSelectionOverlay();
                return;
            }

            if (this.isDragging) {
                // 完成拖拽移动
                const pos = this.getMousePos(e);
                const dx = pos.x - this.dragStartX;
                const dy = pos.y - this.dragStartY;
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

        if (!this.isDrawing) {
            // 形状工具拖拽完成
            if (tool === 'shape' && this.isShapeDragging) {
                this.isShapeDragging = false;
                this.container.classList.remove('shape-move-dragging');
                const pos = e.offsetX !== undefined ? this.getMousePos(e) : { x: this.shapeDragStartX, y: this.shapeDragStartY };
                const dx = pos.x - this.shapeDragStartX;
                const dy = pos.y - this.shapeDragStartY;

                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                    // 有实际移动 → 应用偏移
                    const op = this.operations.find(o => o.id === this.selectedShapeId);
                    if (op) {
                        const moved = this.translateOp(op, dx, dy);
                        Object.assign(op, moved);
                        // 记录撤销
                        const moveOp = {
                            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                            type: 'batch_move',
                            opIds: [this.selectedShapeId],
                            dx: dx, dy: dy,
                            oldOps: [this.shapeDragOrigOp],
                            isLocal: true
                        };
                        this.myUndoStack.push(moveOp);
                        this.myRedoStack = [];
                        // 同步
                        if (window.socketManager) {
                            window.socketManager.sendBatchMove([this.selectedShapeId], dx, dy);
                        }
                    }
                }
                this.redrawAll();
                // 保留选中高亮
                const finalOp = this.operations.find(o => o.id === this.selectedShapeId);
                if (finalOp) this._drawShapeSelectionOverlay(finalOp);
                return;
            }
            return;
        }
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
        } else if (tool === 'brush') {
            operation = this._finishBrushStroke(color, width);
        } else if (tool === 'shape' && this.currentShape) {
            const pos = e.offsetX !== undefined ? this.getMousePos(e) : { x: this.startX, y: this.startY };
            this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            // 清除形状选中高亮（新绘制的形状替代选中）
            this.clearShapeSelection();

            // 在主画布上绘制
            this.mainCtx.globalCompositeOperation = 'source-over';
            this.mainCtx.strokeStyle = color;
            this.mainCtx.lineWidth = width;
            this.mainCtx.lineCap = 'round';
            this.mainCtx.lineJoin = 'round';
            this.drawShapePath(this.mainCtx, this.currentShape, this.startX, this.startY, pos.x, pos.y);
            this.mainCtx.stroke();

            operation = {
                type: 'shape',
                shape: this.currentShape,
                start: [this.startX, this.startY],
                end: [pos.x, pos.y],
                color: color,
                width: width
            };
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

    // ========== 形状工具选中高亮 ==========
    _drawShapeSelectionOverlay(op) {
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        if (!op) return;
        const bounds = this.getOpBounds(op);
        if (!bounds) return;

        this.previewCtx.save();
        // 选中高亮边框
        this.previewCtx.strokeStyle = '#4361ee';
        this.previewCtx.lineWidth = 2;
        this.previewCtx.setLineDash([6, 3]);
        this.previewCtx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.w + 8, bounds.h + 8);

        // 四角控制点
        const corners = [
            [bounds.x - 4, bounds.y - 4],
            [bounds.x + bounds.w + 4, bounds.y - 4],
            [bounds.x - 4, bounds.y + bounds.h + 4],
            [bounds.x + bounds.w + 4, bounds.y + bounds.h + 4]
        ];
        this.previewCtx.fillStyle = '#4361ee';
        this.previewCtx.setLineDash([]);
        for (const [cx, cy] of corners) {
            this.previewCtx.fillRect(cx - 3, cy - 3, 6, 6);
        }
        this.previewCtx.restore();
    }

    clearShapeSelection() {
        this.selectedShapeId = null;
        this.isShapeDragging = false;
        this.container.classList.remove('shape-move-hover');
        this.container.classList.remove('shape-move-dragging');
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }

    // ========== 右键上下文菜单 ==========
    _showContextMenu(x, y) {
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        // 确保菜单不超出视口
        menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
        menu.classList.add('show');
    }

    _hideContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.classList.remove('show');
    }

    // ========== 复制 / 粘贴 ==========
    copySelected() {
        if (this.selectedOps.length === 0) return;
        this.clipboard = this.operations
            .filter(op => this.selectedOps.includes(op.id))
            .map(op => JSON.parse(JSON.stringify(op)));
        showToast(`已复制 ${this.clipboard.length} 个对象`);
        console.log('[WB] 复制:', this.clipboard.length, '个对象');
    }

    pasteClipboard() {
        if (this.clipboard.length === 0) return;
        const offset = 20; // 粘贴偏移量
        const newOps = [];
        for (const op of this.clipboard) {
            const newOp = JSON.parse(JSON.stringify(op));
            newOp.id = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            newOp.isLocal = true;
            // 偏移粘贴位置
            const moved = this.translateOp(newOp, offset, offset);
            Object.assign(newOp, moved);
            this.operations.push(newOp);
            this.replayDraw(newOp);
            this.myUndoStack.push(newOp);
            newOps.push(newOp);
        }
        this.myRedoStack = [];
        // 同步到其他用户
        if (window.socketManager) {
            for (const op of newOps) {
                window.socketManager.sendDraw(op);
            }
        }
        // 选中新粘贴的对象
        this.selectedOps = newOps.map(op => op.id);
        this.drawSelectionOverlay();
        this.updateBatchBar();
        showToast(`已粘贴 ${newOps.length} 个对象`);
        console.log('[WB] 粘贴:', newOps.length, '个对象');
    }

    // ========== 旋转 ==========
    rotateSelected(angleDeg) {
        if (this.selectedOps.length === 0) return;

        const oldOps = [];
        // 计算选中项的包围盒中心
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
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        const rad = angleDeg * Math.PI / 180;

        for (const op of this.operations) {
            if (!this.selectedOps.includes(op.id)) continue;
            oldOps.push(JSON.parse(JSON.stringify(op)));
            this._applyRotationToOp(op, cx, cy, rad);
        }

        // 记录撤销
        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_rotate',
            opIds: [...this.selectedOps],
            angle: angleDeg,
            cx, cy,
            oldOps,
            isLocal: true
        };
        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];
        this.redrawAll();
        this.drawSelectionOverlay();

        // 同步
        if (window.socketManager) {
            window.socketManager.sendBatchTransform(this.selectedOps, 'rotate', { angle: angleDeg, cx, cy });
        }
        console.log('[WB] 旋转:', angleDeg, '度, 中心:', cx, cy);
    }

    _applyRotationToOp(op, cx, cy, rad) {
        // 如果操作已有变换属性，先烘焙到坐标中
        this._bakeTransform(op);
        // 然后存储新的旋转属性
        // 对于 shape/rect/filled_rect/text 类型，rotation 不会被烘焙，需要累加
        // 且使用操作自身的包围盒中心作为 transformOrigin（避免多中心旋转问题）
        const needsRotationAttr = ['shape', 'rect', 'filled_rect', 'text'].includes(op.type);
        if (needsRotationAttr) {
            const oldRotation = op.rotation || 0;
            op.rotation = oldRotation + rad;
            // 使用操作自身的原始包围盒中心
            const center = this._getOpCenter(op);
            op.transformOrigin = center;
        } else {
            op.rotation = rad;
            op.transformOrigin = [cx, cy];
        }
    }

    // 将已有的 rotation/flipH/flipV 变换烘焙到坐标中，然后清除变换属性
    _bakeTransform(op) {
        const hasRotation = op.rotation != null && op.rotation !== 0;
        const hasFlip = op.flipH || op.flipV;
        if (!hasRotation && !hasFlip) return;

        // 对于 shape/rect/filled_rect/text 类型，rotation 不能烘焙到坐标中
        // 因为 drawShapePath 用 start/end 重建轴对齐形状会丢失旋转角度
        // 这些类型只烘焙 flip，保留 rotation 属性
        const needsRotationAttr = ['shape', 'rect', 'filled_rect', 'text'].includes(op.type);
        const shouldBakeRotation = hasRotation && !needsRotationAttr;
        const shouldBakeFlip = hasFlip;
        if (!shouldBakeRotation && !shouldBakeFlip) return;

        const [ox, oy] = op.transformOrigin || this._getOpCenter(op);

        // 翻转变换函数
        const flipPoint = shouldBakeFlip ? (x, y) => {
            return [op.flipH ? 2 * ox - x : x, op.flipV ? 2 * oy - y : y];
        } : null;

        // 旋转变换函数
        const cos = shouldBakeRotation ? Math.cos(op.rotation) : 1;
        const sin = shouldBakeRotation ? Math.sin(op.rotation) : 0;
        const rotatePoint = shouldBakeRotation ? (x, y) => {
            const dx = x - ox, dy = y - oy;
            return [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos];
        } : null;

        const applyTransform = (x, y) => {
            let px = x, py = y;
            if (flipPoint) { [px, py] = flipPoint(px, py); }
            if (rotatePoint) { [px, py] = rotatePoint(px, py); }
            return [px, py];
        };

        // 就地变换坐标
        switch (op.type) {
            case 'pen':
            case 'eraser':
            case 'brush':
                if (op.points) op.points = op.points.map(p => {
                    const [nx, ny] = applyTransform(p.x, p.y);
                    return { x: nx, y: ny };
                });
                if (op.dots) op.dots = op.dots.map(d => {
                    const [nx, ny] = applyTransform(d.x, d.y);
                    return { x: nx, y: ny };
                });
                if (op.segments) op.segments = op.segments.map(s => {
                    const [nx1, ny1] = applyTransform(s.x1, s.y1);
                    const [nx2, ny2] = applyTransform(s.x2, s.y2);
                    return { ...s, x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
                });
                break;
            case 'line':
                if (op.start) { const [nx, ny] = applyTransform(op.start[0], op.start[1]); op.start = [nx, ny]; }
                if (op.end) { const [nx, ny] = applyTransform(op.end[0], op.end[1]); op.end = [nx, ny]; }
                break;
            case 'rect':
            case 'filled_rect':
            case 'shape':
                if (shouldBakeFlip) {
                    if (op.start) { const [nx, ny] = flipPoint(op.start[0], op.start[1]); op.start = [nx, ny]; }
                    if (op.end) { const [nx, ny] = flipPoint(op.end[0], op.end[1]); op.end = [nx, ny]; }
                }
                // rotation 不烘焙，保留属性
                break;
            case 'circle':
            case 'filled_circle':
                if (op.center) { const [nx, ny] = applyTransform(op.center[0], op.center[1]); op.center = [nx, ny]; }
                break;
            case 'filled_triangle':
                if (op.points) op.points = op.points.map(p => {
                    const [nx, ny] = applyTransform(p[0], p[1]);
                    return [nx, ny];
                });
                break;
            case 'text':
                if (shouldBakeFlip) {
                    if (op.position) { const [nx, ny] = flipPoint(op.position[0], op.position[1]); op.position = [nx, ny]; }
                }
                // rotation 不烘焙，保留属性
                break;
            case 'spray':
            case 'calligraphy':
                if (op.dots) op.dots = op.dots.map(d => {
                    const [nx, ny] = applyTransform(d.x, d.y);
                    return { x: nx, y: ny };
                });
                if (op.segments) op.segments = op.segments.map(s => {
                    const [nx1, ny1] = applyTransform(s.x1, s.y1);
                    const [nx2, ny2] = applyTransform(s.x2, s.y2);
                    return { ...s, x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
                });
                break;
        }

        // 清除已烘焙的变换属性
        if (shouldBakeRotation) delete op.rotation;
        if (shouldBakeFlip) { delete op.flipH; delete op.flipV; }
        // 如果全部烘焙了，也清除 transformOrigin
        if (shouldBakeRotation && shouldBakeFlip) {
            delete op.transformOrigin;
        } else if (shouldBakeFlip && !needsRotationAttr) {
            // flip 烘焙了，rotation 也烘焙了（非 needsRotationAttr）
            delete op.transformOrigin;
        }
        // 只有当 rotation 被保留时才保留 transformOrigin（因为 Canvas Transform 还需要它）
        // 否则所有变换都已烘焙到坐标中，清除 transformOrigin
        if (!(hasRotation && needsRotationAttr)) {
            delete op.transformOrigin;
        }
    }

    // 自定义旋转开始
    startCustomRotate() {
        if (this.selectedOps.length === 0) return;
        this._hideContextMenu();

        // 计算选中项包围盒中心
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
        this.rotateCenterX = (minX + maxX) / 2;
        this.rotateCenterY = (minY + maxY) / 2;
        this.isRotating = false; // 等用户在旋转手柄上按下时才激活
        this.rotateOrigOps = this.operations
            .filter(op => this.selectedOps.includes(op.id))
            .map(op => JSON.parse(JSON.stringify(op)));

        // 绘制旋转手柄提示
        this._drawRotateHandle(this.rotateCenterX, minY - 6);
        showToast('拖拽顶部旋转手柄进行自定义旋转');
    }

    _drawRotateHandle(cx, topY) {
        const ctx = this.previewCtx;
        ctx.save();
        // 连接线
        ctx.strokeStyle = '#4361ee';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(cx, topY - 24);
        ctx.stroke();
        ctx.setLineDash([]);
        // 旋转图标（圆形+箭头）
        ctx.beginPath();
        ctx.arc(cx, topY - 30, 7, -Math.PI * 0.7, Math.PI * 0.7);
        ctx.strokeStyle = '#4361ee';
        ctx.lineWidth = 2;
        ctx.stroke();
        // 箭头
        const arrowAngle = Math.PI * 0.7;
        const ax = cx + 7 * Math.cos(arrowAngle);
        const ay = (topY - 30) + 7 * Math.sin(arrowAngle);
        ctx.beginPath();
        ctx.moveTo(ax - 3, ay - 4);
        ctx.lineTo(ax, ay);
        ctx.lineTo(ax + 4, ay - 2);
        ctx.strokeStyle = '#4361ee';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    // ========== 翻转 ==========
    flipSelected(axis) {
        if (this.selectedOps.length === 0) return;

        const oldOps = [];
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
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        for (const op of this.operations) {
            if (!this.selectedOps.includes(op.id)) continue;
            oldOps.push(JSON.parse(JSON.stringify(op)));
            this._applyFlipToOp(op, cx, cy, axis);
        }

        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_flip',
            opIds: [...this.selectedOps],
            axis,
            cx, cy,
            oldOps,
            isLocal: true
        };
        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];
        this.redrawAll();
        this.drawSelectionOverlay();

        if (window.socketManager) {
            window.socketManager.sendBatchTransform(this.selectedOps, 'flip', { axis, cx, cy });
        }
        console.log('[WB] 翻转:', axis, '中心:', cx, cy);
    }

    _applyFlipToOp(op, cx, cy, axis) {
        // 如果操作已有变换属性，先烘焙到坐标中
        this._bakeTransform(op);
        // 对于有 rotation 属性的类型（shape/rect/filled_rect/text），flip 直接应用到坐标
        // 而不是设置 flipH/flipV 属性，避免与 rotation 属性的 transformOrigin 冲突
        const hasRotationAttr = ['shape', 'rect', 'filled_rect', 'text'].includes(op.type) && op.rotation;
        if (hasRotationAttr) {
            // 就地翻转坐标，保留 rotation 属性
            const flipH = (x) => 2 * cx - x;
            const flipV = (y) => 2 * cy - y;
            const flipPoint = (x, y) => [axis === 'h' ? flipH(x) : x, axis === 'v' ? flipV(y) : y];
            switch (op.type) {
                case 'rect':
                case 'filled_rect':
                case 'shape':
                    if (op.start) { const [nx, ny] = flipPoint(op.start[0], op.start[1]); op.start = [nx, ny]; }
                    if (op.end) { const [nx, ny] = flipPoint(op.end[0], op.end[1]); op.end = [nx, ny]; }
                    break;
                case 'text':
                    if (op.position) { const [nx, ny] = flipPoint(op.position[0], op.position[1]); op.position = [nx, ny]; }
                    break;
            }
            // 更新 transformOrigin（翻转后旋转中心也变了）
            if (op.transformOrigin) {
                const [nox, noy] = flipPoint(op.transformOrigin[0], op.transformOrigin[1]);
                op.transformOrigin = [nox, noy];
            }
        } else {
            // 无 rotation 属性的类型，使用 flipH/flipV 属性 + Canvas Transform
            if (axis === 'h') {
                op.flipH = true;
            } else if (axis === 'v') {
                op.flipV = true;
            }
            op.transformOrigin = [cx, cy];
        }
    }

    // ========== 边框样式 ==========
    setBorderSelected(style) {
        if (this.selectedOps.length === 0) return;
        const oldOps = [];
        for (const op of this.operations) {
            if (!this.selectedOps.includes(op.id)) continue;
            // 只有 stroke 类型操作才能设置边框
            if (op.type === 'shape' || op.type === 'line' || op.type === 'rect' || op.type === 'circle') {
                oldOps.push({ id: op.id, borderStyle: op.borderStyle || 'solid' });
                op.borderStyle = style;
            }
        }
        if (oldOps.length === 0) { showToast('所选对象不支持边框样式'); return; }

        const batchOp = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: 'batch_border',
            opIds: [...this.selectedOps],
            borderStyle: style,
            oldOps,
            isLocal: true
        };
        this.myUndoStack.push(batchOp);
        this.myRedoStack = [];
        this.redrawAll();

        if (window.socketManager) {
            window.socketManager.sendBatchTransform(this.selectedOps, 'border', { borderStyle: style });
        }
        const styleLabel = style === 'solid' ? '实线' : style === 'dashed' ? '虚线' : '无边框';
        showToast(`边框已改为${styleLabel}`);
        console.log('[WB] 边框:', style);
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
            case 'shape':
                return { x: op.start[0], y: op.start[1] };
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
            case 'shape':
                moved.start = [moved.start[0] + dx, moved.start[1] + dy];
                moved.end = [moved.end[0] + dx, moved.end[1] + dy];
                break;
            case 'brush':
                if (moved.points) moved.points = moved.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                if (moved.dots) moved.dots = moved.dots.map(d => ({ x: d.x+dx, y: d.y+dy }));
                if (moved.segments) moved.segments = moved.segments.map(s => ({ ...s, x1:s.x1+dx, y1:s.y1+dy, x2:s.x2+dx, y2:s.y2+dy }));
                break;
        }
        // 偏移 transformOrigin
        if (moved.transformOrigin) {
            moved.transformOrigin = [moved.transformOrigin[0] + dx, moved.transformOrigin[1] + dy];
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

    // ========== 画笔工具统一引擎 ==========
    _initBrushStroke(pos) {
        const brush = this.currentBrush || 'inkbrush';
        this._brushData = { brush, points: [{ x: pos.x, y: pos.y }] };

        if (brush === 'inkbrush' || brush === 'pen' || brush === 'oil' || brush === 'watercolor') {
            // 路径类画笔：初始化路径 + 速度追踪
            this._brushData.lastPos = { x: pos.x, y: pos.y };
            this._brushData.lastWidth = this.toolManager.getWidth() * (brush === 'inkbrush' ? 3 : brush === 'oil' ? 2.5 : brush === 'watercolor' ? 2 : 1.2);
            this._brushData.segments = [];
            this.mainCtx.globalCompositeOperation = 'source-over';
        } else if (brush === 'spray') {
            // 喷枪：继承原喷枪逻辑
            this.sprayDots = [];
            this.sprayCurrentPos = { x: pos.x, y: pos.y };
            this._startSpray();
        } else if (brush === 'crayon' || brush === 'pencil' || brush === 'marker') {
            // 基于路径的画笔
            this.currentPath = [{ x: pos.x, y: pos.y }];
            this.mainCtx.beginPath();
            this.mainCtx.moveTo(pos.x, pos.y);
            this.mainCtx.globalCompositeOperation = 'source-over';
            this.mainCtx.strokeStyle = this.toolManager.getColor();
            this.mainCtx.lineCap = 'round';
            this.mainCtx.lineJoin = 'round';
            if (brush === 'marker') {
                this.mainCtx.lineWidth = this.toolManager.getWidth() * 3;
                this.mainCtx.globalAlpha = 0.55;
            } else if (brush === 'crayon') {
                this.mainCtx.lineWidth = this.toolManager.getWidth() * 2.5;
                this.mainCtx.globalAlpha = 0.45;
            } else {
                this.mainCtx.lineWidth = Math.max(1, this.toolManager.getWidth() * 0.6);
                this.mainCtx.globalAlpha = 0.8;
            }
        }
    }

    _drawBrushMove(pos) {
        if (!this._brushData) return;
        const brush = this._brushData.brush;

        if (brush === 'inkbrush' || brush === 'pen' || brush === 'oil' || brush === 'watercolor') {
            this._drawBrushSegment(pos);
        } else if (brush === 'spray') {
            this.sprayCurrentPos = { x: pos.x, y: pos.y };
        } else if (brush === 'crayon' || brush === 'pencil') {
            // 蜡笔/铅笔：加入轻微抖动 + 噪声
            const jitter = brush === 'crayon' ? 1.5 : 0.5;
            const jx = pos.x + (Math.random() - 0.5) * jitter;
            const jy = pos.y + (Math.random() - 0.5) * jitter;
            this.currentPath.push({ x: jx, y: jy });
            this.mainCtx.lineTo(jx, jy);
            this.mainCtx.stroke();
            this.mainCtx.beginPath();
            this.mainCtx.moveTo(jx, jy);
            // 铅笔：偶尔画双线模拟粗糙
            if (brush === 'pencil' && Math.random() < 0.3) {
                this.mainCtx.save();
                this.mainCtx.globalAlpha = 0.2;
                this.mainCtx.lineWidth = Math.max(0.5, this.toolManager.getWidth() * 0.3);
                this.mainCtx.beginPath();
                this.mainCtx.moveTo(pos.x + (Math.random()-0.5)*2, pos.y + (Math.random()-0.5)*2);
                this.mainCtx.lineTo(jx + (Math.random()-0.5)*2, jy + (Math.random()-0.5)*2);
                this.mainCtx.stroke();
                this.mainCtx.restore();
                this.mainCtx.beginPath();
                this.mainCtx.moveTo(jx, jy);
            }
        } else if (brush === 'marker') {
            this.currentPath.push({ x: pos.x, y: pos.y });
            this.mainCtx.lineTo(pos.x, pos.y);
            this.mainCtx.stroke();
            this.mainCtx.beginPath();
            this.mainCtx.moveTo(pos.x, pos.y);
        }

        this._brushData.points.push({ x: pos.x, y: pos.y });
    }

    _drawBrushSegment(pos) {
        const brush = this._brushData.brush;
        const lastPos = this._brushData.lastPos;
        const dx = pos.x - lastPos.x;
        const dy = pos.y - lastPos.y;
        const speed = Math.sqrt(dx * dx + dy * dy);
        const color = this.toolManager.getColor();
        const baseWidth = this._brushData.lastWidth;

        let targetWidth;
        if (brush === 'inkbrush') {
            // 毛笔：慢粗快细，压感明显
            targetWidth = Math.max(baseWidth * 0.1, baseWidth - speed * 0.9);
        } else if (brush === 'pen') {
            // 书写笔：轻微压感
            targetWidth = Math.max(baseWidth * 0.5, baseWidth - speed * 0.2);
        } else if (brush === 'oil') {
            // 油画笔：厚重，几乎不随速度变化
            targetWidth = Math.max(baseWidth * 0.7, baseWidth - speed * 0.1);
        } else {
            // 水彩：柔和变化
            targetWidth = Math.max(baseWidth * 0.4, baseWidth - speed * 0.4);
        }

        const smoothWidth = this._brushData.lastWidth * 0.6 + targetWidth * 0.4;
        const prevWidth = this._brushData.lastWidth;  // 保存旧宽度用于梯形绘制
        this._brushData.lastWidth = smoothWidth;

        const ctx = this.mainCtx;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const len = Math.max(1, Math.sqrt(dx*dx + dy*dy));
        const nx = -dy / len;
        const ny = dx / len;

        if (brush === 'watercolor') {
            // 水彩：半透明多层叠加（prevWidth 是起点宽度，smoothWidth 是终点宽度）
            ctx.save();
            ctx.globalAlpha = 0.25;
            // 主笔触
            ctx.beginPath();
            ctx.moveTo(lastPos.x + nx*prevWidth/2, lastPos.y + ny*prevWidth/2);
            ctx.lineTo(pos.x + nx*smoothWidth/2, pos.y + ny*smoothWidth/2);
            ctx.lineTo(pos.x - nx*smoothWidth/2, pos.y - ny*smoothWidth/2);
            ctx.lineTo(lastPos.x - nx*prevWidth/2, lastPos.y - ny*prevWidth/2);
            ctx.closePath();
            ctx.fill();
            // 扩散层
            ctx.globalAlpha = 0.1;
            const spread = smoothWidth * 0.4;
            ctx.beginPath();
            ctx.moveTo(lastPos.x + nx*(prevWidth+spread)/2, lastPos.y + ny*(prevWidth+spread)/2);
            ctx.lineTo(pos.x + nx*(smoothWidth+spread)/2, pos.y + ny*(smoothWidth+spread)/2);
            ctx.lineTo(pos.x - nx*(smoothWidth+spread)/2, pos.y - ny*(smoothWidth+spread)/2);
            ctx.lineTo(lastPos.x - nx*(prevWidth+spread)/2, lastPos.y - ny*(prevWidth+spread)/2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else if (brush === 'oil') {
            // 油画笔：厚重不透明条带（prevWidth 是起点宽度，smoothWidth 是终点宽度）
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(lastPos.x + nx*prevWidth/2, lastPos.y + ny*prevWidth/2);
            ctx.lineTo(pos.x + nx*smoothWidth/2, pos.y + ny*smoothWidth/2);
            ctx.lineTo(pos.x - nx*smoothWidth/2, pos.y - ny*smoothWidth/2);
            ctx.lineTo(lastPos.x - nx*prevWidth/2, lastPos.y - ny*prevWidth/2);
            ctx.closePath();
            ctx.fill();
            // 纹理条纹
            ctx.globalAlpha = 0.15;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(lastPos.x + nx*prevWidth*0.15, lastPos.y + ny*prevWidth*0.15);
            ctx.lineTo(pos.x + nx*smoothWidth*0.15, pos.y + ny*smoothWidth*0.15);
            ctx.stroke();
            ctx.restore();
        } else {
            // 毛笔/书写笔：梯形条带（prevWidth 是起点宽度，smoothWidth 是终点宽度）
            ctx.beginPath();
            ctx.moveTo(lastPos.x + nx*prevWidth/2, lastPos.y + ny*prevWidth/2);
            ctx.lineTo(pos.x + nx*smoothWidth/2, pos.y + ny*smoothWidth/2);
            ctx.lineTo(pos.x - nx*smoothWidth/2, pos.y - ny*smoothWidth/2);
            ctx.lineTo(lastPos.x - nx*prevWidth/2, lastPos.y - ny*prevWidth/2);
            ctx.closePath();
            ctx.fill();
        }

        this._brushData.segments.push({
            x1: lastPos.x, y1: lastPos.y,
            x2: pos.x, y2: pos.y,
            w1: prevWidth, w2: smoothWidth
        });
        this._brushData.lastPos = { x: pos.x, y: pos.y };
        this._brushData.lastWidth = smoothWidth;
    }

    _finishBrushStroke(color, width) {
        const brush = this._brushData ? this._brushData.brush : this.currentBrush;
        let operation = null;

        if (brush === 'spray') {
            this._stopSpray();
            if (this.sprayDots.length > 0) {
                operation = {
                    type: 'brush',
                    brush: 'spray',
                    dots: [...this.sprayDots],
                    color: color,
                    radius: this.toolManager.getWidth() * 3 + 10,
                    dotSize: Math.max(1, this.toolManager.getWidth() * 0.5)
                };
            }
            this.sprayDots = [];
        } else if (brush === 'crayon' || brush === 'pencil' || brush === 'marker') {
            this.mainCtx.globalAlpha = 1;
            operation = {
                type: 'brush',
                brush: brush,
                points: [...this.currentPath],
                color: color,
                width: width,
                alpha: brush === 'marker' ? 0.55 : brush === 'crayon' ? 0.45 : 0.8
            };
            this.currentPath = [];
        } else if (this._brushData && this._brushData.segments && this._brushData.segments.length > 0) {
            // inkbrush / pen / oil / watercolor
            operation = {
                type: 'brush',
                brush: brush,
                segments: [...this._brushData.segments],
                color: color,
                width: width
            };
        }

        this._brushData = null;
        return operation;
    }

    // ========== 填充工具（油漆桶）==========
    _floodFill(startX, startY) {
        const ctx = this.mainCtx;
        const w = this.mainCanvas.width;
        const h = this.mainCanvas.height;
        const sx = Math.round(startX);
        const sy = Math.round(startY);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const color = this.toolManager.getColor();

        // 解析目标颜色
        const fillColor = this._hexToRgba(color);

        // 获取起始像素颜色
        const startIdx = (sy * w + sx) * 4;
        const startR = data[startIdx];
        const startG = data[startIdx + 1];
        const startB = data[startIdx + 2];
        const startA = data[startIdx + 3];

        // 如果颜色相同，不填充
        if (startR === fillColor.r && startG === fillColor.g && startB === fillColor.b && startA === fillColor.a) return;

        const tolerance = 30;
        const stack = [[sx, sy]];
        const visited = new Uint8Array(w * h);

        const matchColor = (idx) => {
            return Math.abs(data[idx] - startR) <= tolerance &&
                   Math.abs(data[idx + 1] - startG) <= tolerance &&
                   Math.abs(data[idx + 2] - startB) <= tolerance &&
                   Math.abs(data[idx + 3] - startA) <= tolerance;
        };

        while (stack.length > 0) {
            const [cx, cy] = stack.pop();
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
            const pixelIdx = cy * w + cx;
            if (visited[pixelIdx]) continue;
            const dataIdx = pixelIdx * 4;
            if (!matchColor(dataIdx)) continue;

            visited[pixelIdx] = 1;
            data[dataIdx] = fillColor.r;
            data[dataIdx + 1] = fillColor.g;
            data[dataIdx + 2] = fillColor.b;
            data[dataIdx + 3] = fillColor.a;

            stack.push([cx + 1, cy]);
            stack.push([cx - 1, cy]);
            stack.push([cx, cy + 1]);
            stack.push([cx, cy - 1]);
        }

        ctx.putImageData(imageData, 0, 0);

        // 记录填充操作
        const operation = {
            type: 'fill',
            x: sx, y: sy,
            color: color,
            tolerance: tolerance
        };
        operation.id = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        operation.isLocal = true;
        this.operations.push(operation);
        this.myUndoStack.push(operation);
        this.myRedoStack = [];
        if (window.socketManager) {
            window.socketManager.sendDraw(operation);
        }
    }

    _hexToRgba(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return { r, g, b, a: 255 };
    }

    // ========== 取色器工具 ==========
    _pickColor(x, y) {
        const ctx = this.mainCtx;
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || px >= this.mainCanvas.width || py < 0 || py >= this.mainCanvas.height) return;

        const pixel = ctx.getImageData(px, py, 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');

        // 设置当前颜色
        this.toolManager.currentColor = hex;
        document.getElementById('custom-color').value = hex;
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));

        // 更新UI提示
        const levelEl = document.getElementById('zoom-level');
        if (levelEl) {
            const oldText = levelEl.textContent;
            levelEl.textContent = hex;
            setTimeout(() => { levelEl.textContent = oldText; }, 1500);
        }

        // 取色后自动切回画笔
        this.toolManager.currentTool = 'pen';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="pen"]').classList.add('active');
        // 清除取色器/缩放等特殊光标 class
        this.container.classList.remove('eyedropper-mode', 'zoom-mode', 'fill-mode', 'select-mode');
        // 隐藏缩放控制条
        const zoomCtrl = document.getElementById('zoom-control');
        if (zoomCtrl) zoomCtrl.style.display = 'none';
    }

    // ========== 缩放工具 ==========
    zoomIn(cx, cy) {
        this._applyZoom(this.zoomScale * 1.2, cx, cy);
    }

    zoomOut(cx, cy) {
        this._applyZoom(this.zoomScale / 1.2, cx, cy);
    }

    zoomReset() {
        this._applyZoom(1);
    }

    _applyZoom(newScale, cx, cy) {
        newScale = Math.max(0.1, Math.min(5, newScale));
        const container = this.container;

        if (newScale === 1) {
            this.zoomScale = 1;
            this.zoomOrigin = { x: 0, y: 0 };
            container.style.transform = '';
            container.style.transformOrigin = '';
        } else {
            // 以画布中心或指定点为缩放中心
            if (cx === undefined || cy === undefined) {
                cx = this.mainCanvas.width / 2;
                cy = this.mainCanvas.height / 2;
            }
            // cx/cy 是画布逻辑坐标，转换为当前缩放状态下的屏幕偏移
            const screenCx = (cx - this.zoomOrigin.x) * this.zoomScale;
            const screenCy = (cy - this.zoomOrigin.y) * this.zoomScale;

            this.zoomScale = newScale;

            // 保持缩放中心点在屏幕上不动
            this.zoomOrigin.x = cx - screenCx / newScale;
            this.zoomOrigin.y = cy - screenCy / newScale;

            // CSS transform: 先平移到缩放原点，再缩放
            container.style.transformOrigin = '0 0';
            container.style.transform = `translate(${-this.zoomOrigin.x * this.zoomScale}px, ${-this.zoomOrigin.y * this.zoomScale}px) scale(${this.zoomScale})`;
        }

        // 更新缩放显示
        const levelEl = document.getElementById('zoom-level');
        if (levelEl) {
            levelEl.textContent = Math.round(this.zoomScale * 100) + '%';
        }
    }

    // ========== 重放远程操作 ==========
    replayDraw(operation) {
        const ctx = this.mainCtx;

        // 检查是否有变换属性（rotation/flipH/flipV）
        const hasRotation = operation.rotation != null && operation.rotation !== 0;
        const hasFlip = operation.flipH || operation.flipV;
        const hasTransform = hasRotation || hasFlip;

        // 应用 Canvas Transform
        if (hasTransform) {
            const [ox, oy] = operation.transformOrigin || this._getOpCenter(operation);
            ctx.save();
            ctx.translate(ox, oy);
            if (hasFlip) ctx.scale(operation.flipH ? -1 : 1, operation.flipV ? -1 : 1);
            if (hasRotation) ctx.rotate(operation.rotation);
            ctx.translate(-ox, -oy);
        }

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
            if (operation.borderStyle === 'none') {
                // 无边框，跳过绘制
            } else {
                ctx.strokeStyle = operation.color;
                ctx.lineWidth = operation.width;
                ctx.lineCap = 'round';
                if (operation.borderStyle === 'dashed') {
                    ctx.setLineDash([8, 4]);
                } else {
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.moveTo(operation.start[0], operation.start[1]);
                ctx.lineTo(operation.end[0], operation.end[1]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        } else if (operation.type === 'rect') {
            ctx.globalCompositeOperation = 'source-over';
            if (operation.borderStyle === 'none') {
                // 无边框，跳过绘制
            } else {
                ctx.strokeStyle = operation.color;
                ctx.lineWidth = operation.width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (operation.borderStyle === 'dashed') {
                    ctx.setLineDash([8, 4]);
                } else {
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.rect(operation.start[0], operation.start[1],
                         operation.end[0] - operation.start[0],
                         operation.end[1] - operation.start[1]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        } else if (operation.type === 'circle') {
            ctx.globalCompositeOperation = 'source-over';
            if (operation.borderStyle === 'none') {
                // 无边框，跳过绘制
            } else {
                ctx.strokeStyle = operation.color;
                ctx.lineWidth = operation.width;
                if (operation.borderStyle === 'dashed') {
                    ctx.setLineDash([8, 4]);
                } else {
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.arc(operation.center[0], operation.center[1], operation.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
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
        } else if (operation.type === 'fill') {
            ctx.globalCompositeOperation = 'source-over';
            // 重放填充操作
            const w = this.mainCanvas.width;
            const h = this.mainCanvas.height;
            const fx = operation.x;
            const fy = operation.y;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) {
                const imageData = ctx.getImageData(0, 0, w, h);
                const data = imageData.data;
                const fillColor = this._hexToRgba(operation.color);
                const startIdx = (fy * w + fx) * 4;
                const startR = data[startIdx], startG = data[startIdx+1], startB = data[startIdx+2], startA = data[startIdx+3];
                const tolerance = operation.tolerance || 30;

                if (!(startR === fillColor.r && startG === fillColor.g && startB === fillColor.b && startA === fillColor.a)) {
                    const stack = [[fx, fy]];
                    const visited = new Uint8Array(w * h);
                    const matchColor = (idx) => {
                        return Math.abs(data[idx] - startR) <= tolerance &&
                               Math.abs(data[idx+1] - startG) <= tolerance &&
                               Math.abs(data[idx+2] - startB) <= tolerance &&
                               Math.abs(data[idx+3] - startA) <= tolerance;
                    };
                    while (stack.length > 0) {
                        const [cx2, cy2] = stack.pop();
                        if (cx2 < 0 || cx2 >= w || cy2 < 0 || cy2 >= h) continue;
                        const pi = cy2 * w + cx2;
                        if (visited[pi]) continue;
                        const di = pi * 4;
                        if (!matchColor(di)) continue;
                        visited[pi] = 1;
                        data[di] = fillColor.r; data[di+1] = fillColor.g; data[di+2] = fillColor.b; data[di+3] = fillColor.a;
                        stack.push([cx2+1,cy2],[cx2-1,cy2],[cx2,cy2+1],[cx2,cy2-1]);
                    }
                    ctx.putImageData(imageData, 0, 0);
                }
            }
        } else if (operation.type === 'brush') {
            ctx.globalCompositeOperation = 'source-over';
            const brush = operation.brush;
            if (brush === 'spray') {
                ctx.fillStyle = operation.color;
                const dotSize = operation.dotSize || 1;
                for (const d of operation.dots) {
                    ctx.beginPath();
                    ctx.arc(d.x, d.y, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (brush === 'crayon' || brush === 'pencil' || brush === 'marker') {
                ctx.strokeStyle = operation.color;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.globalAlpha = operation.alpha || 1;
                if (brush === 'marker') {
                    ctx.lineWidth = operation.width * 3;
                } else if (brush === 'crayon') {
                    ctx.lineWidth = operation.width * 2.5;
                } else {
                    ctx.lineWidth = Math.max(1, operation.width * 0.6);
                }
                if (operation.points && operation.points.length > 0) {
                    ctx.beginPath();
                    ctx.moveTo(operation.points[0].x, operation.points[0].y);
                    for (let i = 1; i < operation.points.length; i++) {
                        ctx.lineTo(operation.points[i].x, operation.points[i].y);
                    }
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            } else if (operation.segments && operation.segments.length > 0) {
                // inkbrush / pen / oil / watercolor
                ctx.fillStyle = operation.color;
                ctx.strokeStyle = operation.color;
                for (const s of operation.segments) {
                    const dx = s.x2 - s.x1;
                    const dy = s.y2 - s.y1;
                    const len = Math.max(1, Math.sqrt(dx*dx + dy*dy));
                    const nx = -dy / len;
                    const ny = dx / len;
                    const w1 = s.w1 || s.w;
                    const w2 = s.w2 || s.w;

                    if (brush === 'watercolor') {
                        ctx.save();
                        ctx.globalAlpha = 0.25;
                        ctx.beginPath();
                        ctx.moveTo(s.x1 + nx*w1/2, s.y1 + ny*w1/2);
                        ctx.lineTo(s.x2 + nx*w2/2, s.y2 + ny*w2/2);
                        ctx.lineTo(s.x2 - nx*w2/2, s.y2 - ny*w2/2);
                        ctx.lineTo(s.x1 - nx*w1/2, s.y1 - ny*w1/2);
                        ctx.closePath();
                        ctx.fill();
                        ctx.globalAlpha = 0.1;
                        const spread = w2 * 0.4;
                        ctx.beginPath();
                        ctx.moveTo(s.x1 + nx*(w1+spread)/2, s.y1 + ny*(w1+spread)/2);
                        ctx.lineTo(s.x2 + nx*(w2+spread)/2, s.y2 + ny*(w2+spread)/2);
                        ctx.lineTo(s.x2 - nx*(w2+spread)/2, s.y2 - ny*(w2+spread)/2);
                        ctx.lineTo(s.x1 - nx*(w1+spread)/2, s.y1 - ny*(w1+spread)/2);
                        ctx.closePath();
                        ctx.fill();
                        ctx.restore();
                    } else if (brush === 'oil') {
                        ctx.save();
                        ctx.globalAlpha = 0.85;
                        ctx.beginPath();
                        ctx.moveTo(s.x1 + nx*w1/2, s.y1 + ny*w1/2);
                        ctx.lineTo(s.x2 + nx*w2/2, s.y2 + ny*w2/2);
                        ctx.lineTo(s.x2 - nx*w2/2, s.y2 - ny*w2/2);
                        ctx.lineTo(s.x1 - nx*w1/2, s.y1 - ny*w1/2);
                        ctx.closePath();
                        ctx.fill();
                        ctx.restore();
                    } else {
                        // inkbrush / pen
                        ctx.beginPath();
                        ctx.moveTo(s.x1 + nx*w1/2, s.y1 + ny*w1/2);
                        ctx.lineTo(s.x2 + nx*w2/2, s.y2 + ny*w2/2);
                        ctx.lineTo(s.x2 - nx*w2/2, s.y2 - ny*w2/2);
                        ctx.lineTo(s.x1 - nx*w1/2, s.y1 - ny*w1/2);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
            }
        } else if (operation.type === 'shape') {
            ctx.globalCompositeOperation = 'source-over';
            if (operation.borderStyle === 'none') {
                // 无边框，跳过绘制
            } else {
                ctx.strokeStyle = operation.color;
                ctx.lineWidth = operation.width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (operation.borderStyle === 'dashed') {
                    ctx.setLineDash([8, 4]);
                } else {
                    ctx.setLineDash([]);
                }
                this.drawShapePath(ctx, operation.shape, operation.start[0], operation.start[1],
                    operation.end[0], operation.end[1]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // 恢复 Canvas Transform
        if (hasTransform) {
            ctx.restore();
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

        if (op.type === 'batch_rotate') {
            // 撤销旋转 = 恢复旋转前的操作数据（包括 rotation/transformOrigin 等属性）
            for (const oldOp of op.oldOps) {
                const current = this.operations.find(o => o.id === oldOp.id);
                if (current) {
                    // 删除可能新增的属性，然后恢复旧值
                    delete current.rotation;
                    delete current.flipH;
                    delete current.flipV;
                    delete current.transformOrigin;
                    Object.assign(current, oldOp);
                }
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销旋转');
            return;
        }

        if (op.type === 'batch_flip') {
            // 撤销翻转 = 恢复翻转前的操作数据（包括 flipH/flipV/transformOrigin 等属性）
            for (const oldOp of op.oldOps) {
                const current = this.operations.find(o => o.id === oldOp.id);
                if (current) {
                    delete current.rotation;
                    delete current.flipH;
                    delete current.flipV;
                    delete current.transformOrigin;
                    Object.assign(current, oldOp);
                }
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销翻转');
            return;
        }

        if (op.type === 'batch_border') {
            // 撤销边框 = 恢复原来的边框样式
            for (const oldInfo of op.oldOps) {
                const current = this.operations.find(o => o.id === oldInfo.id);
                if (current) current.borderStyle = oldInfo.borderStyle;
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销边框');
            return;
        }

        if (op.type === 'batch_resize') {
            // 撤销缩放/拉伸 = 恢复原始操作数据
            for (const oldInfo of op.oldOps) {
                const current = this.operations.find(o => o.id === oldInfo.id);
                if (current) {
                    delete current.rotation;
                    delete current.flipH;
                    delete current.flipV;
                    delete current.transformOrigin;
                    Object.assign(current, JSON.parse(JSON.stringify(oldInfo)));
                }
            }
            this.redrawAll();
            if (window.socketManager) {
                window.socketManager.sendBatchUndo(op.id, op);
            }
            console.log('[WB] 撤销缩放/拉伸');
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

    // 远程批量变换（旋转/翻转/边框）
    remoteBatchTransform(opIds, transformType, params) {
        if (transformType === 'rotate') {
            const rad = params.angle * Math.PI / 180;
            for (const op of this.operations) {
                if (opIds.includes(op.id)) {
                    this._applyRotationToOp(op, params.cx, params.cy, rad);
                }
            }
        } else if (transformType === 'flip') {
            for (const op of this.operations) {
                if (opIds.includes(op.id)) {
                    this._applyFlipToOp(op, params.cx, params.cy, params.axis);
                }
            }
        } else if (transformType === 'border') {
            for (const op of this.operations) {
                if (opIds.includes(op.id)) {
                    op.borderStyle = params.borderStyle;
                }
            }
        } else if (transformType === 'resize') {
            // 远程缩放/拉伸
            const dx = params.dx;
            const dy = params.dy;
            const startBounds = params.startBounds;
            const handle = params.handle;
            const oldW = startBounds.maxX - startBounds.minX;
            const oldH = startBounds.maxY - startBounds.minY;
            const newBounds = this._calcResizedBounds(handle, startBounds, dx, dy);
            const newW = newBounds.maxX - newBounds.minX;
            const newH = newBounds.maxY - newBounds.minY;

            for (const op of this.operations) {
                if (!opIds.includes(op.id)) continue;
                const origBounds = this.getOpBounds(op);
                if (!origBounds) continue;
                const relX = (origBounds.x - startBounds.minX) / (oldW || 1);
                const relY = (origBounds.y - startBounds.minY) / (oldH || 1);
                const relW = origBounds.w / (oldW || 1);
                const relH = origBounds.h / (oldH || 1);
                const destX = newBounds.minX + relX * newW;
                const destY = newBounds.minY + relY * newH;
                const destW = relW * newW;
                const destH = relH * newH;
                this._scaleOp(op, JSON.parse(JSON.stringify(op)), origBounds, destX, destY, destW, destH);
            }
        }
        this.redrawAll();
        console.log('[WB] 远程批量变换:', transformType, opIds.length, '个操作');
    }

    // 加载快照
    loadSnapshot(snapshot) {
        if (snapshot && snapshot.objects) {
            this.operations = snapshot.objects;
            this.redrawAll();
            console.log('[WB] 加载快照, 操作数:', this.operations.length);
        }
    }

    // ========== 导出图片 ==========
    async exportImage(format = 'png') {
        // 创建临时画布，确保白底
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.mainCanvas.width;
        tempCanvas.height = this.mainCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // 填充白色背景
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // 绘制主画布内容
        tempCtx.drawImage(this.mainCanvas, 0, 0);

        // 根据格式导出
        const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const quality = format === 'jpg' ? 0.92 : undefined;
        const ext = format === 'jpg' ? 'jpg' : 'png';

        // 默认文件名
        const roomName = window.ROOM_NAME || 'whiteboard';
        const timestamp = new Date().toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }).replace(/[\/\s:]/g, '-');
        const defaultName = `${roomName}_${timestamp}.${ext}`;

        // 生成 Blob
        const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, mimeType, quality));

        let saved = false;

        // 尝试使用 File System Access API（弹出系统原生另存为对话框）
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: format === 'jpg' ? [{
                        description: 'JPEG 图片',
                        accept: { 'image/jpeg': ['.jpg', '.jpeg'] }
                    }] : [{
                        description: 'PNG 图片',
                        accept: { 'image/png': ['.png'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                saved = true;
                showToast(`已导出为 ${ext.toUpperCase()} 图片`);
            } catch (e) {
                // 用户取消保存对话框
                if (e.name === 'AbortError') {
                    console.log('[WB] 用户取消导出');
                    return;
                }
                console.warn('[WB] showSaveFilePicker 失败，回退到传统下载:', e);
            }
        }

        // 回退：传统 <a download> 方式
        if (!saved) {
            const dataURL = tempCanvas.toDataURL(mimeType, quality);
            const link = document.createElement('a');
            link.download = defaultName;
            link.href = dataURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast(`已导出为 ${ext.toUpperCase()} 图片`);
        }

        // 上传到服务器本地缓存
        try {
            const dataURL = tempCanvas.toDataURL(mimeType, quality);
            const res = await fetch(`/api/rooms/${window.ROOM_ID}/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: dataURL, format: format })
            });
            const result = await res.json();
            if (result.code === 'SUCCESS') {
                console.log('[WB] 已缓存到服务器:', result.data.filename);
            }
        } catch (e) {
            console.warn('[WB] 服务器缓存失败:', e);
        }

        console.log('[WB] 导出图片:', ext, tempCanvas.width, 'x', tempCanvas.height);
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
