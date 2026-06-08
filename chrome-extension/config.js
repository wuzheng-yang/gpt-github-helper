// config.js
// -----------------------------------------------------------------------------
// 插件全局配置文件。
//
// 这个文件只负责放“可调整参数”，不写业务逻辑。
// 其他 JS 文件会通过 window.GptGithubHelper.config 读取这些配置。
//
// 修改配置后需要：
// 1. 打开 chrome://extensions/
// 2. 点击本插件的“重新加载”
// 3. 刷新 ChatGPT 页面
// -----------------------------------------------------------------------------

(function () {
  // 所有模块统一挂到 window.GptGithubHelper 下面，避免污染过多全局变量。
  window.GptGithubHelper = window.GptGithubHelper || {};

  window.GptGithubHelper.config = {
    // -------------------------------------------------------------------------
    // 本地 Python 服务地址。
    //
    // content script 不会直接 fetch 这个地址，而是通过 background.js 中转。
    // 这样可以减少 ChatGPT 页面环境下的 loopback / CORS / Private Network Access 问题。
    //
    // 对应服务文件：local-server/local_notify_server.py
    // 默认端口：18888
    // 健康检查：http://127.0.0.1:18888/health
    // -------------------------------------------------------------------------
    localServerBaseUrl: 'http://127.0.0.1:18888',

    // -------------------------------------------------------------------------
    // 允许自动确认的 GitHub 仓库白名单。
    //
    // 插件检测到 GitHub 工具确认请求后，会读取确认卡片附近文本。
    // 只有文本中包含这里配置的仓库名，才认为仓库匹配。
    //
    // 格式：owner/repo
    // 示例：wuzheng-yang/gpt-github-helper
    // -------------------------------------------------------------------------
    allowedRepos: [
      'wuzheng-yang/gpt-github-helper'
    ],

    // -------------------------------------------------------------------------
    // 禁止自动确认的分支。
    //
    // safety_check.js 会兼容类似这些文案：
    // - branch 'master'
    // - branch: master
    // - 分支：master
    //
    // 命中这里的分支后，面板会提示未通过配置校验。
    // -------------------------------------------------------------------------
    blockedBranches: ['master'],

    // -------------------------------------------------------------------------
    // 允许的 GitHub 操作类型。
    //
    // 因为 ChatGPT 页面和连接器显示的工具名可能变化，所以这里同时配置：
    // 1. 页面英文文案：Update GitHub file / Create GitHub file
    // 2. 简化文案：Update file / Create file
    // 3. 连接器函数名：update_file / create_file
    // 4. 完整工具名：GitHub/wuzheng-yang/gpt-github-helper.update_file
    //
    // safety_check.js 会做大小写不敏感匹配。
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 不允许修改的路径。
    //
    // 这里既可以写完整文件名，也可以写目录前缀。
    //
    // 示例：
    // '.env'         -> 禁止修改任意 .env 文件
    // 'dist/'        -> 禁止修改 dist 目录下文件
    // 'src/main.js'  -> 禁止修改指定文件
    //
    // 你当前是个人项目，默认先留空。
    // -------------------------------------------------------------------------
    blockedPaths: [
      // '.env',
      // 'node_modules/',
      // 'dist/',
      // 'build/'
    ],

    // -------------------------------------------------------------------------
    // 危险词拦截。
    //
    // 插件会在 GitHub 工具确认文本里查找这些词。
    // 命中后不会自动确认，会在面板里显示原因。
    //
    // 你当前是个人项目，默认先注释掉，需要时再打开。
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 快捷键配置。
    //
    // 当前逻辑：Alt + A 触发确认。
    // 这里配置的是 A，不需要写 Alt。
    // -------------------------------------------------------------------------
    shortcut: {
      confirmAllowKey: 'a'
    },

    // -------------------------------------------------------------------------
    // 浏览器标题状态。
    //
    // content.js 会根据 GPT 是否正在回答，把 document.title 改成下面两个标题。
    // 同时 content.js 会单独保存真实会话标题，避免把这些状态标题当文件名。
    // -------------------------------------------------------------------------
    titles: {
      thinking: '⏳ GPT 回答中 - ChatGPT',
      finished: '✅ GPT 已结束 - ChatGPT'
    }
  };
})();
