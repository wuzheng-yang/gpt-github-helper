// panel.js
// 负责右侧中间 GitHub 确认面板。
// 功能：
// 1. 安全校验通过：显示绿色状态，按钮为“确认允许”
// 2. 安全校验不通过：显示红色状态，列出原因，按钮为“仍然确认”
// 3. 面板固定在右侧中间，避免遮挡页面底部

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  // 面板 DOM
  let panel = null;

  // 点击确认按钮时由 content.js 注入的回调
  let onConfirmAllow = null;

  /**
   * HTML 转义，避免把文件路径或原因直接插入 HTML 导致显示异常。
   */
  function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
  }

  /**
   * 创建右侧中间面板。
   *
   * 位置：
   * - right: 20px
   * - top: 50%
   * - transform: translateY(-50%)
   */
  function createPanel() {
    if (panel) {
      return panel;
    }

    panel = document.createElement('div');

    // 固定在页面右侧中间
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.top = '50%';
    panel.style.transform = 'translateY(-50%)';

    // 保证盖在页面上层
    panel.style.zIndex = '999999';

    // 尺寸和滚动
    panel.style.width = '390px';
    panel.style.maxHeight = '70vh';
    panel.style.overflowY = 'auto';

    // 外观
    panel.style.padding = '14px';
    panel.style.borderRadius = '12px';
    panel.style.background = '#1f1f1f';
    panel.style.color = '#fff';
    panel.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
    panel.style.fontSize = '14px';
    panel.style.lineHeight = '1.5';

    // 默认隐藏
    panel.style.display = 'none';

    document.body.appendChild(panel);
    return panel;
  }

  /**
   * 渲染 GitHub 确认面板。
   *
   * @param {object} checkResult
   * checkResult.ok 是否通过安全校验
   * checkResult.filePath 文件路径
   * checkResult.reasons 未通过原因
   */
  function renderPanel(checkResult) {
    const p = createPanel();

    const ok = Boolean(checkResult.ok);

    const statusText = ok ? '安全校验通过' : '安全校验未通过';
    const statusColor = ok ? '#4ade80' : '#f87171';

    const buttonText = ok ? '确认允许' : '仍然确认';
    const buttonBackground = ok ? '#ffffff' : '#f97316';
    const buttonColor = ok ? '#111111' : '#111111';

    const reasonsHtml = checkResult.reasons && checkResult.reasons.length
        ? checkResult.reasons.map(item => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>仓库、操作类型已通过，分支和路径未命中禁止项</li>';

    const warningHtml = ok
        ? ''
        : `
        <div style="
          margin-bottom: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(249, 115, 22, 0.16);
          color: #fdba74;
          font-size: 13px;
        ">
          当前请求未通过安全校验。确认前请检查仓库、分支、操作类型和文件路径。
        </div>
      `;

    p.innerHTML = `
      <div style="
        font-weight: 700;
        margin-bottom: 8px;
        font-size: 15px;
      ">
        GitHub 工具确认请求
      </div>

      <div style="
        margin-bottom: 8px;
        color: ${statusColor};
        font-weight: 700;
      ">
        ${statusText}
      </div>

      ${warningHtml}

      <div style="
        margin-bottom: 8px;
        color: #ddd;
        word-break: break-all;
      ">
        文件：${escapeHtml(checkResult.filePath || '未识别')}
      </div>

      <ul style="
        margin: 0 0 12px 18px;
        padding: 0;
        color: #ccc;
      ">
        ${reasonsHtml}
      </ul>

      <div style="
        font-size: 12px;
        color: #aaa;
        margin-bottom: 12px;
      ">
        快捷键：Alt + A，仅用于安全校验通过的请求。
      </div>

      <div style="
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      ">
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
          style="
            padding: 6px 12px;
            border-radius: 8px;
            border: none;
            background: ${buttonBackground};
            color: ${buttonColor};
            cursor: pointer;
            font-weight: 700;
          ">
          ${buttonText}
        </button>
      </div>
    `;

    const hideButton = p.querySelector('#gpt-helper-hide');
    const allowButton = p.querySelector('#gpt-helper-allow');

    hideButton.onclick = hidePanel;

    allowButton.onclick = () => {
      if (onConfirmAllow) {
        onConfirmAllow();
      }
    };

    p.style.display = 'block';
  }

  /**
   * 隐藏面板。
   */
  function hidePanel() {
    if (panel) {
      panel.style.display = 'none';
    }
  }

  /**
   * 设置确认按钮点击回调。
   *
   * 由 content.js 调用：
   * panel.setConfirmHandler(() => confirmAllow(true))
   */
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
