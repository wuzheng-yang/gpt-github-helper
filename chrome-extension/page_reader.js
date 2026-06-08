// page_reader.js
// 负责读取 ChatGPT 页面状态和消息内容。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  /**
   * 记录最近一次 assistant 文本变化时间。
   * 用于辅助判断是否还在流式输出。
   */
  let lastAssistantText = '';
  let lastAssistantChangeTime = 0;

  /**
   * 获取整个页面文本。
   * 注意：这个函数只用于读取页面内容、GitHub 请求识别等场景，
   * 不直接用于判断 GPT 是否正在回答，避免页面历史文本导致误判。
   */
  function getPageText() {
    return document.body?.innerText || '';
  }

  /**
   * 判断元素是否真实可见。
   * 过滤 ChatGPT 页面中可能残留的隐藏按钮、模板按钮、不可点击按钮。
   */
  function isVisibleElement(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0;
  }

  /**
   * 判断按钮是否可用。
   * disabled 或 aria-disabled=true 的按钮不作为“正在回答”的依据。
   */
  function isEnabledButton(button) {
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  /**
   * 判断按钮文本、aria-label 或 title 是否包含指定关键词。
   * ChatGPT 页面按钮可能只有 aria-label，没有可见 innerText。
   */
  function buttonIncludes(button, keywords) {
    const text = button.innerText?.trim() || '';
    const ariaLabel = button.getAttribute('aria-label') || '';
    const title = button.getAttribute('title') || '';

    return keywords.some(keyword => {
      return text.includes(keyword) ||
        ariaLabel.includes(keyword) ||
        title.includes(keyword);
    });
  }

  /**
   * 判断页面是否存在真实可见的“停止生成/停止思考”按钮。
   *
   * 重点：
   * 1. 必须是可见按钮
   * 2. 必须是可点击按钮
   * 3. 必须匹配停止生成相关文案
   */
  function hasActiveStopButton() {
    const buttons = Array.from(document.querySelectorAll('button'));

    return buttons.some(button => {
      if (!isVisibleElement(button) || !isEnabledButton(button)) {
        return false;
      }

      return buttonIncludes(button, [
        '停止思考',
        '停止生成',
        '停止回答',
        'Stop generating',
        'Stop streaming',
        'Stop responding'
      ]);
    });
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

    return messages[messages.length - 1].innerText?.trim() || '';
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
   * 判断 assistant 最后一条消息是否仍在变化。
   *
   * 用途：
   * 有些情况下停止按钮消失得很快，文本还在最后刷新，
   * 这里给 1.5 秒缓冲，避免过早推送不完整回复。
   */
  function isAssistantTextChanging() {
    const currentAssistantText = getLastAssistantMessageText();
    const now = Date.now();

    if (currentAssistantText && currentAssistantText !== lastAssistantText) {
      lastAssistantText = currentAssistantText;
      lastAssistantChangeTime = now;
      return true;
    }

    return lastAssistantChangeTime > 0 && now - lastAssistantChangeTime < 1500;
  }

  /**
   * 判断 GPT 是否正在回答。
   *
   * 逻辑：
   * 1. 真实可见且可点击的停止按钮存在 => 回答中
   * 2. 最后一条 assistant 文本最近还在变化 => 回答中
   * 3. 否则 => 已结束
   */
  function isThinking() {
    return hasActiveStopButton() || isAssistantTextChanging();
  }

  window.GptGithubHelper.pageReader = {
    getPageText,
    isThinking,
    getLastAssistantMessageText,
    getLastUserMessageText
  };
})();
