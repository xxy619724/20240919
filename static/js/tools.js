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

                // 切换选择工具光标
                const container = document.getElementById('canvas-container');
                if (container) {
                    if (this.currentTool === 'select') {
                        container.classList.add('select-mode');
                    } else {
                        container.classList.remove('select-mode');
                        container.classList.remove('dragging');
                    }
                }

                // 非选择工具时清除选中
                if (this.currentTool !== 'select' && window.wb) {
                    window.wb.clearSelection();
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
