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
  let settingsButtonHost = null;
  let settingsButton = null;
  let settingsFrame = null;
  let settingsFrameBody = null;
  let settingsPanel = null;
  let usageRefreshTimer = null;
  let settingsPanelWidth = 440;

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

  function getRuntimeSettings() {
    return window.GptGithubHelper && window.GptGithubHelper.runtimeSettings;
  }

  function createSettingsButtonStyleText() {
    return `
      :host {
        all: initial;
      }

      @keyframes gpt-helper-card-in {
        0% {
          opacity: 0;
          transform: translateY(-50%) translateX(18px);
        }
        100% {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }
      }

      @keyframes gpt-helper-dot-breathe {
        0%, 100% {
          opacity: 0.58;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.24);
        }
      }

      @keyframes gpt-helper-value-pop {
        0% {
          transform: translateY(2px) scale(0.96);
          opacity: 0.45;
        }
        100% {
          transform: translateY(0) scale(1);
          opacity: 1;
        }
      }

      @keyframes gpt-helper-shimmer {
        0%, 100% {
          opacity: 0.55;
        }
        50% {
          opacity: 1;
        }
      }

      .gpt-helper-floating-wrap {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        pointer-events: none;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #0d0d0d;
      }

      .gpt-helper-usage-card {
        position: absolute;
        top: 50%;
        right: 0;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        box-sizing: border-box;
        width: 78px;
        min-height: 128px;
        padding: 18px 9px 14px;
        border: 1px solid #e4e4e7;
        border-right: none;
        border-radius: 8px 0 0 8px;
        background: #ffffff;
        color: #0d0d0d;
        box-shadow: -3px 0 16px rgba(0, 0, 0, 0.05);
        cursor: pointer;
        overflow: hidden;
        text-align: center;
        letter-spacing: 0;
        animation: gpt-helper-card-in 360ms cubic-bezier(.2, 0, 0, 1) both;
        transition:
          transform 180ms ease,
          background 180ms ease,
          border-color 180ms ease,
          box-shadow 180ms ease;
        will-change: transform;
      }

      .gpt-helper-usage-card:hover {
        transform: translateY(-50%) translateX(-2px) !important;
        border-color: #d4d4d8 !important;
        background: #f4f4f5 !important;
      }

      .gpt-helper-usage-card.gpt-helper-hidden {
        display: none;
      }

      .gpt-helper-usage-band {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: #5b7c5a;
        transition: background 0.2s ease;
      }

      .gpt-helper-usage-dot {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #5b7c5a;
        opacity: 0.85;
        animation: gpt-helper-dot-breathe 1.8s ease-in-out infinite;
        transform-origin: center;
        pointer-events: none;
      }

      .gpt-helper-usage-logo {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin-top: 2px;
        border: 1px solid #0d0d0d;
        border-radius: 3px;
        color: #0d0d0d;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 13px;
        font-style: italic;
        font-weight: 700;
        line-height: 1;
      }

      .gpt-helper-plan {
        color: #0d0d0d;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 13px;
        font-style: italic;
        font-weight: 600;
        line-height: 1;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .gpt-helper-usage-main {
        display: inline-flex;
        align-items: baseline;
        justify-content: center;
        gap: 0;
        min-height: 24px;
        color: #496a48;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 22px;
        font-weight: 700;
        font-variant-numeric: tabular-nums lining-nums;
        line-height: 1;
      }

      .gpt-helper-usage-label {
        color: #71717a;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.14em;
        line-height: 1;
      }

      .gpt-helper-usage-detail {
        display: grid;
        width: 100%;
        gap: 3px;
        margin-top: 3px;
        padding-top: 7px;
        border-top: 1px solid #e4e4e7;
      }

      .gpt-helper-usage-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        width: 100%;
        min-width: 0;
      }

      .gpt-helper-usage-row-label {
        color: #71717a;
        font-size: 10px;
        line-height: 1.15;
        white-space: nowrap;
      }

      .gpt-helper-usage-row-value {
        display: inline-flex;
        align-items: baseline;
        justify-content: flex-end;
        min-width: 26px;
        color: #496a48;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums lining-nums;
        line-height: 1.15;
      }

      .gpt-helper-usage-value-pop {
        animation: gpt-helper-value-pop 260ms cubic-bezier(.2, 0, 0, 1) both;
      }

      .gpt-helper-usage-loading {
        animation: gpt-helper-shimmer 1.45s ease-in-out infinite;
      }

      .gpt-helper-tone-warning .gpt-helper-usage-band,
      .gpt-helper-tone-warning .gpt-helper-usage-dot {
        background: #a76b2e;
      }

      .gpt-helper-tone-danger .gpt-helper-usage-band,
      .gpt-helper-tone-danger .gpt-helper-usage-dot {
        background: #a24141;
      }

      .gpt-helper-tone-unknown .gpt-helper-usage-band,
      .gpt-helper-tone-unknown .gpt-helper-usage-dot {
        background: #d4d4d8;
      }

      .gpt-helper-tone-warning [data-usage-value] {
        color: #a76b2e;
      }

      .gpt-helper-tone-danger [data-usage-value] {
        color: #a24141;
      }

      .gpt-helper-tone-unknown [data-usage-value] {
        color: #71717a;
      }

      .gpt-helper-settings-frame {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 440px;
        max-width: calc(100vw - 20px);
        pointer-events: auto;
        display: flex;
        flex-direction: row;
        border-left: 1px solid #e4e4e7;
        background: #f9f9f9;
        box-shadow: -8px 0 40px rgba(0, 0, 0, 0.06);
      }

      .gpt-helper-settings-frame.gpt-helper-hidden {
        display: none;
      }

      .gpt-helper-settings-resize {
        position: relative;
        flex: 0 0 5px;
        cursor: ew-resize;
        background: transparent;
      }

      .gpt-helper-settings-resize::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 1px;
        width: 2px;
        height: 40px;
        border-radius: 2px;
        background: transparent;
        transform: translateY(-50%);
        transition: background 0.15s ease;
      }

      .gpt-helper-settings-resize:hover::after {
        background: #d4d4d8;
      }

      .gpt-helper-settings-body {
        box-sizing: border-box;
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        overflow-y: auto;
        padding: 14px;
        background: #100f0d;
        color: #f2eadf;
        font-size: 14px;
        line-height: 1.5;
      }

      @media (prefers-color-scheme: dark) {
        .gpt-helper-usage-card {
          border-color: #2a2824;
          background: #1c1a17;
          color: #e8e5de;
          box-shadow: -3px 0 16px rgba(0, 0, 0, 0.25);
        }

        .gpt-helper-usage-card:hover {
          border-color: #3a3732 !important;
          background: #141311 !important;
        }

        .gpt-helper-usage-logo {
          border-color: #e8e5de;
          color: #e8e5de;
        }

        .gpt-helper-plan {
          color: #e8e5de;
        }

        .gpt-helper-usage-main,
        .gpt-helper-usage-row-value {
          color: #b5ceb4;
        }

        .gpt-helper-usage-label,
        .gpt-helper-usage-row-label {
          color: #656159;
        }

        .gpt-helper-usage-detail {
          border-top-color: #2a2824;
        }

        .gpt-helper-usage-band,
        .gpt-helper-usage-dot {
          background: #89a887;
        }

        .gpt-helper-tone-warning .gpt-helper-usage-band,
        .gpt-helper-tone-warning .gpt-helper-usage-dot {
          background: #d89a5c;
        }

        .gpt-helper-tone-danger .gpt-helper-usage-band,
        .gpt-helper-tone-danger .gpt-helper-usage-dot {
          background: #d07979;
        }

        .gpt-helper-tone-unknown .gpt-helper-usage-band,
        .gpt-helper-tone-unknown .gpt-helper-usage-dot {
          background: #3a3732;
        }

        .gpt-helper-tone-warning [data-usage-value] {
          color: #d89a5c;
        }

        .gpt-helper-tone-danger [data-usage-value] {
          color: #d07979;
        }

        .gpt-helper-tone-unknown [data-usage-value] {
          color: #656159;
        }

        .gpt-helper-settings-frame {
          border-left-color: #2a2824;
          background: #141311;
          box-shadow: -8px 0 40px rgba(0, 0, 0, 0.35);
        }

        .gpt-helper-settings-resize:hover::after {
          background: #3a3732;
        }
      }
    `;
  }

  function createButtonStyle() {
    return `
      padding: 7px 12px;
      border-radius: 6px;
      border: 1px solid rgba(214, 222, 205, 0.18);
      background: rgba(255,255,255,0.03);
      color: #d6d0c7;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
    `;
  }

  function createPrimaryButtonStyle() {
    return `
      padding: 7px 14px;
      border-radius: 6px;
      border: 1px solid rgba(204, 232, 201, 0.2);
      background: #cce8c9;
      color: #11100f;
      cursor: pointer;
      font-weight: 700;
      font-size: 12px;
      line-height: 1.2;
      transition: filter 0.16s ease, transform 0.16s ease;
    `;
  }

  function createField(label, name, value, options = {}) {
    const helpText = options.helpText
      ? `<div style="margin-top: 5px; color: #8d877f; font-size: 11px; line-height: 1.35;">${escapeHtml(options.helpText)}</div>`
      : '';
    const controlStyle = `
      box-sizing: border-box;
      width: 100%;
      padding: 8px 9px;
      border-radius: 7px;
      border: 1px solid rgba(214, 222, 205, 0.16);
      background: rgba(0, 0, 0, 0.24);
      color: #f2eadf;
      line-height: 1.45;
      font: inherit;
      font-size: 12px;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    `;

    const controlHtml = options.multiline
      ? `
        <textarea data-setting-field="${escapeHtml(name)}" rows="${options.rows || 4}" style="
          ${controlStyle}
          resize: vertical;
          min-height: ${options.minHeight || 64}px;
        ">${escapeHtml(value)}</textarea>
      `
      : `
        <input data-setting-field="${escapeHtml(name)}" value="${escapeHtml(value)}" style="
          ${controlStyle}
        ">
      `;

    return `
      <label style="display: block;">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
          <span style="color: #d6d0c7; font-size: 12px; font-weight: 700;">${escapeHtml(label)}</span>
          ${options.badge ? `<span style="color: #8d877f; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;">${escapeHtml(options.badge)}</span>` : ''}
        </div>
        ${controlHtml}
        ${helpText}
      </label>
    `;
  }

  function createSettingsSection(index, title, bodyHtml) {
    return `
      <section style="
        border: 1px solid rgba(214, 222, 205, 0.12);
        border-radius: 9px;
        background: rgba(255,255,255,0.025);
        overflow: hidden;
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 10px;
          border-bottom: 1px solid rgba(214, 222, 205, 0.1);
        ">
          <span style="
            color: #8bab8a;
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 15px;
            font-weight: 800;
            line-height: 1;
          ">${escapeHtml(index)}</span>
          <span style="color: #f2eadf; font-size: 13px; font-weight: 700;">${escapeHtml(title)}</span>
        </div>
        <div style="display: grid; gap: 12px; padding: 11px 10px;">
          ${bodyHtml}
        </div>
      </section>
    `;
  }

  function listToText(list) {
    return Array.isArray(list) ? list.join('\n') : '';
  }

  function textToList(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function readSettingValue(name) {
    const field = settingsPanel && settingsPanel.querySelector(`[data-setting-field="${name}"]`);
    return field ? field.value : '';
  }

  function setSettingsCardText(selector, text) {
    if (!settingsButton) {
      return;
    }

    const element = settingsButton.querySelector(selector);
    if (element) {
      const nextText = String(text);
      if (element.textContent !== nextText) {
        element.textContent = nextText;
        element.classList.remove('gpt-helper-usage-value-pop');
        void element.offsetWidth;
        element.classList.add('gpt-helper-usage-value-pop');
      }
    }
  }

  function setPercentText(selector, text) {
    if (!settingsButton) {
      return;
    }

    const element = settingsButton.querySelector(selector);
    if (!element) {
      return;
    }

    const value = String(text || '--');
    const match = value.match(/^(\d+)(%)$/);
    const nextHtml = match
      ? `<span>${escapeHtml(match[1])}</span><span style="font-size: 0.7em; line-height: 1; transform: translateY(-0.03em);">${match[2]}</span>`
      : `<span>${escapeHtml(value)}</span>`;

    if (element.innerHTML !== nextHtml) {
      element.innerHTML = nextHtml;
      element.classList.remove('gpt-helper-usage-value-pop');
      void element.offsetWidth;
      element.classList.add('gpt-helper-usage-value-pop');
    }
  }

  function setSettingsCardTone(tone) {
    if (!settingsButton) {
      return;
    }

    settingsButton.classList.remove(
      'gpt-helper-tone-normal',
      'gpt-helper-tone-warning',
      'gpt-helper-tone-danger',
      'gpt-helper-tone-unknown'
    );
    settingsButton.classList.add(`gpt-helper-tone-${tone || 'unknown'}`);
  }

  function renderUsageStatus(status) {
    settingsButton && settingsButton.classList.remove('gpt-helper-usage-loading');
    setSettingsCardText('[data-usage-plan]', status.planText || '未知');
    setPercentText('[data-usage-main]', status.primaryRemainingText || '--');
    setPercentText('[data-usage-primary-value]', status.primaryRemainingText || '--');
    setPercentText('[data-usage-secondary-value]', status.secondaryRemainingText || '--');
    setSettingsCardTone(status.tone || 'unknown');
  }

  function renderUsageLoading() {
    settingsButton && settingsButton.classList.add('gpt-helper-usage-loading');
    setSettingsCardText('[data-usage-plan]', '加载中');
    setPercentText('[data-usage-main]', '--');
    setPercentText('[data-usage-primary-value]', '--');
    setPercentText('[data-usage-secondary-value]', '--');
    setSettingsCardTone('unknown');
  }

  function renderUsageError(error) {
    settingsButton && settingsButton.classList.remove('gpt-helper-usage-loading');
    const text = error && error.status === 401 ? '未登录' : '不可用';
    setSettingsCardText('[data-usage-plan]', text);
    setPercentText('[data-usage-main]', '--');
    setPercentText('[data-usage-primary-value]', '--');
    setPercentText('[data-usage-secondary-value]', '--');
    setSettingsCardTone('unknown');
  }

  function refreshUsageStatus(force = false) {
    const usageStatus = window.GptGithubHelper && window.GptGithubHelper.usageStatus;

    if (!usageStatus || !settingsButton) {
      return;
    }

    if (force) {
      renderUsageLoading();
    }

    usageStatus.fetchStatus(force)
      .then(renderUsageStatus)
      .catch(error => {
        console.warn('[GPT GitHub Helper] 获取 ChatGPT 用量失败：', error);
        renderUsageError(error);
      });
  }

  function startUsageRefresh() {
    refreshUsageStatus(false);

    if (usageRefreshTimer) {
      return;
    }

    usageRefreshTimer = window.setInterval(() => refreshUsageStatus(false), 5 * 60 * 1000);
  }

  function clampSettingsPanelWidth(width) {
    const viewportLimit = Math.max(340, window.innerWidth - 20);
    return Math.max(340, Math.min(viewportLimit, Math.round(width)));
  }

  function applySettingsPanelWidth() {
    if (settingsFrame) {
      settingsFrame.style.width = `${clampSettingsPanelWidth(settingsPanelWidth)}px`;
    }
  }

  function setSettingsPanelOpen(open) {
    if (!settingsFrame || !settingsButton) {
      return;
    }

    settingsFrame.classList.toggle('gpt-helper-hidden', !open);
    settingsButton.classList.toggle('gpt-helper-hidden', open);
    applySettingsPanelWidth();
  }

  function handleSettingsResizeStart(event) {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = settingsPanelWidth;

    const handlePointerMove = moveEvent => {
      settingsPanelWidth = clampSettingsPanelWidth(startWidth + startX - moveEvent.clientX);
      applySettingsPanelWidth();
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function renderSettingsPanel(runtimeConfig, statusText = '') {
    const p = createSettingsPanel();
    const config = runtimeConfig || {};
    const statusHtml = statusText
      ? `<div id="gpt-helper-settings-status" style="margin-right: auto; color: #cce8c9; font-size: 11px; line-height: 1.35;">${escapeHtml(statusText)}</div>`
      : '<div id="gpt-helper-settings-status" style="margin-right: auto; color: #cce8c9; font-size: 11px; line-height: 1.35;"></div>';

    p.innerHTML = `
      <div style="
        position: sticky;
        top: 0;
        z-index: 1;
        margin: -14px -14px 12px;
        padding: 13px 14px 11px;
        border-bottom: 1px solid rgba(214, 222, 205, 0.12);
        background: rgba(16, 15, 13, 0.96);
        backdrop-filter: blur(8px);
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border: 1px solid rgba(255,255,255,0.72);
            border-radius: 4px;
            color: #fff;
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 14px;
            font-style: italic;
            font-weight: 800;
          ">G</span>
          <div style="min-width: 0;">
            <div style="color: #f2eadf; font-family: Georgia, 'Times New Roman', serif; font-size: 17px; font-style: italic; font-weight: 800; line-height: 1.1;">GitHub Helper</div>
            <div style="margin-top: 2px; color: #8d877f; font-size: 11px; line-height: 1.2;">运行时配置 · 保存后立即生效</div>
          </div>
          <button id="gpt-helper-settings-close" style="margin-left: auto; ${createButtonStyle()}">关闭</button>
        </div>
      </div>

      <div style="display: grid; gap: 10px;">
        ${createSettingsSection('01', '连接', createField('本地服务地址', 'localServerBaseUrl', config.localServerBaseUrl || '', {
          badge: 'Local API',
          helpText: '可留空。留空时不保存会话、不记录 GitHub 请求，也不拉取本地待发送消息。'
        }))}

        ${createSettingsSection('02', '校验范围', `
          ${createField('允许仓库', 'allowedRepos', listToText(config.allowedRepos), {
            multiline: true,
            rows: 3,
            minHeight: 62,
            badge: 'Allow',
            helpText: '每行一个 owner/repo。'
          })}
          ${createField('允许操作', 'allowedActions', listToText(config.allowedActions), {
            multiline: true,
            rows: 4,
            minHeight: 84,
            badge: 'Actions',
            helpText: '每行一个操作文案或工具函数名。'
          })}
        `)}

        ${createSettingsSection('03', '风险拦截', `
          ${createField('禁止分支', 'blockedBranches', listToText(config.blockedBranches), {
            multiline: true,
            rows: 2,
            minHeight: 52,
            badge: 'Branch',
            helpText: '每行一个分支名，命中后不自动确认。'
          })}
          ${createField('禁止路径', 'blockedPaths', listToText(config.blockedPaths), {
            multiline: true,
            rows: 3,
            minHeight: 62,
            badge: 'Path',
            helpText: '每行一个文件名、目录前缀或路径片段。'
          })}
          ${createField('危险词', 'dangerWords', listToText(config.dangerWords), {
            multiline: true,
            rows: 3,
            minHeight: 62,
            badge: 'Words',
            helpText: '每行一个关键词，命中后不自动确认。'
          })}
        `)}
      </div>

      <div style="
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        margin: 12px -14px -14px;
        padding: 10px 14px 12px;
        border-top: 1px solid rgba(214, 222, 205, 0.12);
        background: rgba(16, 15, 13, 0.96);
        backdrop-filter: blur(8px);
      ">
        ${statusHtml}
        <button id="gpt-helper-settings-reset" style="${createButtonStyle()}">恢复默认</button>
        <button id="gpt-helper-settings-save" style="${createPrimaryButtonStyle()}">保存配置</button>
      </div>
    `;

    p.querySelector('#gpt-helper-settings-close').onclick = hideSettingsPanel;
    p.querySelector('#gpt-helper-settings-reset').onclick = () => {
      const runtimeSettings = getRuntimeSettings();
      if (!runtimeSettings) {
        return;
      }

      renderSettingsPanel(runtimeSettings.getDefaultRuntimeConfig(), '已恢复默认配置，保存后生效');
    };
    p.querySelector('#gpt-helper-settings-save').onclick = saveSettingsFromPanel;
    p.style.display = 'block';
    setSettingsPanelOpen(true);
  }

  function createSettingsButton() {
    if (settingsButton) {
      return settingsButton;
    }

    settingsButtonHost = document.createElement('div');
    settingsButtonHost.id = 'gpt-helper-floating-host';
    const shadow = settingsButtonHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = createSettingsButtonStyleText();

    const wrap = document.createElement('div');
    wrap.className = 'gpt-helper-floating-wrap';

    settingsButton = document.createElement('button');
    settingsButton.className = 'gpt-helper-usage-card gpt-helper-usage-loading gpt-helper-tone-unknown';
    settingsButton.type = 'button';
    settingsButton.title = '打开 GitHub Helper 配置';
    settingsButton.setAttribute('aria-label', '打开 GitHub Helper 配置');

    settingsButton.innerHTML = `
      <span class="gpt-helper-usage-band" data-usage-band></span>
      <span class="gpt-helper-usage-dot" data-usage-dot></span>
      <span class="gpt-helper-usage-logo">G</span>
      <span class="gpt-helper-plan" data-usage-plan>加载中</span>
      <span class="gpt-helper-usage-main" data-usage-value data-usage-main>--</span>
      <span class="gpt-helper-usage-label">CODEX</span>
      <span class="gpt-helper-usage-detail" aria-hidden="true">
        <span class="gpt-helper-usage-row">
          <span class="gpt-helper-usage-row-label">5小时</span>
          <span class="gpt-helper-usage-row-value" data-usage-value data-usage-primary-value>--</span>
        </span>
        <span class="gpt-helper-usage-row">
          <span class="gpt-helper-usage-row-label">7天</span>
          <span class="gpt-helper-usage-row-value" data-usage-value data-usage-secondary-value>--</span>
        </span>
      </span>
    `;

    settingsButton.onclick = () => {
      refreshUsageStatus(true);
      showSettingsPanel();
    };

    settingsFrame = document.createElement('div');
    settingsFrame.className = 'gpt-helper-settings-frame gpt-helper-hidden';
    settingsFrame.style.width = `${settingsPanelWidth}px`;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'gpt-helper-settings-resize';
    resizeHandle.title = '拖动调整宽度';
    resizeHandle.addEventListener('pointerdown', handleSettingsResizeStart);

    settingsFrameBody = document.createElement('div');
    settingsFrameBody.className = 'gpt-helper-settings-body';

    settingsFrame.append(resizeHandle, settingsFrameBody);
    settingsPanel = settingsFrameBody;

    wrap.append(settingsButton, settingsFrame);
    shadow.append(style, wrap);
    document.documentElement.appendChild(settingsButtonHost);
    startUsageRefresh();
    return settingsButton;
  }

  function createSettingsPanel() {
    if (settingsPanel) {
      return settingsPanel;
    }

    createSettingsButton();
    return settingsPanel;
  }

  function updateSettingsPanelPosition() {
    applySettingsPanelWidth();
  }

  function showSettingsPanel() {
    const runtimeSettings = getRuntimeSettings();

    if (!runtimeSettings) {
      alert('运行时配置模块还没有加载完成，请稍后再试。');
      return;
    }

    runtimeSettings.loadRuntimeConfig()
      .then(config => {
        renderSettingsPanel(config);
        updateSettingsPanelPosition();
      })
      .catch(error => {
        console.warn('[GPT GitHub Helper] 打开配置面板失败：', error);
        renderSettingsPanel(runtimeSettings.getRuntimeConfig(), '读取已保存配置失败，当前显示默认配置');
        updateSettingsPanelPosition();
      });
  }

  function hideSettingsPanel() {
    setSettingsPanelOpen(false);
  }

  function saveSettingsFromPanel() {
    const runtimeSettings = getRuntimeSettings();

    if (!runtimeSettings) {
      return;
    }

    const nextConfig = {
      localServerBaseUrl: readSettingValue('localServerBaseUrl'),
      allowedRepos: textToList(readSettingValue('allowedRepos')),
      blockedBranches: textToList(readSettingValue('blockedBranches')),
      allowedActions: textToList(readSettingValue('allowedActions')),
      blockedPaths: textToList(readSettingValue('blockedPaths')),
      dangerWords: textToList(readSettingValue('dangerWords'))
    };

    runtimeSettings.saveRuntimeConfig(nextConfig)
      .then(savedConfig => renderSettingsPanel(savedConfig, '已保存，后续校验立即使用新配置'))
      .catch(error => {
        const status = settingsPanel && settingsPanel.querySelector('#gpt-helper-settings-status');
        if (status) {
          status.style.color = '#fca5a5';
          status.textContent = `保存失败：${error.message || error}`;
        }
      });
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
    createSettingsButton();

    if (panel) {
      return panel;
    }

    panel = document.createElement('div');

    // 固定在页面右侧中间。
    panel.style.position = 'fixed';
    panel.style.right = '76px';
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
