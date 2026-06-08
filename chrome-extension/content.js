// content.js
// 插件主流程：串联页面状态检测、本地通知、GitHub 工具确认和本地消息自动发送。
// 功能：
// 1. 检测 GPT 是否回答中 / 已结束
// 2. 回答结束后通知本地 Python 服务
// 3. 检测 GitHub 工具确认请求
// 4. 安全校验通过时右侧中间弹窗并自动确认
// 5. 安全校验不通过时右侧中间弹窗，允许用户手动“仍然确认”
// 6. 轮询本地 Python 消息队列，把消息填入 ChatGPT 输入框并点击发送

(function () {
  const {
    config,
    pageReader,
    localApi,
    githubPrompt,
    safetyCheck,
    panel
  } = window.GptGithubHelper;

  // 上一次 GPT 是否回答中的状态
  let lastThinkingState = null;

  // 当前 GPT 是否回答中，给自动发送消息时判断使用
  let currentThinkingState = false;

  // 防止同一次回答结束重复推送
  let finishedNotified = false;

  // 防止同一个 GitHub 确认请求重复弹窗 / 重复写日志
  let githubNotifiedText = '';

  // 防止同一个 GitHub 确认请求重复自动确认
  let githubAutoConfirmedText = '';

  // 防止轮询消息时并发请求
  let pollingLocalMessage = false;

  // 防止同一条本地消息正在发送时重复处理
  let sendingLocalMessage = false;

  // 记录 ChatGPT 原始会话标题。
  // 注意：插件会改 document.title 显示“回答中/已结束”，所以必须单独保存原始标题。
  let conversationTitle = document.title || 'ChatGPT';

  /**
   * 判断是否是插件自己设置的标题。
   */
  function isHelperTitle(title) {
    return title === config.titles.thinking || title === config.titles.finished;
  }

  /**
   * 清理标题，避免把浏览器标题后缀保存进文件名。
   */
  function cleanConversationTitle(title) {
    return String(title || '')
      .replace(/\s+-\s+ChatGPT$/i, '')
      .trim();
  }

  /**
   * 刷新真实会话标题。
   * 说明：
   * 只在当前 document.title 不是插件标题时更新，避免把“回答中/已结束”当成会话名。
   */
  function refreshConversationTitle() {
    const title = cleanConversationTitle(document.title);

    if (!title || isHelperTitle(document.title)) {
      return;
    }

    if (title !== 'ChatGPT') {
      conversationTitle = title;
    }
  }

  /**
   * 获取当前会话标题。
   */
  function getConversationTitle() {
    refreshConversationTitle();
    return cleanConversationTitle(conversationTitle) || '未命名会话';
  }

  /**
   * 点击 ChatGPT 页面上的 GitHub Allow / 允许 按钮。
   */
  function clickAllowButton() {
    const allowButton = githubPrompt.findAllowButton();

    if (!allowButton) {
      alert('没有找到 GitHub 允许按钮。');
      return false;
    }

    allowButton.click();
    panel.hidePanel();
    return true;
  }

  /**
   * 延迟自动确认 GitHub 工具请求。
   */
  function scheduleAutoConfirm(githubText) {
    if (githubAutoConfirmedText === githubText) {
      return;
    }

    githubAutoConfirmedText = githubText;

    setTimeout(() => {
      if (githubPrompt.getGithubPromptText() !== githubText) {
        return;
      }

      confirmAllow(false);
    }, 300);
  }

  /**
   * 确认 GitHub 工具请求。
   *
   * @param {boolean} force
   * - false：只允许安全校验通过时确认
   * - true：用户在弹窗里主动点击“仍然确认”时，允许继续确认
   */
  function confirmAllow(force = false) {
    const text = githubPrompt.getGithubPromptText();
    const checkResult = safetyCheck.checkSafety(text);

    // 未通过安全校验，并且不是用户强制确认，则只弹窗提示
    if (!checkResult.ok && !force) {
      panel.renderPanel(checkResult);
      return false;
    }

    return clickAllowButton();
  }

  /**
   * 绑定快捷键 Alt + A。
   *
   * 快捷键只用于“安全校验通过”的确认。
   * 如果安全校验不通过，需要用户在弹窗中点击“仍然确认”。
   */
  function bindShortcut() {
    window.addEventListener('keydown', event => {
      if (event.altKey && event.key.toLowerCase() === config.shortcut.confirmAllowKey) {
        event.preventDefault();
        confirmAllow(false);
      }
    });
  }

  /**
   * 查找 ChatGPT 输入框。
   * 说明：
   * 1. 优先找官方常见 prompt-textarea。
   * 2. 兼容旧版 textarea。
   * 3. 兼容新版 ProseMirror / contenteditable 输入框。
   */
  function findChatInput() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'textarea',
      '[data-testid="composer-text-input"] [contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element) {
        return element;
      }
    }

    return null;
  }

  /**
   * 触发输入事件。
   * 说明：
   * React / ProseMirror 需要 input 事件来刷新内部状态，否则发送按钮会一直 disabled。
   */
  function dispatchComposerInputEvents(input, text) {
    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));

    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));

    input.dispatchEvent(new Event('change', {
      bubbles: true
    }));
  }

  /**
   * 给 textarea 设置文本。
   * 说明：
   * 使用原生 value setter，避免 React 不识别直接 input.value = xxx。
   */
  function setTextareaValue(textarea, text) {
    const prototype = Object.getPrototypeOf(textarea);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(textarea, text);
    } else {
      textarea.value = text;
    }

    dispatchComposerInputEvents(textarea, text);
    return true;
  }

  /**
   * 给 contenteditable 设置文本。
   * 说明：
   * ChatGPT 新版输入框一般是 ProseMirror。
   * 优先使用 execCommand('insertText')，它更容易被编辑器识别。
   */
  function setEditableValue(editable, text) {
    editable.focus();

    try {
      const selection = window.getSelection();
      const range = document.createRange();

      range.selectNodeContents(editable);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      // 先全选删除，再插入文本，避免和旧内容拼接。
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
    } catch (error) {
      // execCommand 失败时兜底使用 textContent。
      editable.textContent = text;
    }

    dispatchComposerInputEvents(editable, text);
    return true;
  }

  /**
   * 给输入框设置文本。
   */
  function setInputText(input, text) {
    if (!input) {
      return false;
    }

    input.focus();

    if (input.tagName === 'TEXTAREA') {
      return setTextareaValue(input, text);
    }

    return setEditableValue(input, text);
  }

  /**
   * 判断按钮是否可点击。
   */
  function isButtonUsable(button) {
    if (!button) {
      return false;
    }

    return !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      button.getAttribute('data-disabled') !== 'true';
  }

  /**
   * 查找 ChatGPT 发送按钮。
   * 说明：
   * 优先找明确的 send-button / composer-submit-button。
   */
  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="发送提示"]',
      'button[aria-label="发送消息"]'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);

      if (button) {
        return button;
      }
    }

    const buttons = Array.from(document.querySelectorAll('button'));

    return buttons.find(button => {
      const label = [
        button.innerText,
        button.getAttribute('aria-label'),
        button.getAttribute('data-testid')
      ].join(' ').toLowerCase();

      return (
        label.includes('send') ||
        label.includes('发送') ||
        label.includes('composer-submit-button')
      );
    }) || null;
  }

  /**
   * 点击发送按钮，最多重试几次。
   * 说明：
   * 设置输入框后 React 状态刷新可能有延迟，发送按钮会短暂 disabled。
   */
  function clickSendButtonWithRetry(messageId, retryCount = 0) {
    const sendButton = findSendButton();

    if (isButtonUsable(sendButton)) {
      sendButton.click();
      console.log('[GPT GitHub Helper] 已自动发送本地消息');
      ackLocalMessage(messageId);
      return;
    }

    if (retryCount < 15) {
      setTimeout(() => {
        clickSendButtonWithRetry(messageId, retryCount + 1);
      }, 300);
      return;
    }

    console.warn('[GPT GitHub Helper] ChatGPT 发送按钮不可用，消息保留在本地队列，稍后重试');
    sendingLocalMessage = false;
  }

  /**
   * 确认本地队列消息已经发送成功。
   */
  function ackLocalMessage(messageId) {
    if (!messageId) {
      sendingLocalMessage = false;
      return;
    }

    const requestUrl = config.localServerBaseUrl + '/ack-chat-message';

    chrome.runtime.sendMessage(
      {
        type: 'CALL_LOCAL_SERVER',
        url: requestUrl,
        method: 'POST',
        payload: {
          id: messageId
        }
      },
      response => {
        sendingLocalMessage = false;

        if (chrome.runtime.lastError) {
          console.warn('[GPT GitHub Helper] 确认队列消息失败：', chrome.runtime.lastError.message);
          return;
        }

        if (!response || !response.success) {
          console.warn('[GPT GitHub Helper] 本地队列 ack 失败：', response);
        }
      }
    );
  }

  /**
   * 向 ChatGPT 输入框输入文本并点击发送。
   */
  function sendTextToChatGPT(message) {
    const messageId = message?.id || '';
    const value = String(message?.text || '').trim();

    if (!value) {
      sendingLocalMessage = false;
      return false;
    }

    if (currentThinkingState) {
      console.warn('[GPT GitHub Helper] GPT 正在回答，暂不自动发送本地消息');
      sendingLocalMessage = false;
      return false;
    }

    const input = findChatInput();

    if (!input) {
      console.warn('[GPT GitHub Helper] 没找到 ChatGPT 输入框');
      sendingLocalMessage = false;
      return false;
    }

    const inputOk = setInputText(input, value);

    if (!inputOk) {
      console.warn('[GPT GitHub Helper] 设置输入框内容失败');
      sendingLocalMessage = false;
      return false;
    }

    // 先等编辑器刷新，再点击按钮。
    // 只有真正点击发送按钮成功后，才会 ack 删除队列消息。
    setTimeout(() => {
      clickSendButtonWithRetry(messageId);
    }, 500);

    return true;
  }

  /**
   * 从本地 Python 服务拉取一条待发送消息。
   */
  function pollPythonMessageQueue() {
    // GPT 正在回答时不取队列，避免把消息取出来后发送失败导致丢失。
    if (currentThinkingState || pollingLocalMessage || sendingLocalMessage) {
      return;
    }

    pollingLocalMessage = true;

    const requestUrl = config.localServerBaseUrl + '/next-chat-message';

    chrome.runtime.sendMessage(
      {
        type: 'CALL_LOCAL_SERVER',
        url: requestUrl,
        method: 'GET'
      },
      response => {
        pollingLocalMessage = false;

        if (chrome.runtime.lastError) {
          console.warn(
            '[GPT GitHub Helper] 拉取本地待发送消息失败：',
            chrome.runtime.lastError.message
          );
          return;
        }

        if (!response || !response.success) {
          return;
        }

        const body = response.body;

        if (!body || !body.hasMessage || !body.message) {
          return;
        }

        sendingLocalMessage = true;
        sendTextToChatGPT(body.message);
      }
    );
  }

  /**
   * 回答结束后，延迟 800ms 通知本地服务。
   *
   * 延迟的作用：
   * - 等待 ChatGPT 最后一段 DOM 更新完成
   * - 避免保存到半截回复
   */
  function notifyFinished() {
    setTimeout(() => {
      localApi.callLocalNotifyApi('finished', {
        conversationTitle: getConversationTitle()
      });
    }, 800);
  }

  /**
   * 通知本地服务：检测到了 GitHub 确认请求。
   *
   * @param {string} githubText 当前页面中的 GitHub 请求文本
   * @param {object} checkResult 安全校验结果
   */
  function notifyGithubRequest(githubText, checkResult) {
    if (githubNotifiedText === githubText) {
      return;
    }

    githubNotifiedText = githubText;

    localApi.callLocalNotifyApi('github', {
      conversationTitle: getConversationTitle(),
      githubFilePath: checkResult.filePath,
      securityOk: checkResult.ok,
      securityReasons: checkResult.reasons
    });
  }

  /**
   * 处理 GPT 回答状态。
   *
   * thinking = true：
   * - 标题显示回答中
   *
   * thinking = false：
   * - 标题显示已结束
   * - 如果上一次是 true，这次变 false，触发回答结束推送
   */
  function handleThinkingState(thinking) {
    refreshConversationTitle();
    currentThinkingState = thinking;

    if (thinking) {
      document.title = config.titles.thinking;
      finishedNotified = false;
      return;
    }

    document.title = config.titles.finished;

    if (!finishedNotified && lastThinkingState === true) {
      finishedNotified = true;
      notifyFinished();
    }
  }

  /**
   * 处理 GitHub 工具确认请求。
   *
   * 逻辑：
   * 1. 没有 GitHub 请求，不处理
   * 2. 有 GitHub 请求，执行安全校验
   * 3. 弹出右侧中间面板
   * 4. 面板中显示是否通过、文件路径、失败原因
   * 5. 通过时自动确认
   * 6. 不通过时用户可点击“仍然确认”
   */
  function handleGithubPrompt() {
    const githubText = githubPrompt.getGithubPromptText();
    const allowButton = githubPrompt.findAllowButton();

    if (!githubText || !allowButton) {
      return;
    }

    const checkResult = safetyCheck.checkSafety(githubText);

    notifyGithubRequest(githubText, checkResult);
    panel.renderPanel(checkResult);

    if (checkResult.ok) {
      scheduleAutoConfirm(githubText);
    }
  }

  /**
   * 主循环。
   *
   * 每 1 秒：
   * 1. 检测 GPT 回答状态
   * 2. 检测 GitHub 工具确认请求
   */
  function loop() {
    const thinking = pageReader.isThinking();

    handleThinkingState(thinking);
    handleGithubPrompt();

    lastThinkingState = thinking;
  }

  /**
   * 插件启动入口。
   */
  function start() {
    panel.createPanel();

    // 面板按钮点击时，允许用户强制确认
    panel.setConfirmHandler(() => confirmAllow(true));

    bindShortcut();

    setInterval(loop, 1000);

    // 每 1 秒从 Python 本地服务拉取待发送消息。
    setInterval(pollPythonMessageQueue, 1000);

    console.log('[GPT GitHub Helper Full] 已启动');
  }

  start();
})();
