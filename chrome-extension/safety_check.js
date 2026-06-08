// safety_check.js
// 负责 GitHub 工具请求安全校验。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const { config } = window.GptGithubHelper;

  /**
   * 统一清理文本。
   * 说明：
   * 1. GitHub 工具确认卡片的文案可能有多余空格和换行。
   * 2. 先做轻量归一化，方便后续正则匹配。
   */
  function cleanText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+/g, ' ')
      .trim();
  }

  /**
   * 清理提取到的文件路径。
   * 说明：
   * 1. 去掉引号、反引号、句号等 UI 文案残留。
   * 2. 统一反斜杠为正斜杠，便于 blockedPaths 判断。
   */
  function cleanFilePath(filePath) {
    return cleanText(filePath)
      .replace(/^['"`]+|['"`]+$/g, '')
      .replace(/[?。.]$/g, '')
      .replaceAll('\\', '/')
      .trim();
  }

  /**
   * 从 GitHub 工具确认文案中提取文件路径。
   * 说明：
   * ChatGPT 页面文案可能变化，所以这里兼容多种格式：
   * - GitHub file chrome-extension/content.js
   * - file chrome-extension/content.js in repository ...
   * - Path: chrome-extension/content.js
   * - 文件：chrome-extension/content.js
   */
  function extractFilePath(text) {
    const value = cleanText(text);

    const patterns = [
      /GitHub file\s+([^?\n\r]+)/i,
      /file\s+([^\n\r]+?)\s+in\s+repository/i,
      /path\s*[:：]\s*([^\n\r]+)/i,
      /文件\s*[:：]\s*([^\n\r]+)/,
      /路径\s*[:：]\s*([^\n\r]+)/
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);

      if (match && match[1]) {
        return cleanFilePath(match[1]);
      }
    }

    return '';
  }

  /**
   * 判断是否命中禁止分支。
   * 说明：
   * 同时兼容英文 branch 'main'、branch: main 和中文 分支：main。
   */
  function isBlockedBranch(text, branch) {
    const value = cleanText(text);
    const escapedBranch = String(branch).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
      new RegExp(`branch\\s*['"]${escapedBranch}['"]`, 'i'),
      new RegExp(`branch\\s*[:：]\\s*${escapedBranch}`, 'i'),
      new RegExp(`分支\\s*[:：]\\s*${escapedBranch}`, 'i')
    ];

    return patterns.some(pattern => pattern.test(value));
  }

  function isBlockedPath(filePath, blockedPath) {
    const normalizedFilePath = cleanFilePath(filePath);
    const normalizedBlockedPath = cleanFilePath(blockedPath);

    if (!normalizedFilePath || !normalizedBlockedPath) {
      return false;
    }

    if (normalizedBlockedPath.endsWith('/')) {
      return normalizedFilePath.startsWith(normalizedBlockedPath);
    }

    return normalizedFilePath === normalizedBlockedPath ||
      normalizedFilePath.endsWith(`/${normalizedBlockedPath}`);
  }

  /**
   * 判断仓库是否在允许列表。
   */
  function isAllowedRepo(text, repo) {
    return cleanText(text).toLowerCase().includes(String(repo).toLowerCase());
  }

  /**
   * 判断操作类型是否允许。
   * 说明：
   * 1. 优先使用 config.allowedActions。
   * 2. 同时兼容连接器函数名，如 update_file / create_file / delete_file。
   * 3. 大小写不敏感，减少 UI 文案变化带来的误判。
   */
  function isAllowedAction(text) {
    const value = cleanText(text).toLowerCase();
    const allowedActions = config.allowedActions || [];

    return allowedActions.some(action => {
      const normalizedAction = String(action || '').toLowerCase();

      if (!normalizedAction) {
        return false;
      }

      return value.includes(normalizedAction);
    });
  }

  function checkSafety(text) {
    const value = cleanText(text);
    const filePath = extractFilePath(value);

    const result = {
      ok: false,
      filePath,
      reasons: []
    };

    const repoOk = (config.allowedRepos || []).some(repo => isAllowedRepo(value, repo));

    if (!repoOk) {
      result.reasons.push(`仓库不在允许列表：${(config.allowedRepos || []).join(', ')}`);
    }

    const blockedBranch = (config.blockedBranches || []).find(branch => isBlockedBranch(value, branch));

    if (blockedBranch) {
      result.reasons.push(`分支不允许操作：${blockedBranch}`);
    }

    const actionOk = isAllowedAction(value);

    if (!actionOk) {
      result.reasons.push(`操作类型不允许，只允许：${(config.allowedActions || []).join(', ')}`);
    }

    const blockedPath = (config.blockedPaths || []).find(item => isBlockedPath(filePath, item));

    if (blockedPath) {
      result.reasons.push(`文件路径不允许修改：${blockedPath}`);
    }

    const dangerWord = (config.dangerWords || []).find(word => value.includes(word));

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
