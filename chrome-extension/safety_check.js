// safety_check.js
// -----------------------------------------------------------------------------
// GitHub 工具请求配置校验模块。
//
// 这个文件负责判断当前 GitHub 工具确认请求是否符合 config.js 配置。
// 它不负责点击按钮，也不负责显示面板。
//
// 调用链路：
// content.js.handleGithubPrompt()
//   -> github_prompt.js 获取 GitHub 请求文本
//   -> safety_check.js checkSafety(text)
//   -> panel.js 显示结果
//   -> content.js 根据结果决定是否自动确认
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  // 读取 config.js 中的 allowedRepos / blockedBranches / allowedActions 等配置。
  const { config } = window.GptGithubHelper;

  /**
   * 统一清理文本。
   *
   * @param {string} text 原始文本
   * @returns {string} 清理后的文本
   *
   * 说明：
   * 1. GitHub 工具确认卡片里的空格、换行、不可见空格可能不统一。
   * 2. 先做轻量归一化，方便后续 includes / 正则匹配。
   * 3. 这里只压缩横向空白，不破坏太多内容。
   */
  function cleanText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+/g, ' ')
      .trim();
  }

  /**
   * 清理提取到的文件路径。
   *
   * @param {string} filePath 原始文件路径
   * @returns {string} 标准化后的文件路径
   *
   * 说明：
   * 1. 去掉前后引号、反引号。
   * 2. 去掉末尾问号、中文句号、英文句号。
   * 3. 把 Windows 反斜杠统一成正斜杠。
   * 4. 这样 blockedPaths 判断会更稳定。
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
   *
   * @param {string} text GitHub 确认卡片文本
   * @returns {string} 文件路径，识别失败返回空字符串
   *
   * 兼容格式：
   * - GitHub file chrome-extension/content.js
   * - file chrome-extension/content.js in repository ...
   * - Path: chrome-extension/content.js
   * - 文件：chrome-extension/content.js
   * - 路径：chrome-extension/content.js
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
   *
   * @param {string} text GitHub 请求文本
   * @param {string} branch 禁止分支名
   * @returns {boolean} 是否命中
   *
   * 兼容格式：
   * - branch 'main'
   * - branch "main"
   * - branch: main
   * - 分支：main
   */
  function isBlockedBranch(text, branch) {
    const value = cleanText(text);

    // 分支名可能包含特殊正则字符，这里先转义，避免构造 RegExp 时含义变化。
    const escapedBranch = String(branch).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
      new RegExp(`branch\\s*['"]${escapedBranch}['"]`, 'i'),
      new RegExp(`branch\\s*[:：]\\s*${escapedBranch}`, 'i'),
      new RegExp(`分支\\s*[:：]\\s*${escapedBranch}`, 'i')
    ];

    return patterns.some(pattern => pattern.test(value));
  }

  /**
   * 判断文件路径是否命中禁止路径。
   *
   * @param {string} filePath 当前 GitHub 工具请求里的文件路径
   * @param {string} blockedPath config.blockedPaths 中的一项
   * @returns {boolean} 是否命中
   *
   * 规则：
   * 1. blockedPath 以 / 结尾：认为是目录前缀。
   * 2. blockedPath 不以 / 结尾：认为是具体文件名或相对路径。
   */
  function isBlockedPath(filePath, blockedPath) {
    const normalizedFilePath = cleanFilePath(filePath);
    const normalizedBlockedPath = cleanFilePath(blockedPath);

    if (!normalizedFilePath || !normalizedBlockedPath) {
      return false;
    }

    // 目录前缀匹配，例如 dist/ 可以匹配 dist/main.js。
    if (normalizedBlockedPath.endsWith('/')) {
      return normalizedFilePath.startsWith(normalizedBlockedPath);
    }

    // 精确匹配或末尾路径匹配。
    // 例如 blockedPath='.env' 可以匹配 '.env' 或 'backend/.env'。
    return normalizedFilePath === normalizedBlockedPath ||
      normalizedFilePath.endsWith(`/${normalizedBlockedPath}`);
  }

  /**
   * 判断仓库是否在允许列表。
   *
   * @param {string} text GitHub 请求文本
   * @param {string} repo 仓库名，格式 owner/repo
   * @returns {boolean} 是否匹配
   */
  function isAllowedRepo(text, repo) {
    return cleanText(text).toLowerCase().includes(String(repo).toLowerCase());
  }

  /**
   * 判断操作类型是否允许。
   *
   * @param {string} text GitHub 请求文本
   * @returns {boolean} 是否允许
   *
   * 说明：
   * 1. 使用 config.allowedActions 作为允许列表。
   * 2. 同时兼容页面文案和工具函数名，如 update_file / create_file / delete_file。
   * 3. 大小写不敏感。
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

  /**
   * 对 GitHub 工具请求执行完整配置校验。
   *
   * @param {string} text GitHub 请求文本
   * @returns {{ok: boolean, filePath: string, reasons: string[]}}
   *
   * 返回字段：
   * - ok：是否通过配置校验
   * - filePath：识别到的文件路径，可能为空
   * - reasons：未通过原因列表
   */
  function checkSafety(text) {
    const value = cleanText(text);
    const filePath = extractFilePath(value);

    const result = {
      ok: false,
      filePath,
      reasons: []
    };

    // 1. 仓库白名单校验。
    const repoOk = (config.allowedRepos || []).some(repo => isAllowedRepo(value, repo));

    if (!repoOk) {
      result.reasons.push(`仓库不在允许列表：${(config.allowedRepos || []).join(', ')}`);
    }

    // 2. 禁止分支校验。
    const blockedBranch = (config.blockedBranches || []).find(branch => isBlockedBranch(value, branch));

    if (blockedBranch) {
      result.reasons.push(`分支不允许操作：${blockedBranch}`);
    }

    // 3. 操作类型校验。
    const actionOk = isAllowedAction(value);

    if (!actionOk) {
      result.reasons.push(`操作类型不允许，只允许：${(config.allowedActions || []).join(', ')}`);
    }

    // 4. 文件路径校验。
    const blockedPath = (config.blockedPaths || []).find(item => isBlockedPath(filePath, item));

    if (blockedPath) {
      result.reasons.push(`文件路径不允许修改：${blockedPath}`);
    }

    // 5. 危险词校验。
    const dangerWord = (config.dangerWords || []).find(word => value.includes(word));

    if (dangerWord) {
      result.reasons.push(`发现危险词：${dangerWord}`);
    }

    // 没有任何失败原因，则认为通过。
    result.ok = result.reasons.length === 0;

    return result;
  }

  // 暴露给 content.js 和控制台调试使用。
  window.GptGithubHelper.safetyCheck = {
    checkSafety,
    extractFilePath
  };
})();
