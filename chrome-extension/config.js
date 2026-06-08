// config.js
// 插件配置：按项目调整白名单、快捷键和本地服务地址。

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  window.GptGithubHelper.config = {
    // 本地服务地址
    localServerBaseUrl: 'http://127.0.0.1:18888',

    // 允许操作的 GitHub 仓库
    allowedRepo: 'wuzheng-yang/ai_gp_v2',

    // 允许操作的分支
    allowedBranches: ['main', 'dev', 'dev/auto-gpt'],

    // 允许的 GitHub 操作
    allowedActions: [
      'Update GitHub file',
      'Create GitHub file'
    ],

    // 允许修改的路径前缀
    allowedPathPrefixes: [
      'ai_vue/src/',
      'ai_api/app/',
      'docs/',
      'README.md'
    ],

    // 出现这些词时，不允许快捷确认
    dangerWords: [
      // 'Delete',
      // 'delete',
      // 'Remove',
      // 'remove',
      '.env',
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
