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

  const { url, payload } = message;

  if (!url || !payload) {
    sendResponse({
      success: false,
      error: '缺少 url 或 payload'
    });
    return false;
  }

  // 在后台脚本里请求本地服务，避免页面环境 CORS / loopback 拦截
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
    .then(async response => {
      const text = await response.text();

      sendResponse({
        success: response.ok,
        status: response.status,
        body: text
      });
    })
    .catch(error => {
      sendResponse({
        success: false,
        error: String(error)
      });
    });

  // 返回 true，表示 sendResponse 会异步执行
  return true;
});
