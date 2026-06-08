// config.js
// 插件配置：按项目调整仓库、黑名单、快捷键和本地服务地址。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  window.GptGithubHelper.config = {
    // 本地服务地址
    localServerBaseUrl: 'http://127.0.0.1:18888',

    // 允许操作的 GitHub 仓库
    allowedRepos: [
      'wuzheng-yang/gpt-github-helper'
    ],

    // 不允许操作的分支
    blockedBranches: ['master'],

    // 允许的 GitHub 操作
    // 说明：
    // 1. 前面几个是 ChatGPT 页面常见英文文案。
    // 2. 后面几个是连接器/工具函数名，避免 UI 文案变化后误判。
    allowedActions: [
      'Update GitHub file',
      'Create GitHub file',
      'Delete GitHub file',
      'Update file',
      'Create file',
      'Delete file',
      'update_file',
      'create_file',
      'delete_file',
      'GitHub/wuzheng-yang/gpt-github-helper.update_file',
      'GitHub/wuzheng-yang/gpt-github-helper.create_file',
      'GitHub/wuzheng-yang/gpt-github-helper.delete_file'
    ],

    // 不允许修改的文件夹或文件名
    blockedPaths: [
      // '.env',
      // 'node_modules/',
      // 'dist/',
      // 'build/'
    ],

    // 出现这些词时，不允许快捷确认
    dangerWords: [
      // 'Delete',
      // 'delete',
      // 'Remove',
      // 'remove',
      // '.env',
      // 'secret',
      // 'Secret',
      // 'token',
      // 'Token',
      // 'password',
      // 'Password',
      // 'private key',
      // 'PRIVATE KEY',
      // 'force',
      // 'trash'
    ],

    shortcut: {
      confirmAllowKey: 'a'
    },

    titles: {
      thinking: '⏳ GPT 回答中 - ChatGPT',
      finished: '✅ GPT 已结束 - ChatGPT'
    }
  };
})();
