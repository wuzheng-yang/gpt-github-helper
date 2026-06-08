// page_reader.js
// 负责读取 ChatGPT 页面状态和消息内容。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  /**
   * 最近一次 GPT 回复文本。
   * 用来判断最后一条 assistant 消息是否还在变化。
   */
  let lastAssistantText = '';

  /**
   * 最近一次 GPT 回复文本变化时间。
   */
  let lastAssistantChangeTime = 0;

  /**
   * 最近一次判断结果，方便在控制台调试。
   */
  let lastThinkingDebug = {
    thinking: false,
    reason: 'init',
    assistantLength: 0,
    lastChangeAgoMs: 0
  };

  /**
   * 清理文本。
   * 说明：
   * 1. 保留换行，方便保存 Markdown 时更接近页面原始内容。
   * 2. 去掉首尾空白，避免保存一堆空行。
   * 3. 不做大幅压缩，防止代码块、工具内容格式被破坏。
   */
  function cleanText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  /**
   * 判断元素是否可见。
   * 说明：
   * ChatGPT 页面有很多隐藏模板和隐藏按钮。
   * 这里只保存可见区域，避免把隐藏 UI 文案反复保存进去。
   */
  function isVisibleElement(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * 获取整个页面文本。
   * 用途：
   * 1. GitHub 请求识别。
   * 2. 完整页面快照保存。
   * 3. 尽量包含工具卡片、确认弹窗、隐藏在普通消息外的可见内容。
   */
  function getPageText() {
    return cleanText(document.body?.innerText || '');
  }

  /**
   * 获取最后一条指定角色的消息文本。
   * role 可选：assistant / user。
   */
  function getLastMessageText(role) {
    const messages = Array.from(
      document.querySelectorAll(`[data-message-author-role="${role}"]`)
    );

    if (!messages.length) {
      return '';
    }

    return cleanText(messages[messages.length - 1].innerText || '');
  }

  /**
   * 获取最后一条 GPT 回复。
   */
  function getLastAssistantMessageText() {
    return getLastMessageText('assistant');
  }

  /**
   * 获取最后一条用户提问。
   */
  function getLastUserMessageText() {
    return getLastMessageText('user');
  }

  /**
   * 判断一段文本是否像工具消息。
   * 说明：
   * ChatGPT 工具卡片的 DOM 结构经常变化，不能只依赖一个固定选择器。
   * 这里用关键词兜底，把 GitHub / tool / connector / unknown tool 等工具提示一起收集。
   */
  function looksLikeToolText(text) {
    const value = cleanText(text);

    if (!value) {
      return false;
    }

    const lower = value.toLowerCase();

    return (
      lower.includes('github') ||
      lower.includes('tool') ||
      lower.includes('connector') ||
      lower.includes('unknown tool') ||
      lower.includes('update github file') ||
      lower.includes('create github file') ||
      lower.includes('delete github file') ||
      lower.includes('allow') ||
      value.includes('允许')
    );
  }

  /**
   * 从一个 DOM 元素构造消息对象。
   * 说明：
   * 统一返回 role / text / index / length，方便本地 Python 服务保存 JSON 和 Markdown。
   */
  function createMessageItem(role, text, index, source) {
    const cleaned = cleanText(text);

    return {
      index,
      role,
      source,
      length: cleaned.length,
      text: cleaned
    };
  }

  /**
   * 获取用户 / assistant 普通消息。
   * 说明：
   * 这是最稳定的 ChatGPT 消息选择器。
   */
  function getRoleMessages() {
    const elements = Array.from(
      document.querySelectorAll('[data-message-author-role]')
    );

    return elements
      .filter(isVisibleElement)
      .map((element, index) => {
        const role = element.getAttribute('data-message-author-role') || 'unknown';
        return createMessageItem(role, element.innerText || '', index, 'data-message-author-role');
      })
      .filter(item => item.text);
  }

  /**
   * 获取工具相关消息。
   * 说明：
   * 工具卡片不一定有 data-message-author-role，所以额外扫描常见容器。
   * 为避免重复：如果工具文本已经包含在 user/assistant 消息里，就不再重复加入。
   */
  function getToolLikeMessages(existingMessages) {
    const existedTextList = existingMessages.map(item => item.text);

    const candidates = Array.from(
      document.querySelectorAll([
        '[data-testid*="tool"]',
        '[data-testid*="connector"]',
        '[data-testid*="popover"]',
        '[role="dialog"]',
        '[popover]',
        'article',
        'section'
      ].join(','))
    );

    const result = [];

    candidates.forEach(element => {
      if (!isVisibleElement(element)) {
        return;
      }

      // 已经属于普通 user/assistant 消息时跳过，避免重复。
      if (element.closest('[data-message-author-role]')) {
        return;
      }

      const text = cleanText(element.innerText || '');
      if (!looksLikeToolText(text)) {
        return;
      }

      // 文本已经存在于普通消息里时跳过。
      const duplicated = existedTextList.some(oldText => oldText.includes(text) || text.includes(oldText));
      if (duplicated) {
        return;
      }

      // 同一工具卡片可能被多个父级 section 扫到，这里再做一次去重。
      if (result.some(item => item.text === text)) {
        return;
      }

      result.push(
        createMessageItem('tool', text, existingMessages.length + result.length, 'tool-like-dom')
      );
    });

    return result;
  }

  /**
   * 获取完整会话快照。
   * 返回内容：
   * 1. 普通 user / assistant 消息。
   * 2. 工具卡片、GitHub 确认弹窗等工具相关消息。
   * 3. 整页文本快照，用来兜底保存所有可见内容。
   */
  function getConversationSnapshot() {
    const roleMessages = getRoleMessages();
    const toolMessages = getToolLikeMessages(roleMessages);
    const allMessages = [...roleMessages, ...toolMessages]
      .map((item, index) => ({
        ...item,
        index
      }));

    return {
      messageCount: allMessages.length,
      messages: allMessages,
      fullPageText: getPageText()
    };
  }

  /**
   * 判断 GPT 是否正在回答。
   *
   * 这版彻底不再使用 Stop / Thinking / Generating 这些页面文案。
   * 原因：ChatGPT 页面里经常残留隐藏按钮或隐藏文本，会一直误判回答中。
   *
   * 现在只看最后一条 GPT 回复文本是否还在变化：
   * 1. 文本发生变化 => 回答中
   * 2. 最近 2 秒内变化过 => 回答中，用于等待最后一段 DOM 更新完成
   * 3. 超过 2 秒没变化 => 已结束
   */
  function isThinking() {
    const currentAssistantText = getLastAssistantMessageText();
    const now = Date.now();

    // 没有 GPT 回复时，直接认为不是回答中
    if (!currentAssistantText) {
      lastThinkingDebug = {
        thinking: false,
        reason: 'no_assistant_message',
        assistantLength: 0,
        lastChangeAgoMs: 0
      };
      return false;
    }

    // 第一次读取已有历史回复时，只初始化，不认为正在回答
    if (!lastAssistantText) {
      lastAssistantText = currentAssistantText;
      lastAssistantChangeTime = now;
      lastThinkingDebug = {
        thinking: false,
        reason: 'init_assistant_text',
        assistantLength: currentAssistantText.length,
        lastChangeAgoMs: 0
      };
      return false;
    }

    // 文本变化，说明 GPT 正在输出或页面仍在更新
    if (currentAssistantText !== lastAssistantText) {
      lastAssistantText = currentAssistantText;
      lastAssistantChangeTime = now;
      lastThinkingDebug = {
        thinking: true,
        reason: 'assistant_text_changed',
        assistantLength: currentAssistantText.length,
        lastChangeAgoMs: 0
      };
      return true;
    }

    const lastChangeAgoMs = now - lastAssistantChangeTime;

    // 最近 2 秒内变化过，继续认为回答中，避免过早保存半截回复
    if (lastChangeAgoMs < 2000) {
      lastThinkingDebug = {
        thinking: true,
        reason: 'wait_text_stable',
        assistantLength: currentAssistantText.length,
        lastChangeAgoMs
      };
      return true;
    }

    lastThinkingDebug = {
      thinking: false,
      reason: 'text_stable_finished',
      assistantLength: currentAssistantText.length,
      lastChangeAgoMs
    };
    return false;
  }

  /**
   * 获取最近一次回答状态判断原因。
   * 在 ChatGPT 页面控制台执行：
   * window.GptGithubHelper.pageReader.getThinkingDebug()
   */
  function getThinkingDebug() {
    return lastThinkingDebug;
  }

  window.GptGithubHelper.pageReader = {
    getPageText,
    isThinking,
    getThinkingDebug,
    getLastAssistantMessageText,
    getLastUserMessageText,
    getConversationSnapshot
  };
})();
