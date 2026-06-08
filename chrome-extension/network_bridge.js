// network_bridge.js
// -----------------------------------------------------------------------------
// 网络状态桥接模块。
//
// network_watcher.js 会在页面 MAIN world 里运行，负责监听 ChatGPT 页面接口请求。
// 本文件运行在普通 content script 环境里，负责接收 watcher 发来的 postMessage，
// 并包装 pageReader.isThinking()。
//
// 判断优先级：
// 1. 有活跃回答流接口：按网络请求判断为回答中。
// 2. 回答流接口刚结束：继续等待短暂缓冲，避免保存半截回复。
// 3. 超过缓冲时间后：不长期使用旧网络结束状态，回退 DOM 文本稳定判断。
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const MESSAGE_SOURCE = 'GPT_GITHUB_HELPER_NETWORK_WATCHER';
  const MESSAGE_TYPE = 'GPT_GITHUB_HELPER_NETWORK_EVENT';
  const NETWORK_FINISH_GRACE_MS = 1200;

  const activeRequests = new Map();

  const networkState = {
    installed: false,
    lastEvent: null,
    lastStartAt: 0,
    lastEndAt: 0,
    lastUrl: '',
    lastSourceType: '',
    activeRequestCount: 0
  };

  let originalIsThinking = null;
  let originalGetThinkingDebug = null;
  let lastBridgeThinkingDebug = null;

  function handleNetworkEvent(data) {
    const eventName = data.event;
    const requestId = data.requestId || '';
    const now = Date.now();

    // 能收到任意 network_watcher 事件，就说明 MAIN world 脚本已经生效。
    // installed 事件可能发生在 bridge 绑定监听之前，所以不能只依赖 installed 事件。
    networkState.installed = true;
    networkState.lastEvent = data;
    networkState.lastUrl = data.url || '';
    networkState.lastSourceType = data.sourceType || '';

    if (eventName === 'start' && requestId) {
      activeRequests.set(requestId, data);
      networkState.lastStartAt = data.at || now;
    }

    if ((eventName === 'end' || eventName === 'error') && requestId) {
      activeRequests.delete(requestId);
      networkState.lastEndAt = data.at || now;
    }

    networkState.activeRequestCount = activeRequests.size;
  }

  function bindNetworkMessageListener() {
    window.addEventListener('message', event => {
      if (event.source !== window) {
        return;
      }

      const data = event.data || {};

      if (data.source !== MESSAGE_SOURCE || data.type !== MESSAGE_TYPE) {
        return;
      }

      handleNetworkEvent(data);
    });
  }

  function getNetworkThinkingState() {
    const now = Date.now();

    // 有活跃回答流接口，直接认为回答中。
    if (activeRequests.size > 0) {
      return {
        available: true,
        thinking: true,
        reason: 'network_stream_active',
        activeRequestCount: activeRequests.size,
        lastUrl: networkState.lastUrl,
        lastSourceType: networkState.lastSourceType,
        lastEvent: networkState.lastEvent
      };
    }

    // 接口刚结束时保留短暂缓冲，等待页面最后 DOM 更新完成。
    if (networkState.lastEndAt && now - networkState.lastEndAt < NETWORK_FINISH_GRACE_MS) {
      return {
        available: true,
        thinking: true,
        reason: 'network_stream_ending_grace',
        activeRequestCount: 0,
        lastUrl: networkState.lastUrl,
        lastSourceType: networkState.lastSourceType,
        lastEvent: networkState.lastEvent,
        lastEndAgoMs: now - networkState.lastEndAt
      };
    }

    // 关键：超过缓冲时间后，不再长期使用旧的 network_stream_finished。
    // 这样可以避免上一次接口结束状态影响下一轮判断，导致误判“已结束”。
    return {
      available: false,
      thinking: false,
      reason: networkState.lastStartAt
        ? 'network_stream_finished_fallback_dom'
        : (networkState.installed ? 'network_installed_no_request' : 'network_not_installed'),
      activeRequestCount: 0,
      lastUrl: networkState.lastUrl,
      lastSourceType: networkState.lastSourceType,
      lastEvent: networkState.lastEvent,
      lastEndAgoMs: networkState.lastEndAt ? now - networkState.lastEndAt : null
    };
  }

  function patchPageReader() {
    const pageReader = window.GptGithubHelper.pageReader;

    if (!pageReader || typeof pageReader.isThinking !== 'function') {
      return false;
    }

    if (pageReader.__networkBridgePatched) {
      return true;
    }

    originalIsThinking = pageReader.isThinking.bind(pageReader);
    originalGetThinkingDebug = typeof pageReader.getThinkingDebug === 'function'
      ? pageReader.getThinkingDebug.bind(pageReader)
      : null;

    pageReader.isThinking = function networkFirstIsThinking() {
      const networkThinkingState = getNetworkThinkingState();

      if (networkThinkingState.available) {
        lastBridgeThinkingDebug = {
          thinking: networkThinkingState.thinking,
          reason: networkThinkingState.reason,
          source: 'network',
          activeRequestCount: networkThinkingState.activeRequestCount,
          lastUrl: networkThinkingState.lastUrl,
          lastSourceType: networkThinkingState.lastSourceType,
          lastEndAgoMs: networkThinkingState.lastEndAgoMs ?? null,
          networkInstalled: networkState.installed
        };

        return networkThinkingState.thinking;
      }

      const domThinking = originalIsThinking();
      const domDebug = originalGetThinkingDebug ? originalGetThinkingDebug() : {};

      lastBridgeThinkingDebug = {
        ...domDebug,
        source: 'dom_fallback',
        networkReason: networkThinkingState.reason,
        networkInstalled: networkState.installed,
        lastNetworkUrl: networkThinkingState.lastUrl,
        lastNetworkEndAgoMs: networkThinkingState.lastEndAgoMs ?? null
      };

      return domThinking;
    };

    pageReader.getThinkingDebug = function networkFirstThinkingDebug() {
      return lastBridgeThinkingDebug || {
        source: 'network_bridge_init',
        networkInstalled: networkState.installed,
        activeRequestCount: activeRequests.size,
        originalDebug: originalGetThinkingDebug ? originalGetThinkingDebug() : null
      };
    };

    pageReader.getNetworkDebug = function getNetworkDebug() {
      return {
        ...networkState,
        activeRequestIds: Array.from(activeRequests.keys()),
        networkThinkingState: getNetworkThinkingState()
      };
    };

    pageReader.__networkBridgePatched = true;
    return true;
  }

  function waitAndPatchPageReader(retryCount = 0) {
    if (patchPageReader()) {
      return;
    }

    if (retryCount < 50) {
      setTimeout(() => waitAndPatchPageReader(retryCount + 1), 100);
    }
  }

  window.GptGithubHelper.networkBridge = {
    getNetworkThinkingState,
    getNetworkDebug: () => ({
      ...networkState,
      activeRequestIds: Array.from(activeRequests.keys()),
      networkThinkingState: getNetworkThinkingState()
    })
  };

  bindNetworkMessageListener();
  waitAndPatchPageReader();
})();
