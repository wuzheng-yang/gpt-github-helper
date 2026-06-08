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
   * 获取整个页面文本。
   * 只用于 GitHub 请求识别，不用于判断回答中。
   */
  function getPageText() {
    return document.body?.innerText || '';
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
    getLastUserMessageText
  };
})();
