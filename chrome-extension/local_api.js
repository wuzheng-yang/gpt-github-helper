// local_api.js
// -----------------------------------------------------------------------------
// 页面事件 -> 本地 Python 服务 的封装层。
//
// 这个文件只负责“组装请求数据”和“调用 background.js 中转请求”。
// 它不直接 fetch 127.0.0.1，原因是 ChatGPT 页面环境可能拦截本机地址请求。
//
// 调用链路：
// content.js
//   -> localApi.callLocalNotifyApi(type, extraData)
//   -> local_api.js 构建 payload
//   -> chrome.runtime.sendMessage(...)
//   -> background.js
//   -> http://127.0.0.1:18888
// -----------------------------------------------------------------------------

(function () {
  // 所有插件模块统一挂到 window.GptGithubHelper，避免多个全局变量互相污染。
  window.GptGithubHelper = window.GptGithubHelper || {};

  // config：读取本地服务地址、标题配置等。
  // pageReader：读取最后一条用户消息、最后一条 GPT 回复、完整会话快照。
  const { config, pageReader } = window.GptGithubHelper;

  // ---------------------------------------------------------------------------
  // 事件类型和后端接口路径映射。
  //
  // finished：GPT 回答结束，保存会话 Markdown。
  // github：检测到 GitHub 工具确认请求，记录确认日志。
  // ---------------------------------------------------------------------------
  const API_PATHS = {
    finished: '/gpt-finished',
    github: '/github-confirm-request'
  };

  function getLocalServerBaseUrl() {
    return String(config.localServerBaseUrl || '').trim();
  }

  /**
   * 安全获取完整会话快照。
   *
   * 返回内容来自 page_reader.js：
   * {
   *   messageCount: number,
   *   messages: [...],
   *   fullPageText: string
   * }
   *
   * 为什么要 try/catch：
   * ChatGPT 页面 DOM 经常变化，如果某次读取快照失败，不应该影响回答结束通知。
   * 最坏情况是后端退回旧逻辑，只保存最后一轮 userText / replyText。
   */
  function getSafeConversationSnapshot() {
    try {
      // 兼容老版本 page_reader.js：如果没有 getConversationSnapshot，就直接返回 null。
      if (!pageReader || typeof pageReader.getConversationSnapshot !== 'function') {
        return null;
      }

      return pageReader.getConversationSnapshot();
    } catch (error) {
      console.warn('[GPT GitHub Helper] 获取完整会话快照失败：', error);
      return null;
    }
  }

  /**
   * 构建发送给本地服务的 payload。
   *
   * @param {string} type 事件类型：finished / github
   * @param {object} extraData 由 content.js 额外传入的数据
   *
   * 基础字段说明：
   * - type：事件类型
   * - title：当前浏览器标题，可能是“回答中/已结束”状态标题
   * - url：当前 ChatGPT 页面 URL
   * - userText：最后一条用户消息
   * - replyText：最后一条 GPT 回复
   * - pageTime：浏览器侧时间，方便和后端日志对齐
   *
   * 注意：
   * 完整快照只在 finished 事件中发送。
   * GitHub 日志事件不发送完整快照，避免请求体太大。
   */
  function buildPayload(type, extraData = {}) {
    const payload = {
      type,
      title: document.title,
      url: location.href,
      userText: pageReader.getLastUserMessageText(),
      replyText: pageReader.getLastAssistantMessageText(),
      pageTime: new Date().toISOString(),
      ...extraData
    };

    // 只在回答结束事件里发送完整快照。
    // 后端 local_notify_server.py 会优先读取 pageData 并覆盖写入完整 Markdown。
    if (type === 'finished') {
      const snapshot = getSafeConversationSnapshot();

      if (snapshot) {
        payload.pageData = snapshot;
      }
    }

    return payload;
  }

  /**
   * 通过 background.js 请求本地 Python 服务。
   *
   * @param {string} requestUrl 完整接口地址，例如 http://127.0.0.1:18888/gpt-finished
   * @param {object} payload 请求体
   *
   * 这里不直接 fetch，而是发消息给 background.js。
   * background.js 会统一处理 GET/POST、JSON 序列化、错误日志和响应解析。
   */
  function sendByBackground(requestUrl, payload) {
    chrome.runtime.sendMessage(
      {
        type: 'CALL_LOCAL_SERVER',
        url: requestUrl,
        payload
      },
      response => {
        // chrome.runtime.lastError 常见于：
        // 1. 插件刚重新加载，消息通道断开
        // 2. background service worker 未及时响应
        // 3. 扩展上下文失效
        if (chrome.runtime.lastError) {
          console.warn(
            '[GPT GitHub Helper] 调用本地服务失败：',
            chrome.runtime.lastError.message
          );
          return;
        }

        // background.js 成功响应，但本地服务请求失败。
        // 例如 Python 服务未启动、接口报错、端口不对。
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
   * 对外暴露的方法：发送 GPT 结束或 GitHub 确认请求事件。
   *
   * @param {string} type 事件类型：finished / github
   * @param {object} extraData 额外数据，例如 conversationTitle、githubFilePath、securityOk
   *
   * 这个方法由 content.js 调用。
   */
  function callLocalNotifyApi(type, extraData = {}) {
    const path = API_PATHS[type];

    // 未知事件类型直接忽略，避免错误请求。
    if (!path) {
      return;
    }

    const baseUrl = getLocalServerBaseUrl();

    if (!baseUrl) {
      return;
    }

    const requestUrl = baseUrl + path;
    const payload = buildPayload(type, extraData);

    sendByBackground(requestUrl, payload);
  }

  // 暴露给 content.js 使用。
  window.GptGithubHelper.localApi = {
    callLocalNotifyApi,
    getLocalServerBaseUrl
  };
})();
