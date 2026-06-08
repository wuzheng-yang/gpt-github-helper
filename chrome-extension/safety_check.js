// safety_check.js
// 负责 GitHub 工具请求安全校验。

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

  function isBlockedBranch(text, branch) {
    return text.includes(`branch '${branch}'`) || text.includes(`branch "${branch}"`);
  }

  function isBlockedPath(filePath, blockedPath) {
    const normalizedFilePath = filePath.replaceAll('\\', '/');
    const normalizedBlockedPath = blockedPath.replaceAll('\\', '/');

    if (!normalizedFilePath || !normalizedBlockedPath) {
      return false;
    }

    if (normalizedBlockedPath.endsWith('/')) {
      return normalizedFilePath.startsWith(normalizedBlockedPath);
    }

    return normalizedFilePath === normalizedBlockedPath ||
      normalizedFilePath.endsWith(`/${normalizedBlockedPath}`);
  }

  function isAllowedRepo(text, repo) {
    return text.includes(repo);
  }

  function checkSafety(text) {
    const filePath = extractFilePath(text);

    const result = {
      ok: false,
      filePath,
      reasons: []
    };

    const repoOk = config.allowedRepos.some(repo => isAllowedRepo(text, repo));

    if (!repoOk) {
      result.reasons.push(`仓库不在允许列表：${config.allowedRepos.join(', ')}`);
    }

    const blockedBranch = config.blockedBranches.find(branch => isBlockedBranch(text, branch));

    if (blockedBranch) {
      result.reasons.push(`分支不允许操作：${blockedBranch}`);
    }

    const actionOk = config.allowedActions.some(action => text.includes(action));

    if (!actionOk) {
      result.reasons.push(`操作类型不允许，只允许：${config.allowedActions.join(', ')}`);
    }

    const blockedPath = config.blockedPaths.find(item => isBlockedPath(filePath, item));

    if (blockedPath) {
      result.reasons.push(`文件路径不允许修改：${blockedPath}`);
    }

    const dangerWord = config.dangerWords.find(word => text.includes(word));

    if (dangerWord) {
      result.reasons.push(`发现危险词：${dangerWord}`);
    }

    result.ok = result.reasons.length === 0;

    return result;
  }

  window.GptGithubHelper.safetyCheck = {
    checkSafety,
    extractFilePath
  };
})();
