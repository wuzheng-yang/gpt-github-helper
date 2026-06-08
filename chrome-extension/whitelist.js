// whitelist.js
// 负责 GitHub 工具请求白名单校验。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const { config } = window.GptGithubHelper;

  function extractFilePath(text) {
    const match = text.match(/GitHub file\s+([^\?\n\r]+)/);

    if (!match) {
      return '';
    }

    return match[1].trim();
  }

  function checkWhitelist(text) {
    const filePath = extractFilePath(text);

    const result = {
      ok: false,
      filePath,
      reasons: []
    };

    if (!text.includes(config.allowedRepo)) {
      result.reasons.push(`仓库不是 ${config.allowedRepo}`);
    }

    const branchOk = config.allowedBranches.some(branch => {
      return text.includes(`branch '${branch}'`) || text.includes(`branch "${branch}"`);
    });

    if (!branchOk) {
      result.reasons.push(`分支不在白名单：${config.allowedBranches.join(', ')}`);
    }

    const actionOk = config.allowedActions.some(action => text.includes(action));

    if (!actionOk) {
      result.reasons.push(`操作类型不允许，只允许：${config.allowedActions.join(', ')}`);
    }

    const pathOk = config.allowedPathPrefixes.some(prefix => {
      return filePath === prefix || filePath.startsWith(prefix);
    });

    if (!pathOk) {
      result.reasons.push(`文件路径不在白名单：${filePath || '未识别'}`);
    }

    const dangerWord = config.dangerWords.find(word => text.includes(word));

    if (dangerWord) {
      result.reasons.push(`发现危险词：${dangerWord}`);
    }

    result.ok = result.reasons.length === 0;

    return result;
  }

  window.GptGithubHelper.whitelist = {
    checkWhitelist,
    extractFilePath
  };
})();
