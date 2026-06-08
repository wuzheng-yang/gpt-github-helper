// github_prompt.js
// 负责识别 GitHub 工具确认请求和页面上的允许按钮。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  /**
   * 查找 ChatGPT 页面上的允许按钮。
   * 说明：
   * 1. 只查按钮，不读取整页文本。
   * 2. 这样普通聊天时不会频繁扫描页面，减少 ChatGPT 内部 Unknown tool 日志被触发的概率。
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
   * 说明：
   * 1. 不再直接 document.body.innerText 全页扫描。
   * 2. 只有存在 Allow / 允许按钮时，才从按钮附近容器向上找文本。
   * 3. 普通问题不会触发大面积读取，减少控制台 Unknown tool 刷屏。
   */
  function getGithubPromptText() {
    const allowButton = findAllowButton();

    if (!allowButton) {
      return '';
    }

    const candidates = [];
    let node = allowButton;

    // 从按钮向上找 8 层父节点，通常工具确认卡片就在附近。
    for (let i = 0; i < 8 && node; i += 1) {
      if (node.innerText) {
        candidates.push(node.innerText.trim());
      }
      node = node.parentElement;
    }

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

  window.GptGithubHelper.githubPrompt = {
    findAllowButton,
    getGithubPromptText
  };
})();
