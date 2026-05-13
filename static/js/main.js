// ========== 全局工具函数 ==========

// 显示提示消息
function showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    toast.innerHTML = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}

// 登出
async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (e) {
        showToast('登出失败');
    }
}

// 复制链接
function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        showToast('链接已复制');
    }).catch(() => {
        // fallback
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('链接已复制');
    });
}
