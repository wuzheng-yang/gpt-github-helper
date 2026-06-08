// panel.js
// -----------------------------------------------------------------------------
// GitHub 工具确认面板模块。
//
// 这个文件只负责“创建和渲染右侧中间弹窗”。
// 它不负责：
// - 识别 GitHub 工具请求
// - 执行配置校验
// - 点击 ChatGPT 页面原生 Allow 按钮
//
// 调用链路：
// content.js.handleGithubPrompt()
//   -> safety_check.js checkSafety(text)
//   -> panel.renderPanel(checkResult)
//   -> 用户点击“仍然确认”时回调 content.js.confirmAllow(true)
//
// 面板定位在右侧中间，避免遮挡 ChatGPT 页面底部输入框。
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  // 面板 DOM 缓存。
  // 第一次调用 createPanel() 时创建，后续复用同一个 DOM，避免重复插入多个面板。
  let panel = null;

  // 点击确认按钮时执行的回调。
  // 这个回调由 content.js 注入，因为真正点击 Allow 按钮的逻辑在 content.js 里。
  let onConfirmAllow = null;

  /**
   * HTML 转义。
   *
   * @param {string} str 原始字符串
   * @returns {string} 转义后的安全字符串
   *
   * 为什么需要转义：
   * 文件路径、失败原因来自页面文本或配置文本，如果直接拼进 innerHTML，
   * 里面包含 < > & " ' 时可能导致 HTML 显示错乱。
   *
   * 这里不是为了复杂安全场景，只是保证本地工具显示稳定。
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
   * 返回：
   * - 已存在：直接返回旧面板
   * - 不存在：创建 div，设置固定样式，插入 document.body
   *
   * 面板样式说明：
   * - position: fixed：固定在浏览器可视区域
   * - right: 20px：距离右侧 20px
   * - top: 50% + translateY(-50%)：垂直居中
   * - zIndex: 999999：尽量盖在 ChatGPT 页面上层
   * - maxHeight + overflowY：内容太多时面板内部滚动
   */
  function createPanel() {
    if (panel) {
      return panel;
    }

    panel = document.createElement('div');

    // 固定在页面右侧中间。
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.top = '50%';
    panel.style.transform = 'translateY(-50%)';

    // 保证盖在 ChatGPT 页面大部分元素之上。
    panel.style.zIndex = '999999';

    // 控制面板尺寸。
    panel.style.width = '390px';
    panel.style.maxHeight = '70vh';
    panel.style.overflowY = 'auto';

    // 面板外观。
    panel.style.padding = '14px';
    panel.style.borderRadius = '12px';
    panel.style.background = '#1f1f1f';
    panel.style.color = '#fff';
    panel.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
    panel.style.fontSize = '14px';
    panel.style.lineHeight = '1.5';

    // 默认隐藏，只有 renderPanel() 时显示。
    panel.style.display = 'none';

    document.body.appendChild(panel);
    return panel;
  }

  /**
   * 渲染 GitHub 确认面板。
   *
   * @param {object} checkResult 配置校验结果
   * @param {boolean} checkResult.ok 是否通过配置校验
   * @param {string} checkResult.filePath 识别到的 GitHub 文件路径
   * @param {string[]} checkResult.reasons 未通过原因列表
   *
   * 显示逻辑：
   * - ok=true：显示“配置校验通过”，按钮文字为“自动确认中”
   * - ok=false：显示“配置校验未通过”，按钮文字为“仍然确认”
   *
   * 注意：
   * ok=true 时真正自动确认由 content.js.scheduleAutoConfirm() 执行。
   * 面板按钮只是给用户一个手动入口，尤其用于 ok=false 时强制继续。
   */
  function renderPanel(checkResult) {
    const p = createPanel();

    const ok = Boolean(checkResult.ok);

    const statusText = ok ? '配置校验通过' : '配置校验未通过';
    const statusColor = ok ? '#4ade80' : '#f87171';

    const buttonText = ok ? '自动确认中' : '仍然确认';
    const buttonBackground = ok ? '#ffffff' : '#f97316';
    const buttonColor = '#111111';

    // 未通过原因列表。
    // 如果 reasons 为空，说明仓库、操作、分支、路径等都没有失败原因。
    const reasonsHtml = checkResult.reasons && checkResult.reasons.length
      ? checkResult.reasons.map(item => `<li>${escapeHtml(item)}</li>`).join('')
      : '<li>仓库、操作类型已通过，分支和路径未命中禁止项</li>';

    // 未通过时额外显示一块提示区域，提醒用户检查当前请求。
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
          当前请求未通过配置校验。确认前请检查仓库、分支、操作类型和文件路径。
        </div>
      `;

    // 使用 innerHTML 渲染整个面板，方便一次性更新状态。
    // 所有动态文本都经过 escapeHtml，避免路径或原因里的特殊字符破坏 HTML。
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
        ${ok ? '配置校验通过后会自动确认。' : '配置校验未通过时，需要手动点击“仍然确认”。'}
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

    // 关闭按钮只隐藏面板，不影响 ChatGPT 原生确认卡片。
    hideButton.onclick = hidePanel;

    // 确认按钮交给 content.js 注入的回调处理。
    // content.js 会决定是普通确认还是 force=true 的强制确认。
    allowButton.onclick = () => {
      if (onConfirmAllow) {
        onConfirmAllow();
      }
    };

    p.style.display = 'block';
  }

  /**
   * 隐藏面板。
   *
   * 注意：
   * 这里只是 display:none，不删除 DOM。
   * 下次 renderPanel() 会复用同一个面板。
   */
  function hidePanel() {
    if (panel) {
      panel.style.display = 'none';
    }
  }

  /**
   * 设置确认按钮点击回调。
   *
   * @param {Function} handler 点击确认时执行的函数
   *
   * 由 content.js 调用：
   * panel.setConfirmHandler(() => confirmAllow(true))
   */
  function setConfirmHandler(handler) {
    onConfirmAllow = handler;
  }

  // 暴露给 content.js 使用。
  window.GptGithubHelper.panel = {
    createPanel,
    renderPanel,
    hidePanel,
    setConfirmHandler
  };
})();
