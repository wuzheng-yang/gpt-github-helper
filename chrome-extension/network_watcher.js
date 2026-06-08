// network_watcher.js
// -----------------------------------------------------------------------------
// 页面真实上下文里的网络监听脚本。
//
// 这个文件会被 content.js 通过 <script src="chrome-extension://..."> 自动注入。
// 用户不需要手工在控制台执行任何脚本。
//
// 为什么要注入页面上下文：
// content script 和网页自身 JS 是隔离环境，content script 不能直接劫持页面里的
// window.fetch / XMLHttpRequest。把这个文件作为 script 标签插入页面后，它就运行在
// ChatGPT 页面真实 JS 上下文里，可以包装页面原生 fetch / XHR。
//
// 作用：
// 1. 监听疑似 ChatGPT 回答流的接口请求。
// 2. 请求开始时发送 start 事件。
// 3. fetch 响应 body 读取完时发送 end 事件。
// 4. XHR loadend / error / abort / timeout 时发送 end / error 事件。
// 5. 通过 window.postMessage 把事件发给 content.js。
//
// 注意：
// - 这里只判断请求开始/结束，不保存接口返回内容。
// - fetch 使用 response.clone() 读取副本，不影响 ChatGPT 页面正常读取响应。
// - ChatGPT 接口路径可能变化，所以匹配条件做了多关键词兼容。
// -----------------------------------------------------------------------------

(function () {
  // 防止插件重复注入导致 fetch / XHR 被多次包装。
  if (window.__GPT_GITHUB_HELPER_NETWORK_WATCHER_INSTALLED__) {
    return;
  }

  window.__GPT_GITHUB_HELPER_NETWORK_WATCHER_INSTALLED__ = true;

  const MESSAGE_SOURCE = 'GPT_GITHUB_HELPER_NETWORK_WATCHER';
  const MESSAGE_TYPE = 'GPT_GITHUB_HELPER_NETWORK_EVENT';

  let requestSeq = 0;

  /**
   * 生成请求 ID。
   *
   * 只需要在当前页面唯一即可，用于把 start / end 对应到同一条请求。
   */
  function nextRequestId(prefix) {
    requestSeq += 1;
    return `${prefix}-${Date.now()}-${requestSeq}`;
  }

  /**
   * 把 fetch / XHR 的请求目标统一转换成 URL 字符串。
   */
  function getRequestUrl(input) {
    try {
      if (typeof input === 'string') {
        return input;
      }

      if (input instanceof URL) {
        return input.href;
      }

      if (input && typeof input.url === 'string') {
        return input.url;
      }
    } catch (error) {
      return '';
    }

    return '';
  }

  /**
   * 判断请求是否像 ChatGPT 的回答流请求。
   *
   * 不监听所有请求的原因：
   * 页面里还有图片、配置、埋点、账号状态等大量请求，全监听会产生噪音。
   */
  function shouldWatchUrl(url) {
    const value = String(url || '').toLowerCase();

    if (!value) {
      return false;
    }

    const looksLikeChatBackend =
      value.includes('/backend-api/') ||
      value.includes('/conversation') ||
      value.includes('/responses') ||
      value.includes('/completion') ||
      value.includes('/stream');

    const looksLikeChatAction =
      value.includes('conversation') ||
      value.includes('response') ||
      value.includes('completion') ||
      value.includes('message') ||
      value.includes('stream') ||
      value.includes('turn');

    return looksLikeChatBackend && looksLikeChatAction;
  }

  /**
   * 把网络事件发给 content.js。
   */
  function postNetworkEvent(event) {
    window.postMessage({
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE,
      ...event,
      at: Date.now()
    }, '*');
  }

  /**
   * 包装 fetch。
   *
   * fetch 的 Promise 在响应头到达时就会 resolve，不代表流式 body 已经结束。
   * 所以这里 clone 一份 response，读取 clone.body，读完后才发送 end。
   */
  function patchFetch() {
    if (typeof window.fetch !== 'function') {
      return;
    }

    const rawFetch = window.fetch;

    window.fetch = async function patchedFetch(input, init) {
      const url = getRequestUrl(input);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const watch = shouldWatchUrl(url);
      const requestId = watch ? nextRequestId('fetch') : '';

      if (watch) {
        postNetworkEvent({
          event: 'start',
          sourceType: 'fetch',
          requestId,
          method,
          url
        });
      }

      try {
        const response = await rawFetch.apply(this, arguments);

        if (!watch) {
          return response;
        }

        try {
          const clonedResponse = response.clone();

          if (clonedResponse.body && typeof clonedResponse.body.getReader === 'function') {
            const reader = clonedResponse.body.getReader();

            (async () => {
              try {
                while (true) {
                  const result = await reader.read();

                  if (result.done) {
                    break;
                  }
                }

                postNetworkEvent({
                  event: 'end',
                  sourceType: 'fetch',
                  requestId,
                  method,
                  url,
                  status: response.status
                });
              } catch (error) {
                postNetworkEvent({
                  event: 'error',
                  sourceType: 'fetch',
                  requestId,
                  method,
                  url,
                  error: String(error),
                  status: response.status
                });
              }
            })();
          } else {
            clonedResponse.arrayBuffer()
              .then(() => {
                postNetworkEvent({
                  event: 'end',
                  sourceType: 'fetch',
                  requestId,
                  method,
                  url,
                  status: response.status
                });
              })
              .catch(error => {
                postNetworkEvent({
                  event: 'error',
                  sourceType: 'fetch',
                  requestId,
                  method,
                  url,
                  error: String(error),
                  status: response.status
                });
              });
          }
        } catch (error) {
          postNetworkEvent({
            event: 'error',
            sourceType: 'fetch',
            requestId,
            method,
            url,
            error: String(error),
            status: response.status
          });
        }

        return response;
      } catch (error) {
        if (watch) {
          postNetworkEvent({
            event: 'error',
            sourceType: 'fetch',
            requestId,
            method,
            url,
            error: String(error)
          });
        }

        throw error;
      }
    };
  }

  /**
   * 包装 XMLHttpRequest。
   *
   * 现在 ChatGPT 主请求多数是 fetch，这里只是兜底兼容 XHR。
   */
  function patchXhr() {
    if (!window.XMLHttpRequest) {
      return;
    }

    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__gptGithubHelperMethod = String(method || 'GET').toUpperCase();
      this.__gptGithubHelperUrl = getRequestUrl(url);
      return rawOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      const url = this.__gptGithubHelperUrl || '';
      const method = this.__gptGithubHelperMethod || 'GET';
      const watch = shouldWatchUrl(url);
      const requestId = watch ? nextRequestId('xhr') : '';

      if (watch) {
        postNetworkEvent({
          event: 'start',
          sourceType: 'xhr',
          requestId,
          method,
          url
        });

        this.addEventListener('loadend', () => {
          postNetworkEvent({
            event: 'end',
            sourceType: 'xhr',
            requestId,
            method,
            url,
            status: this.status
          });
        });

        this.addEventListener('error', () => {
          postNetworkEvent({
            event: 'error',
            sourceType: 'xhr',
            requestId,
            method,
            url,
            status: this.status,
            error: 'xhr error'
          });
        });

        this.addEventListener('abort', () => {
          postNetworkEvent({
            event: 'error',
            sourceType: 'xhr',
            requestId,
            method,
            url,
            status: this.status,
            error: 'xhr abort'
          });
        });

        this.addEventListener('timeout', () => {
          postNetworkEvent({
            event: 'error',
            sourceType: 'xhr',
            requestId,
            method,
            url,
            status: this.status,
            error: 'xhr timeout'
          });
        });
      }

      return rawSend.apply(this, arguments);
    };
  }

  patchFetch();
  patchXhr();

  postNetworkEvent({
    event: 'installed',
    sourceType: 'watcher',
    requestId: 'network-watcher',
    method: 'INIT',
    url: location.href
  });
})();
