// github_prompt.js
// 负责识别 GitHub 工具确认请求和页面上的允许按钮。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const { pageReader } = window.GptGithubHelper;

  function findAllowButton() {
    const buttons = Array.from(document.querySelectorAll('button'));

    return buttons.find(btn => {
      const text = btn.innerText?.trim();
      return text === '允许' || text === 'Allow';
    }) || null;
  }

  function getGithubPromptText() {
    const text = pageReader.getPageText();

    if (!text.includes('GitHub')) {
      return '';
    }

    if (
      !text.includes('Update GitHub file') &&
      !text.includes('Create GitHub file') &&
      !text.includes('Delete GitHub file')
    ) {
      return '';
    }

    return text;
  }

  window.GptGithubHelper.githubPrompt = {
    findAllowButton,
    getGithubPromptText
  };
})();
