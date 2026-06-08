// github_prompt.js
// -----------------------------------------------------------------------------
// GitHub 工具确认请求识别模块。
//
// 这个文件只负责两件事：
// 1. 找到 ChatGPT 页面里的 Allow / 允许 按钮。
// 2. 从按钮附近 DOM 中提取 GitHub 工具确认卡片文本。
//
// 为什么不直接扫描 document.body.innerText：
// - ChatGPT 页面很大，频繁全页扫描性能不好。
// - 页面里可能残留隐藏的工具文案，容易误判。
// - 只在发现 Allow 按钮后再读取附近 DOM，可以减少普通聊天时的干扰。
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  /**
   * 查找 ChatGPT 页面上的允许按钮。
   *
   * 当前兼容：
   * - 中文按钮文本：允许
   * - 英文按钮文本：Allow
   * - 中文 aria-label：允许
   * - 英文 aria-label：Allow
   *
   * 返回：
   * - 找到：HTMLButtonElement
   * - 没找到：null
   *
   * 注意：
   * 这里只判断按钮本身，不判断是不是 GitHub 工具确认。
   * 是否是 GitHub 请求由 getGithubPromptText() 再进一步判断。
   */
  function findAllowButton() {
    const buttons = Array.from(document.querySelectorAll('button'));

    return buttons.find(btn => {
      const text = btn.innerText?.trim();
      const ariaLabel = btn.getAttribute('aria-label')?.trim();

      return (
        text === '允许' ||
        text === 'Allow' ||
        ariaLabel === '允许' ||
        ariaLabel === 'Allow'
      );
    }) || null;
  }

  /**
   * 查找最可能的 GitHub 工具确认区域文本。
   *
   * 核心思路：
   * 1. 先找 Allow / 允许 按钮。
   * 2. 从按钮开始逐层向上找父节点。
   * 3. 收集这些父节点的 innerText。
   * 4. 找到同时包含 GitHub 和工具动作关键字的文本。
   *
   * 为什么从按钮附近向上找：
   * - 工具确认卡片通常包裹了按钮和请求说明。
   * - 比全页扫描更轻，也更不容易读到无关内容。
   *
   * 返回：
   * - 找到：GitHub 工具确认卡片文本
   * - 没找到：空字符串
   */
  function getGithubPromptText() {
    const allowButton = findAllowButton();

    // 没有 Allow 按钮时，说明当前页面没有待确认工具请求。
    if (!allowButton) {
      return '';
    }

    const candidates = [];
    let node = allowButton;

    // 从按钮向上找 8 层父节点。
    // 8 层是经验值：通常足够覆盖确认卡片外层容器，又不会扫到整个页面。
    for (let i = 0; i < 8 && node; i += 1) {
      if (node.innerText) {
        candidates.push(node.innerText.trim());
      }

      node = node.parentElement;
    }

    // 从候选文本里找最像 GitHub 工具确认卡片的文本。
    const promptText = candidates.find(text => {
      if (!text || !text.includes('GitHub')) {
        return false;
      }

      return (
        text.includes('Update GitHub file') ||
        text.includes('Create GitHub file') ||
        text.includes('Delete GitHub file')
      );
    });

    return promptText || '';
  }

  // 暴露给 content.js 使用。
  window.GptGithubHelper.githubPrompt = {
    findAllowButton,
    getGithubPromptText
  };
})();
