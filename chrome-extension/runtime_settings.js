// runtime_settings.js
// -----------------------------------------------------------------------------
// 本地服务地址运行时配置。
//
// 作用：
// 1. 页面加载后读取 chrome.storage.local 中保存的本地服务地址。
// 2. 合并到 window.GptGithubHelper.config.localServerBaseUrl。
// 3. 提供保存方法给右侧配置面板使用。
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const helper = window.GptGithubHelper;
  const storageKey = 'gpt_github_helper_local_server_url';

  /**
   * 判断 chrome.storage.local 是否可用。
   */
  function hasStorageApi() {
    return Boolean(
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    );
  }

  /**
   * 清理服务地址。
   */
  function normalizeUrl(url) {
    const value = String(url || '').trim();
    return value || 'http://127.0.0.1:18888';
  }

  /**
   * 应用服务地址到全局配置对象。
   */
  function applyLocalServerUrl(url) {
    helper.config = helper.config || {};
    helper.config.localServerBaseUrl = normalizeUrl(url);
    return helper.config.localServerBaseUrl;
  }

  /**
   * 读取已保存的服务地址。
   */
  function loadLocalServerUrl() {
    return new Promise(resolve => {
      if (!hasStorageApi()) {
        resolve(helper.config && helper.config.localServerBaseUrl);
        return;
      }

      chrome.storage.local.get([storageKey], result => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[GPT GitHub Helper] 读取本地服务地址失败：', chrome.runtime.lastError.message);
          resolve(helper.config && helper.config.localServerBaseUrl);
          return;
        }

        const savedUrl = result && result[storageKey];
        resolve(savedUrl ? applyLocalServerUrl(savedUrl) : helper.config.localServerBaseUrl);
      });
    });
  }

  /**
   * 保存服务地址。
   */
  function saveLocalServerUrl(url) {
    return new Promise((resolve, reject) => {
      const nextUrl = applyLocalServerUrl(url);

      if (!hasStorageApi()) {
        resolve(nextUrl);
        return;
      }

      chrome.storage.local.set({ [storageKey]: nextUrl }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(nextUrl);
      });
    });
  }

  helper.runtimeSettings = {
    storageKey,
    normalizeUrl,
    applyLocalServerUrl,
    loadLocalServerUrl,
    saveLocalServerUrl
  };

  loadLocalServerUrl();
})();
