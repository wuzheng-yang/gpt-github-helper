// runtime_settings.js
// -----------------------------------------------------------------------------
// 运行时配置。
//
// 作用：
// 1. 页面加载后读取 chrome.storage.local 中保存的配置。
// 2. 合并到 window.GptGithubHelper.config。
// 3. 提供保存方法给右侧配置面板使用。
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const helper = window.GptGithubHelper;
  const storageKey = 'gpt_github_helper_runtime_config';
  const legacyLocalServerUrlKey = 'gpt_github_helper_local_server_url';
  const configurableKeys = [
    'localServerBaseUrl',
    'allowedRepos',
    'blockedBranches',
    'allowedActions',
    'blockedPaths',
    'dangerWords'
  ];
  let defaultRuntimeConfig = null;

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
    return value;
  }

  /**
   * 清理列表配置。
   */
  function normalizeList(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  /**
   * 只保留允许运行时修改的配置项。
   */
  function normalizeRuntimeConfig(runtimeConfig) {
    const source = runtimeConfig || {};
    const nextConfig = {};

    configurableKeys.forEach(key => {
      if (!(key in source)) {
        return;
      }

      nextConfig[key] = key === 'localServerBaseUrl'
        ? normalizeUrl(source[key])
        : normalizeList(source[key]);
    });

    return nextConfig;
  }

  /**
   * 获取当前可编辑配置快照。
   */
  function getRuntimeConfig() {
    const config = helper.config || {};

    return normalizeRuntimeConfig({
      localServerBaseUrl: config.localServerBaseUrl,
      allowedRepos: config.allowedRepos,
      blockedBranches: config.blockedBranches,
      allowedActions: config.allowedActions,
      blockedPaths: config.blockedPaths,
      dangerWords: config.dangerWords
    });
  }

  function getDefaultRuntimeConfig() {
    if (!defaultRuntimeConfig) {
      defaultRuntimeConfig = getRuntimeConfig();
    }

    return normalizeRuntimeConfig(defaultRuntimeConfig);
  }

  /**
   * 应用运行时配置到全局配置对象。
   */
  function applyRuntimeConfig(runtimeConfig) {
    const nextConfig = normalizeRuntimeConfig(runtimeConfig);
    helper.config = helper.config || {};
    Object.assign(helper.config, nextConfig);
    return getRuntimeConfig();
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
   * 读取已保存的运行时配置。
   */
  function loadRuntimeConfig() {
    return new Promise(resolve => {
      if (!hasStorageApi()) {
        resolve(getRuntimeConfig());
        return;
      }

      chrome.storage.local.get([storageKey, legacyLocalServerUrlKey], result => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[GPT GitHub Helper] 读取运行时配置失败：', chrome.runtime.lastError.message);
          resolve(getRuntimeConfig());
          return;
        }

        const savedConfig = result && result[storageKey];
        const legacyLocalServerUrl = result && result[legacyLocalServerUrlKey];
        const mergedConfig = savedConfig || {};

        if (legacyLocalServerUrl && !mergedConfig.localServerBaseUrl) {
          mergedConfig.localServerBaseUrl = legacyLocalServerUrl;
        }

        resolve(savedConfig || legacyLocalServerUrl
          ? applyRuntimeConfig(mergedConfig)
          : getRuntimeConfig());
      });
    });
  }

  /**
   * 保存运行时配置。
   */
  function saveRuntimeConfig(runtimeConfig) {
    return new Promise((resolve, reject) => {
      const nextConfig = applyRuntimeConfig(runtimeConfig);

      if (!hasStorageApi()) {
        resolve(nextConfig);
        return;
      }

      chrome.storage.local.set({ [storageKey]: nextConfig }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(nextConfig);
      });
    });
  }

  /**
   * 兼容旧调用：保存服务地址。
   */
  function loadLocalServerUrl() {
    return loadRuntimeConfig().then(config => config.localServerBaseUrl);
  }

  function saveLocalServerUrl(url) {
    return saveRuntimeConfig({
      ...getRuntimeConfig(),
      localServerBaseUrl: url
    }).then(config => config.localServerBaseUrl);
  }

  defaultRuntimeConfig = getRuntimeConfig();

  helper.runtimeSettings = {
    storageKey,
    legacyLocalServerUrlKey,
    configurableKeys,
    normalizeUrl,
    normalizeList,
    normalizeRuntimeConfig,
    getRuntimeConfig,
    getDefaultRuntimeConfig,
    applyRuntimeConfig,
    loadRuntimeConfig,
    saveRuntimeConfig,
    applyLocalServerUrl,
    loadLocalServerUrl,
    saveLocalServerUrl
  };

  loadRuntimeConfig();
})();
