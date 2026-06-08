// background.js
// -----------------------------------------------------------------------------
// Chrome 扩展后台脚本。
//
// 作用：
// 1. 接收 content script 发来的本地服务请求。
// 2. 由 background service worker 代替页面请求 http://127.0.0.1:18888。
// 3. 把本地服务响应结果再返回给 content script。
//
// 为什么需要它：
// ChatGPT 页面属于 https://chatgpt.com。
// 页面脚本直接请求 http://127.0.0.1 可能触发：
// - CORS 限制
// - Private Network Access 限制
// - loopback address space 拦截
//
// 通过 background.js 请求时，可以使用 manifest.json 里的 host_permissions。
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ---------------------------------------------------------------------------
  // 只处理本插件定义的本地服务请求。
  //
  // content.js / local_api.js 会发送：
  // {
  //   type: 'CALL_LOCAL_SERVER',
  //   url: 'http://127.0.0.1:18888/xxx',
  //   method: 'GET' | 'POST',
  //   payload: {...}
  // }
  //
  // 其他消息直接忽略，避免影响页面或其他扩展逻辑。
  // ---------------------------------------------------------------------------
  if (!message || message.type !== 'CALL_LOCAL_SERVER') {
    return false;
  }

  const { url, payload, method = 'POST' } = message;

  // 没有 URL 时无法请求本地服务，直接返回错误。
  if (!url) {
    sendResponse({
      success: false,
      error: '缺少 url'
    });
    return false;
  }

  // 统一转换成大写，方便下面判断 GET / POST。
  const requestMethod = String(method || 'POST').toUpperCase();

  const fetchOptions = {
    method: requestMethod,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // GET 请求不能带 body。
  // POST / PUT 等请求才把 payload 序列化成 JSON 请求体。
  if (requestMethod !== 'GET') {
    fetchOptions.body = JSON.stringify(payload || {});
  }

  // ---------------------------------------------------------------------------
  // 发起本地请求。
  //
  // 本地服务一般返回 JSON，但为了兼容异常响应或纯文本响应：
  // 1. 先读取 response.text()
  // 2. 尝试 JSON.parse
  // 3. 解析失败就保留原始字符串
  // ---------------------------------------------------------------------------
  fetch(url, fetchOptions)
    .then(async response => {
      const text = await response.text();
      let body = text;

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
      // 请求失败通常是：
      // 1. Python 服务没有启动
      // 2. 端口不是 18888
      // 3. 本地服务启动后又退出了
      // 4. 插件没有重新加载 host_permissions
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

  // 必须返回 true。
  //
  // Chrome 扩展消息机制中，如果要异步调用 sendResponse，必须 return true，
  // 否则消息通道会提前关闭，content script 收不到异步结果。
  return true;
});
