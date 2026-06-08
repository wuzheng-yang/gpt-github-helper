// local_api.js
// 负责把页面事件发送到本地 Python 服务。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const { config, pageReader } = window.GptGithubHelper;

  const API_PATHS = {
    finished: '/gpt-finished',
    github: '/github-confirm-request'
  };

  function callLocalNotifyApi(type, extraData = {}) {
    const path = API_PATHS[type];

    if (!path) {
      return;
    }

    const payload = {
      type,
      title: document.title,
      url: location.href,
      userText: pageReader.getLastUserMessageText(),
      replyText: pageReader.getLastAssistantMessageText(),
      pageTime: new Date().toISOString(),
      ...extraData
    };

    fetch(config.localServerBaseUrl + path, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(error => {
      console.warn('[GPT GitHub Helper] 调用本地服务失败：', error);
    });
  }

  window.GptGithubHelper.localApi = {
    callLocalNotifyApi
  };
})();
