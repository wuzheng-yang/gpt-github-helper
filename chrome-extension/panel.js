// panel.js
// 负责右下角 GitHub 确认面板。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  let panel = null;
  let onConfirmAllow = null;

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function createPanel() {
    if (panel) {
      return panel;
    }

    panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.bottom = '20px';
    panel.style.zIndex = '999999';
    panel.style.width = '370px';
    panel.style.padding = '14px';
    panel.style.borderRadius = '12px';
    panel.style.background = '#1f1f1f';
    panel.style.color = '#fff';
    panel.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
    panel.style.fontSize = '14px';
    panel.style.lineHeight = '1.5';
    panel.style.display = 'none';

    document.body.appendChild(panel);
    return panel;
  }

  function renderPanel(checkResult) {
    const p = createPanel();

    const statusText = checkResult.ok ? '白名单通过' : '白名单未通过';
    const statusColor = checkResult.ok ? '#4ade80' : '#f87171';

    const reasonsHtml = checkResult.reasons.length
      ? checkResult.reasons.map(item => `<li>${escapeHtml(item)}</li>`).join('')
      : '<li>仓库、分支、操作类型、路径均已通过</li>';

    p.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 8px;">
        GitHub 工具确认请求
      </div>

      <div style="margin-bottom: 8px; color: ${statusColor}; font-weight: 700;">
        ${statusText}
      </div>

      <div style="margin-bottom: 8px; color: #ddd; word-break: break-all;">
        文件：${escapeHtml(checkResult.filePath || '未识别')}
      </div>

      <ul style="margin: 0 0 12px 18px; padding: 0; color: #ccc;">
        ${reasonsHtml}
      </ul>

      <div style="font-size: 12px; color: #aaa; margin-bottom: 12px;">
        快捷键：Alt + A
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="gpt-helper-hide"
          style="
            padding: 6px 12px;
            border-radius: 8px;
            border: 1px solid #555;
            background: transparent;
            color: #fff;
            cursor: pointer;
          ">
          关闭
        </button>

        <button id="gpt-helper-allow"
          ${checkResult.ok ? '' : 'disabled'}
          style="
            padding: 6px 12px;
            border-radius: 8px;
            border: none;
            background: ${checkResult.ok ? '#fff' : '#555'};
            color: ${checkResult.ok ? '#111' : '#999'};
            cursor: ${checkResult.ok ? 'pointer' : 'not-allowed'};
            font-weight: 700;
          ">
          确认允许
        </button>
      </div>
    `;

    p.querySelector('#gpt-helper-hide').onclick = hidePanel;

    p.querySelector('#gpt-helper-allow').onclick = () => {
      if (onConfirmAllow) {
        onConfirmAllow();
      }
    };

    p.style.display = 'block';
  }

  function hidePanel() {
    if (panel) {
      panel.style.display = 'none';
    }
  }

  function setConfirmHandler(handler) {
    onConfirmAllow = handler;
  }

  window.GptGithubHelper.panel = {
    createPanel,
    renderPanel,
    hidePanel,
    setConfirmHandler
  };
})();
