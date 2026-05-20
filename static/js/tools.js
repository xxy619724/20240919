// ========== 绘图工具管理 ==========

class ToolManager {
    constructor() {
        this.currentTool = 'pen';
        this.currentColor = '#000000';
        this.currentWidth = 2;
        this.bindToolbar();
    }

    bindToolbar() {
        // 工具按钮切换
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTool = btn.dataset.tool;

                // 切换工具光标：先清除所有特殊模式，再添加当前模式
                const container = document.getElementById('canvas-container');
                if (container) {
                    // 统一清除所有特殊光标 class
                    container.classList.remove('select-mode', 'dragging', 'fill-mode',
                        'eyedropper-mode', 'zoom-mode', 'shape-move-hover',
                        'shape-move-dragging', 'rotate-hover', 'rotating');

                    // 添加当前工具对应的光标模式
                    if (this.currentTool === 'select') {
                        container.classList.add('select-mode');
                    } else if (this.currentTool === 'fill') {
                        container.classList.add('fill-mode');
                    } else if (this.currentTool === 'eyedropper') {
                        container.classList.add('eyedropper-mode');
                    } else if (this.currentTool === 'zoom') {
                        container.classList.add('zoom-mode');
                    }
                }

                // 非选择/形状/画笔工具时清除选中
                if (this.currentTool !== 'select' && this.currentTool !== 'shape' && this.currentTool !== 'brush' && window.wb) {
                    window.wb.clearSelection();
                    window.wb.clearShapeSelection();
                }

                // 形状工具：打开/切换形状弹出框
                if (this.currentTool === 'shape') {
                    toggleShapePanel();
                } else {
                    closeShapePanel();
                }

                // 画笔工具：打开/切换画笔弹出框
                if (this.currentTool === 'brush') {
                    toggleBrushPanel();
                } else {
                    closeBrushPanel();
                }

                // 缩放工具：显示/隐藏缩放控制条
                const zoomCtrl = document.getElementById('zoom-control');
                if (zoomCtrl) {
                    zoomCtrl.style.display = (this.currentTool === 'zoom') ? 'flex' : 'none';
                }
            });
        });

        // 颜色预设切换
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentColor = btn.dataset.color;
                document.getElementById('custom-color').value = this.currentColor;
            });
        });

        // 自定义颜色
        document.getElementById('custom-color').addEventListener('input', (e) => {
            this.currentColor = e.target.value;
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        });

        // 线宽调节
        const widthSlider = document.getElementById('line-width');
        const widthValue = document.getElementById('width-value');
        widthSlider.addEventListener('input', (e) => {
            this.currentWidth = parseInt(e.target.value);
            widthValue.textContent = this.currentWidth;
        });
    }

    getTool() { return this.currentTool; }
    getColor() { return this.currentColor; }
    getWidth() { return this.currentWidth; }
}
