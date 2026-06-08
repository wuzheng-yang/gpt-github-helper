// local_api.js
// 负责把页面事件发送到本地 Python 服务。
//
// 注意：
// content script 直接 fetch http://127.0.0.1 可能会被 Chrome 拦截。
// 所以这里统一通过 background.js 中转请求本地服务。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const { config, pageReader } = window.GptGithubHelper;

  const API_PATHS = {
    finished: '/gpt-finished',
    github: '/github-confirm-request'
  };

  /**
   * 构建发送给本地服务的数据。
   */
  function buildPayload(type, extraData = {}) {
    return {
      type,
      title: document.title,
      url: location.href,
      userText: pageReader.getLastUserMessageText(),
      replyText: pageReader.getLastAssistantMessageText(),
      pageTime: new Date().toISOString(),
      ...extraData
    };
  }

  /**
   * 通过插件后台脚本调用本地服务。
   */
  function sendByBackground(requestUrl, payload) {
    chrome.runtime.sendMessage(
      {
        type: 'CALL_LOCAL_SERVER',
        url: requestUrl,
        payload
      },
      response => {
        // background.js 没有响应，或者插件刚刷新导致消息通道断开
        if (chrome.runtime.lastError) {
          console.warn(
            '[GPT GitHub Helper] 调用本地服务失败：',
            chrome.runtime.lastError.message
          );
          return;
        }

        // 本地服务请求失败
        if (!response || !response.success) {
          console.warn(
            '[GPT GitHub Helper] 本地服务返回失败：',
            response
          );
          return;
        }

        console.log('[GPT GitHub Helper] 本地服务调用成功：', response);
      }
    );
  }

  /**
   * 对外方法：发送 GPT 结束或 GitHub 确认请求事件。
   */
  function callLocalNotifyApi(type, extraData = {}) {
    const path = API_PATHS[type];

    if (!path) {
      return;
    }

    const requestUrl = config.localServerBaseUrl + path;
    const payload = buildPayload(type, extraData);

    sendByBackground(requestUrl, payload);
  }

  window.GptGithubHelper.localApi = {
    callLocalNotifyApi
  };
})();
