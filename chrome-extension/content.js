// content.js
// 插件主流程：串联页面状态检测、本地通知和 GitHub 工具确认。
// 功能：
// 1. 检测 GPT 是否回答中 / 已结束
// 2. 回答结束后通知本地 Python 服务
// 3. 检测 GitHub 工具确认请求
// 4. 安全校验通过或不通过，都在右侧中间弹窗，让用户手动确认

(function () {
  const {
    config,
    pageReader,
    localApi,
    githubPrompt,
    safetyCheck,
    panel
  } = window.GptGithubHelper;

  // 上一次 GPT 是否回答中的状态
  let lastThinkingState = null;

  // 防止同一次回答结束重复推送
  let finishedNotified = false;

  // 防止同一个 GitHub 确认请求重复弹窗 / 重复写日志
  let githubNotifiedText = '';

  /**
   * 点击 ChatGPT 页面上的 GitHub Allow / 允许 按钮
   *
   * 注意：
   * - 这个函数只会在用户点击插件面板按钮或快捷键时执行
   * - 不做自动点击
   */
  function clickAllowButton() {
    const allowButton = githubPrompt.findAllowButton();

    if (!allowButton) {
      alert('没有找到 GitHub 允许按钮。');
      return false;
    }

    allowButton.click();
    panel.hidePanel();
    return true;
  }

  /**
   * 确认 GitHub 工具请求
   *
   * @param {boolean} force
   * - false：只允许安全校验通过时确认
   * - true：用户在弹窗里主动点击“仍然确认”时，允许继续确认
   */
  function confirmAllow(force = false) {
    const text = githubPrompt.getGithubPromptText();
    const checkResult = safetyCheck.checkSafety(text);

    // 未通过安全校验，并且不是用户强制确认，则只弹窗提示
    if (!checkResult.ok && !force) {
      panel.renderPanel(checkResult);
      return false;
    }

    return clickAllowButton();
  }

  /**
   * 绑定快捷键 Alt + A
   *
   * 快捷键只用于“安全校验通过”的确认。
   * 如果安全校验不通过，需要用户在弹窗中点击“仍然确认”。
   */
  function bindShortcut() {
    window.addEventListener('keydown', event => {
      if (event.altKey && event.key.toLowerCase() === config.shortcut.confirmAllowKey) {
        event.preventDefault();
        confirmAllow(false);
      }
    });
  }

  /**
   * 回答结束后，延迟 800ms 通知本地服务。
   *
   * 延迟的作用：
   * - 等待 ChatGPT 最后一段 DOM 更新完成
   * - 避免保存到半截回复
   */
  function notifyFinished() {
    setTimeout(() => {
      localApi.callLocalNotifyApi('finished');
    }, 800);
  }

  /**
   * 通知本地服务：检测到了 GitHub 确认请求
   *
   * @param {string} githubText 当前页面中的 GitHub 请求文本
   * @param {object} checkResult 安全校验结果
   */
  function notifyGithubRequest(githubText, checkResult) {
    if (githubNotifiedText === githubText) {
      return;
    }

    githubNotifiedText = githubText;

    localApi.callLocalNotifyApi('github', {
      githubFilePath: checkResult.filePath,
      securityOk: checkResult.ok,
      securityReasons: checkResult.reasons
    });
  }

  /**
   * 处理 GPT 回答状态
   *
   * thinking = true：
   * - 标题显示回答中
   *
   * thinking = false：
   * - 标题显示已结束
   * - 如果上一次是 true，这次变 false，触发回答结束推送
   */
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

  /**
   * 处理 GitHub 工具确认请求
   *
   * 逻辑：
   * 1. 没有 GitHub 请求，不处理
   * 2. 有 GitHub 请求，执行安全校验
   * 3. 弹出右侧中间面板
   * 4. 面板中显示是否通过、文件路径、失败原因
   * 5. 用户点击按钮后才确认
   */
  function handleGithubPrompt() {
    const githubText = githubPrompt.getGithubPromptText();
    const allowButton = githubPrompt.findAllowButton();

    if (!githubText || !allowButton) {
      return;
    }

    const checkResult = safetyCheck.checkSafety(githubText);

    notifyGithubRequest(githubText, checkResult);
    panel.renderPanel(checkResult);
  }

  /**
   * 主循环
   *
   * 每 1 秒：
   * 1. 检测 GPT 回答状态
   * 2. 检测 GitHub 工具确认请求
   */
  function loop() {
    const thinking = pageReader.isThinking();

    handleThinkingState(thinking);
    handleGithubPrompt();

    lastThinkingState = thinking;
  }

  /**
   * 插件启动入口
   */
  function start() {
    panel.createPanel();

    // 面板按钮点击时，允许用户强制确认
    panel.setConfirmHandler(() => confirmAllow(true));

    bindShortcut();

    setInterval(loop, 1000);

    console.log('[GPT GitHub Helper Full] 已启动');
  }

  start();
})();
