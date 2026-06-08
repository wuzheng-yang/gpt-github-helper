// content.js
// 插件主流程：串联页面状态检测、本地通知和 GitHub 快捷确认。
//
// 注意：
// - 浏览器插件不能直接运行 exe，所以通过 http://127.0.0.1:18888 调用本地 Python 服务。
// - ChatGPT 页面结构可能变化，如果未来失效，需要调整 page_reader.js 或 github_prompt.js。

(function () {
  const {
    config,
    pageReader,
    localApi,
    githubPrompt,
    safetyCheck,
    panel
  } = window.GptGithubHelper;

  let lastThinkingState = null;
  let finishedNotified = false;
  let githubNotifiedText = '';

  function confirmAllow() {
    const text = githubPrompt.getGithubPromptText();
    const checkResult = safetyCheck.checkSafety(text);

    if (!checkResult.ok) {
      alert('安全校验未通过，不能快捷确认。');
      panel.renderPanel(checkResult);
      return;
    }

    const allowButton = githubPrompt.findAllowButton();

    if (!allowButton) {
      alert('没有找到允许按钮。');
      return;
    }

    allowButton.click();
    panel.hidePanel();
  }

  function bindShortcut() {
    window.addEventListener('keydown', event => {
      if (event.altKey && event.key.toLowerCase() === config.shortcut.confirmAllowKey) {
        event.preventDefault();
        confirmAllow();
      }
    });
  }

  function notifyFinished() {
    setTimeout(() => {
      localApi.callLocalNotifyApi('finished');
    }, 800);
  }

  function handleThinkingState(thinking) {
    if (thinking) {
      document.title = config.titles.thinking;
      finishedNotified = false;
      return;
    }

    document.title = config.titles.finished;

    if (!finishedNotified && lastThinkingState === true) {
      finishedNotified = true;
      notifyFinished();
    }
  }

  function handleGithubPrompt() {
    const githubText = githubPrompt.getGithubPromptText();
    const allowButton = githubPrompt.findAllowButton();

    if (!githubText || !allowButton) {
      return;
    }

    const checkResult = safetyCheck.checkSafety(githubText);
    panel.renderPanel(checkResult);

    if (githubNotifiedText !== githubText) {
      githubNotifiedText = githubText;
      localApi.callLocalNotifyApi('github', {
        githubFilePath: checkResult.filePath,
        securityOk: checkResult.ok,
        securityReasons: checkResult.reasons
      });
    }
  }

  function loop() {
    const thinking = pageReader.isThinking();

    handleThinkingState(thinking);
    handleGithubPrompt();

    lastThinkingState = thinking;
  }

  function start() {
    panel.createPanel();
    panel.setConfirmHandler(confirmAllow);
    bindShortcut();
    setInterval(loop, 1000);

    console.log('[GPT GitHub Helper Full] 已启动');
  }

  start();
})();
