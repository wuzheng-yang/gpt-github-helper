// page_reader.js
// 负责读取 ChatGPT 页面状态和消息内容。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  function getPageText() {
    return document.body?.innerText || '';
  }

  function isThinking() {
    const text = getPageText();

    // ChatGPT 页面文案可能会变化，所以这里多写几个关键词。
    return [
      '停止思考',
      '停止生成',
      'Stop generating',
      'Thinking',
      'Generating'
    ].some(keyword => text.includes(keyword));
  }

  function getLastMessageText(role) {
    const messages = Array.from(
      document.querySelectorAll(`[data-message-author-role="${role}"]`)
    );

    if (!messages.length) {
      return '';
    }

    return messages[messages.length - 1].innerText?.trim() || '';
  }

  function getLastAssistantMessageText() {
    return getLastMessageText('assistant');
  }

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
