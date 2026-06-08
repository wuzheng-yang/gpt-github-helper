// network_bridge.js
// -----------------------------------------------------------------------------
// 网络状态桥接模块。
//
// network_watcher.js 会在页面 MAIN world 里运行，负责监听 ChatGPT 页面接口请求。
// 本文件运行在普通 content script 环境里，负责接收 watcher 发来的 postMessage，
// 并包装 pageReader.isThinking()。
//
// 判断优先级：
// 1. 如果已经捕获到回答流接口：优先按网络请求是否结束判断。
// 2. 如果还没有捕获到接口：回退到 page_reader.js 原来的 DOM 文本变化判断。
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

    if (networkState.lastStartAt) {
      return {
        available: true,
        thinking: false,
        reason: 'network_stream_finished',
        activeRequestCount: 0,
        lastUrl: networkState.lastUrl,
        lastSourceType: networkState.lastSourceType,
        lastEvent: networkState.lastEvent,
        lastEndAgoMs: networkState.lastEndAt ? now - networkState.lastEndAt : null
      };
    }

    return {
      available: false,
      thinking: false,
      reason: networkState.installed ? 'network_installed_no_request' : 'network_not_installed',
      activeRequestCount: 0,
      lastUrl: networkState.lastUrl,
      lastSourceType: networkState.lastSourceType,
      lastEvent: networkState.lastEvent
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
        networkInstalled: networkState.installed
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
