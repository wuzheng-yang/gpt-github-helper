// content.js
// -----------------------------------------------------------------------------
// Chrome 插件 content script 主流程文件。
//
// 这个文件运行在 ChatGPT 页面里，负责把其他模块串起来。
//
// 核心职责：
// 1. 检测 GPT 是否正在回答 / 是否回答结束。
// 2. 回答结束后，把会话内容发送给本地 Python 服务保存 Markdown。
// 3. 检测 GitHub 工具确认请求。
// 4. 根据 config.js + safety_check.js 的结果显示右侧确认面板。
// 5. 配置校验通过时自动点击 ChatGPT 页面原生 Allow / 允许按钮。
// 6. 轮询本地 Python 消息队列，把 Python 发来的文本自动输入到 ChatGPT。
//
// 依赖模块加载顺序由 manifest.json 保证：
// config.js -> runtime_settings.js -> page_reader.js -> local_api.js -> github_prompt.js
// -> safety_check.js -> panel.js -> content.js
// -----------------------------------------------------------------------------

(function () {
  // 从 window.GptGithubHelper 取出其他模块。
  // 这些对象分别由前面的 JS 文件注册。
  const {
    config,
    runtimeSettings,
    pageReader,
    localApi,
    githubPrompt,
    safetyCheck,
    panel
  } = window.GptGithubHelper;

  // ---------------------------------------------------------------------------
  // 当前页面唯一 ID。
  //
  // 用途：
  // 1. 每个 ChatGPT 标签页都会生成一个不同 pageId。
  // 2. 插件轮询 /next-chat-message 时会把 pageId 发给后端。
  // 3. 后端用 pageId 给消息加短期领取锁，避免多个标签页重复发送同一条消息。
  //
  // 注意：
  // 刷新页面后 pageId 会重新生成，这是正常的。
  // ---------------------------------------------------------------------------
  const pageId = `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 上一次 GPT 是否回答中的状态。
  // null 表示插件刚启动，还没有历史状态。
  let lastThinkingState = null;

  // 当前 GPT 是否回答中。
  // Python 自动发送消息前会检查这个变量，避免 GPT 回答中仍继续发下一条消息。
  let currentThinkingState = false;

  // 防止同一次回答结束重复推送 /gpt-finished。
  // 每次 thinking=true 时重置为 false；thinking 从 true -> false 时推送一次。
  let finishedNotified = false;

  // 防止同一个 GitHub 确认请求重复写日志。
  // 保存上一次请求文本，如果文本没变就不重复通知本地服务。
  let githubNotifiedText = '';

  // 防止同一个 GitHub 确认按钮重复自动点击。
  // 用按钮 DOM 元素去重，而不是用请求文本去重：
  // 连续多个 GitHub 请求可能文本相同，但按钮元素会是新的。
  const autoConfirmedButtons = new WeakSet();

  // 按钮被页面重绘时的兜底去重签名，短时间内避免同一请求重复安排定时点击。
  let lastAutoConfirmSignature = '';
  let lastAutoConfirmAt = 0;

  // 防止 /next-chat-message 轮询并发。
  // 如果上一次请求还没回来，下一次轮询直接跳过。
  let pollingLocalMessage = false;

  // 防止同一条本地消息正在发送时重复处理。
  // 例如发送按钮还没变可用、等待 ack 时，不允许再取新消息。
  let sendingLocalMessage = false;

  // 记录 ChatGPT 原始会话标题。
  //
  // 为什么不能直接使用 document.title：
  // content.js 会把 document.title 改成“回答中/已结束”，方便用户看状态。
  // 如果保存文件名时直接用 document.title，就会保存成状态标题。
  let conversationTitle = document.title || 'ChatGPT';

  /**
   * 判断标题是否是插件自己设置的状态标题。
   *
   * @param {string} title 当前浏览器标题
   * @returns {boolean} 是否是插件状态标题
   */
  function isHelperTitle(title) {
    return title === config.titles.thinking || title === config.titles.finished;
  }

  /**
   * 清理 ChatGPT 会话标题。
   *
   * @param {string} title 原始标题
   * @returns {string} 清理后的标题
   *
   * 主要处理：
   * - 去掉浏览器标题后缀：xxx - ChatGPT
   * - 去掉首尾空格
   */
  function cleanConversationTitle(title) {
    return String(title || '')
      .replace(/\s+-\s+ChatGPT$/i, '')
      .trim();
  }

  /**
   * 刷新真实会话标题。
   *
   * 规则：
   * 1. 当前 document.title 是插件状态标题时，不更新 conversationTitle。
   * 2. 当前标题是 ChatGPT 默认标题时，不覆盖已有真实标题。
   * 3. 只有读到类似“项目问题与改进建议”这种真实会话标题时才保存。
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
   *
   * @returns {string} 会话标题，空时返回“未命名会话”
   */
  function getConversationTitle() {
    refreshConversationTitle();
    return cleanConversationTitle(conversationTitle) || '未命名会话';
  }

  /**
   * 判断当前页面是否是前台可操作页面。
   *
   * @returns {boolean} 是否前台激活
   *
   * 用途：
   * - Python 消息没有 targetUrl 时，只允许当前前台 ChatGPT 页面取消息。
   * - Python 消息指定 targetUrl 时，由后端按 URL 匹配，不强制前台。
   *
   * 三个判断：
   * - document.hidden：标签页是否隐藏
   * - visibilityState：页面是否 visible
   * - hasFocus：浏览器窗口/标签页是否有焦点
   */
  function isCurrentPageActive() {
    return !document.hidden &&
      document.visibilityState === 'visible' &&
      document.hasFocus();
  }

  /**
   * 点击 ChatGPT 页面上的 GitHub Allow / 允许 按钮。
   *
   * @returns {boolean} 是否成功找到并点击按钮
   *
   * 注意：
   * 这里点击的是 ChatGPT 页面原生工具确认按钮，不是插件右侧面板按钮。
   */
  function clickAllowButton(preferredButton = null) {
    const allowButton = preferredButton && document.body.contains(preferredButton)
      ? preferredButton
      : githubPrompt.findAllowButton();

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
   *
   * @param {string} githubText 当前 GitHub 工具确认卡片文本
   * @param {HTMLButtonElement} allowButton 当前确认卡片里的原生 Allow / 允许按钮
   *
   * 为什么延迟 300ms：
   * - 给 panel.renderPanel() 一点时间先展示结果。
   * - 避免 DOM 刚出现时按钮还没稳定。
   *
   * 为什么传入 allowButton：
   * - 自动确认前不能再依赖整页文本比较，因为插件自己的弹窗也会改变页面文本。
   * - 优先点击当前请求对应的按钮，如果页面重绘导致按钮失效，再兜底重新查找。
   */
  function getAutoConfirmSignature(githubText, allowButton) {
    const rect = allowButton?.getBoundingClientRect?.();
    const buttonPosition = rect
      ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
      : 'no-button';

    return `${githubText}::${buttonPosition}`;
  }

  function scheduleAutoConfirm(githubText, allowButton) {
    if (allowButton && autoConfirmedButtons.has(allowButton)) {
      return;
    }

    const now = Date.now();
    const signature = getAutoConfirmSignature(githubText, allowButton);

    if (signature === lastAutoConfirmSignature && now - lastAutoConfirmAt < 1500) {
      return;
    }

    lastAutoConfirmSignature = signature;
    lastAutoConfirmAt = now;

    if (allowButton) {
      autoConfirmedButtons.add(allowButton);
    }

    setTimeout(() => {
      console.log('[GPT GitHub Helper] 配置校验通过，自动确认 GitHub 请求');
      clickAllowButton(allowButton);
    }, 300);
  }

  /**
   * 确认 GitHub 工具请求。
   *
   * @param {boolean} force
   * - false：只允许配置校验通过时确认。
   * - true：用户在插件面板点击“仍然确认”时，允许跳过校验继续确认。
   *
   * 返回：
   * - true：成功点击原生 Allow 按钮
   * - false：未点击
   */
  function confirmAllow(force = false) {
    const text = githubPrompt.getGithubPromptText();
    const checkResult = safetyCheck.checkSafety(text);

    // 配置校验未通过，并且不是用户强制确认时，只显示面板，不点击原生 Allow。
    if (!checkResult.ok && !force) {
      panel.renderPanel(checkResult);
      return false;
    }

    return clickAllowButton();
  }

  /**
   * 绑定快捷键 Alt + A。
   *
   * 说明：
   * - 快捷键只按普通模式确认：confirmAllow(false)。
   * - 如果配置校验不通过，不会因为快捷键直接强制确认。
   * - 强制确认只能通过面板里的“仍然确认”按钮触发。
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
   *
   * @returns {HTMLElement|null} 输入框元素
   *
   * ChatGPT 输入框 DOM 经常变化，所以这里按优先级兼容多种选择器：
   * 1. 老版本 #prompt-textarea
   * 2. textarea[data-id="root"]
   * 3. 普通 textarea
   * 4. 新版 composer-text-input 里的 contenteditable
   * 5. ProseMirror 编辑器
   * 6. role="textbox" 的 contenteditable
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
   * 触发输入相关事件。
   *
   * @param {HTMLElement} input 输入框元素
   * @param {string} text 输入文本
   *
   * 为什么要手动触发事件：
   * React / ProseMirror 这类前端框架不只看 DOM 值，
   * 还会维护内部状态。如果只改 textarea.value 或 textContent，
   * 发送按钮可能仍然 disabled。
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
   *
   * @param {HTMLTextAreaElement} textarea textarea 输入框
   * @param {string} text 要写入的文本
   * @returns {boolean} 是否成功
   *
   * 使用原生 value setter 的原因：
   * React 会劫持 value 属性，直接 textarea.value = xxx 有时不会被 React 识别。
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
   * 给 contenteditable / ProseMirror 设置文本。
   *
   * @param {HTMLElement} editable 可编辑元素
   * @param {string} text 要写入的文本
   * @returns {boolean} 是否成功
   *
   * 优先使用 document.execCommand('insertText')，
   * 因为它更像真实输入，更容易被 ProseMirror 识别。
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
   * 给 ChatGPT 输入框设置文本。
   *
   * @param {HTMLElement} input 输入框元素
   * @param {string} text 要发送的文本
   * @returns {boolean} 是否成功
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
   *
   * @param {HTMLButtonElement|null} button 按钮元素
   * @returns {boolean} 是否可用
   *
   * 同时兼容：
   * - 原生 disabled
   * - aria-disabled
   * - data-disabled
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
   *
   * @returns {HTMLButtonElement|null} 发送按钮
   *
   * 优先找稳定的 data-testid / aria-label。
   * 如果找不到，再从所有 button 里用文本兜底匹配。
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
   * 判断本地消息是否已经出现在最后一条用户消息里。
   *
   * @param {string} text Python 队列里的消息文本
   * @returns {boolean} 是否已经显示在会话中
   *
   * 为什么只比较前 80 个字符：
   * - 长文本可能包含换行、Markdown、空格差异。
   * - 只要开头匹配，基本可以判断是这条消息已经发送到页面。
   */
  function isLocalMessageVisibleInChat(text) {
    const lastUserText = String(pageReader.getLastUserMessageText() || '').trim();
    const expectedText = String(text || '').trim();

    if (!lastUserText || !expectedText) {
      return false;
    }

    const compareLength = Math.min(80, expectedText.length);
    const expectedPrefix = expectedText.slice(0, compareLength);

    return lastUserText.includes(expectedPrefix);
  }

  /**
   * 等待本地消息真正进入 ChatGPT 会话后再 ack。
   *
   * @param {string} messageId 后端队列消息 ID
   * @param {string} text 消息文本
   * @param {number} retryCount 当前重试次数
   *
   * ack 设计：
   * - 点击发送按钮不代表消息一定发送成功。
   * - 只有页面最后一条 user 消息出现了这段文本，才调用 /ack-chat-message。
   * - 如果 30 次检查仍失败，不 ack，消息保留在后端队列。
   */
  function waitUserMessageAppearedThenAck(messageId, text, retryCount = 0) {
    if (isLocalMessageVisibleInChat(text)) {
      console.log('[GPT GitHub Helper] 已确认本地消息进入会话，开始 ack');
      ackLocalMessage(messageId);
      return;
    }

    if (retryCount < 30) {
      setTimeout(() => {
        waitUserMessageAppearedThenAck(messageId, text, retryCount + 1);
      }, 300);
      return;
    }

    console.warn('[GPT GitHub Helper] 未确认本地消息进入会话，暂不 ack，消息保留在本地队列');
    sendingLocalMessage = false;
  }

  /**
   * 点击发送按钮，最多重试几次。
   *
   * @param {string} messageId 后端队列消息 ID
   * @param {string} text 消息文本
   * @param {number} retryCount 当前重试次数
   *
   * 为什么需要重试：
   * 输入框写入文本后，React / ProseMirror 更新发送按钮状态可能有延迟。
   */
  function clickSendButtonWithRetry(messageId, text, retryCount = 0) {
    const sendButton = findSendButton();

    if (isButtonUsable(sendButton)) {
      sendButton.click();
      console.log('[GPT GitHub Helper] 已点击 ChatGPT 发送按钮');

      // 点击按钮不等于真正发送成功，等待消息出现在页面后再 ack。
      setTimeout(() => {
        waitUserMessageAppearedThenAck(messageId, text);
      }, 300);
      return;
    }

    if (retryCount < 15) {
      setTimeout(() => {
        clickSendButtonWithRetry(messageId, text, retryCount + 1);
      }, 300);
      return;
    }

    console.warn('[GPT GitHub Helper] ChatGPT 发送按钮不可用，消息保留在本地队列，稍后重试');
    sendingLocalMessage = false;
  }

  /**
   * 确认本地队列消息已经发送成功。
   *
   * @param {string} messageId 后端队列消息 ID
   *
   * 调用后端：
   * POST /ack-chat-message
   *
   * 后端收到 ack 后会从 pending_chat_messages 中删除这条消息。
   */
  function ackLocalMessage(messageId) {
    if (!messageId) {
      sendingLocalMessage = false;
      return;
    }

    const baseUrl = localApi.getLocalServerBaseUrl
      ? localApi.getLocalServerBaseUrl()
      : String(config.localServerBaseUrl || '').trim();

    if (!baseUrl) {
      sendingLocalMessage = false;
      return;
    }

    const requestUrl = baseUrl + '/ack-chat-message';

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
   *
   * @param {object} message 后端返回的队列消息
   * @param {string} message.id 消息 ID
   * @param {string} message.text 消息文本
   * @returns {boolean} 是否开始发送流程
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
    // 只有消息真正出现在页面后，才会 ack 删除队列消息。
    setTimeout(() => {
      clickSendButtonWithRetry(messageId, value);
    }, 500);

    return true;
  }

  /**
   * 构建本页面轮询队列时使用的 URL。
   *
   * 传给后端的查询参数：
   * - pageUrl：当前 ChatGPT 页面 URL，用于匹配 targetUrl。
   * - pageActive：当前页面是否前台激活。
   * - pageId：当前页面唯一 ID，用于后端消息领取锁。
   */
  function buildNextMessageUrl() {
    const baseUrl = localApi.getLocalServerBaseUrl
      ? localApi.getLocalServerBaseUrl()
      : String(config.localServerBaseUrl || '').trim();

    if (!baseUrl) {
      return '';
    }

    const params = new URLSearchParams({
      pageUrl: location.href,
      pageActive: String(isCurrentPageActive()),
      pageId
    });

    return `${baseUrl}/next-chat-message?${params.toString()}`;
  }

  /**
   * 从本地 Python 服务拉取一条待发送消息。
   *
   * 后端匹配规则：
   * - message.targetUrl 为空：只有 pageActive=true 的页面能领取。
   * - message.targetUrl 有值：只有 pageUrl 完全匹配的页面能领取，不强制前台。
   */
  function pollPythonMessageQueue() {
    // GPT 正在回答、正在请求队列、正在发送消息时，都不取新消息。
    if (currentThinkingState || pollingLocalMessage || sendingLocalMessage) {
      return;
    }

    pollingLocalMessage = true;

    const requestUrl = buildNextMessageUrl();

    if (!requestUrl) {
      pollingLocalMessage = false;
      return;
    }

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
   * 回答结束后，延迟通知本地服务。
   *
   * 为什么延迟 800ms：
   * - ChatGPT 最后一段 DOM 更新可能略晚于文本稳定判断。
   * - 延迟一点可以减少保存半截回复的概率。
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
   * @param {object} checkResult 配置校验结果
   *
   * 这个通知只用于写日志，不负责确认按钮。
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
   * @param {boolean} thinking 当前是否回答中
   *
   * 状态变化：
   * - thinking=true：标题显示回答中，并允许本轮结束时再次推送。
   * - thinking=false 且上一轮是 true：认为本轮回答刚结束，通知本地服务保存。
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
   * 流程：
   * 1. 找 GitHub 请求文本和 Allow 按钮。
   * 2. 没有请求或没有按钮时直接返回。
   * 3. 执行配置校验。
   * 4. 写本地日志。
   * 5. 渲染右侧确认面板。
   * 6. 校验通过时安排自动确认。
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
      scheduleAutoConfirm(githubText, allowButton);
    }
  }

  /**
   * 主循环。
   *
   * 每 1 秒执行：
   * 1. 读取 pageReader.isThinking() 判断回答状态。
   * 2. 根据状态更新标题，并在回答结束时保存会话。
   * 3. 检测是否出现 GitHub 工具确认卡片。
   */
  function loop() {
    const thinking = pageReader.isThinking();

    handleThinkingState(thinking);
    handleGithubPrompt();

    lastThinkingState = thinking;
  }

  /**
   * 插件启动入口。
   *
   * 启动内容：
   * 1. 创建右侧确认面板 DOM。
   * 2. 设置面板“仍然确认”按钮回调。
   * 3. 绑定 Alt + A 快捷键。
   * 4. 启动回答状态 / GitHub 请求检测循环。
   * 5. 启动 Python 消息队列轮询。
   */
  function start() {
    panel.createPanel();

    // 面板按钮点击时，允许用户强制确认。
    panel.setConfirmHandler(() => confirmAllow(true));

    const startLoop = () => {
      bindShortcut();

      setInterval(loop, 1000);

      // 每 1 秒从 Python 本地服务拉取待发送消息。
      setInterval(pollPythonMessageQueue, 1000);

      console.log('[GPT GitHub Helper Full] 已启动', {
        pageId,
        url: location.href
      });
    };

    if (runtimeSettings && runtimeSettings.loadRuntimeConfig) {
      runtimeSettings.loadRuntimeConfig().finally(startLoop);
      return;
    }

    startLoop();
  }

  start();
})();
