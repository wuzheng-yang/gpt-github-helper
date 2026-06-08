// page_reader.js
// 负责读取 ChatGPT 页面状态和消息内容。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  /**
   * 获取整个页面文本。
   * 注意：这个函数只用于读取页面内容、GitHub 请求识别等场景，
   * 不再用于判断 GPT 是否正在回答，避免页面历史文本导致误判。
   */
  function getPageText() {
    return document.body?.innerText || '';
  }

  /**
   * 判断按钮文本或 aria-label 是否包含指定关键词。
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
   * 判断页面是否存在“停止生成/停止思考”按钮。
   * 只有这个按钮存在时，才认为 GPT 正在输出。
   */
  function hasStopButton() {
    const buttons = Array.from(document.querySelectorAll('button'));

    return buttons.some(button => buttonIncludes(button, [
      '停止思考',
      '停止生成',
      'Stop generating',
      'Stop streaming'
    ]));
  }

  /**
   * 判断 GPT 是否正在回答。
   *
   * 原来使用 document.body.innerText 全文搜索 Thinking / Generating，
   * 容易被历史消息、正文内容、隐藏文案误触发。
   * 现在只检测真实存在的停止按钮，回答结束按钮消失后会立即变为 false。
   */
  function isThinking() {
    return hasStopButton();
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

  window.GptGithubHelper.pageReader = {
    getPageText,
    isThinking,
    getLastAssistantMessageText,
    getLastUserMessageText
  };
})();
