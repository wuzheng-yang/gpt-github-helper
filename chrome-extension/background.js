// background.js
// 插件后台脚本：负责代替 content script 请求本地 Python 服务。
//
// 原因：
// ChatGPT 页面属于 https://chatgpt.com，直接 fetch http://127.0.0.1
// 会被 Chrome 的 Private Network Access / loopback 策略拦截。
// 通过扩展后台脚本发请求，可以使用 manifest.json 里的 host_permissions。

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 只处理本插件定义的本地服务请求
  if (!message || message.type !== 'CALL_LOCAL_SERVER') {
    return false;
  }

  const { url, payload, method = 'POST' } = message;

  if (!url) {
    sendResponse({
      success: false,
      error: '缺少 url'
    });
    return false;
  }

  const requestMethod = String(method || 'POST').toUpperCase();

  const fetchOptions = {
    method: requestMethod,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // GET 请求不能带 body，其他请求才发送 JSON 请求体。
  if (requestMethod !== 'GET') {
    fetchOptions.body = JSON.stringify(payload || {});
  }

  // 在后台脚本里请求本地服务，避免页面环境 CORS / loopback 拦截
  fetch(url, fetchOptions)
    .then(async response => {
      const text = await response.text();
      let body = text;

      // 本地 FastAPI 多数返回 JSON，这里尽量解析，失败就保留原始文本。
      try {
        body = JSON.parse(text);
      } catch (error) {
        body = text;
      }

      sendResponse({
        success: response.ok,
        status: response.status,
        body
      });
    })
    .catch(error => {
      console.warn('[GPT GitHub Helper Background] 请求本地服务失败：', {
        url,
        method: requestMethod,
        error: String(error),
        tip: '请检查 local-server 是否已启动，端口是否为 18888'
      });

      sendResponse({
        success: false,
        error: String(error),
        url,
        method: requestMethod,
        tip: '本地服务可能没有启动，请检查 http://127.0.0.1:18888/health'
      });
    });

  // 返回 true，表示 sendResponse 会异步执行
  return true;
});
