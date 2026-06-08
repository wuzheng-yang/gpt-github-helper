# GPT GitHub Helper Full

这是一个 Chrome 插件 + 本地 Python 服务组合工具，用于辅助个人在 ChatGPT 页面中保存会话内容、记录 GitHub 工具确认请求，并提供快捷确认入口。

---

## 主要功能

### 1. ChatGPT 回答状态检测

插件会在 ChatGPT 页面中检测最后一条 GPT 回复是否仍在变化。

- 回复内容变化：认为 GPT 正在回答
- 回复内容超过约 2 秒不再变化：认为 GPT 已结束

页面标题会同步变化：

```text
⏳ GPT 回答中 - ChatGPT
✅ GPT 已结束 - ChatGPT
```

注意：插件会单独记录 ChatGPT 原始会话标题，不会把上面的状态标题当成保存文件名。

### 2. 一个会话保存为一个 Markdown 文件

回答结束后，插件会把下面内容发送给本地 Python 服务：

- ChatGPT 原始会话标题
- 页面地址
- 最后一条用户提问
- 最后一条 GPT 回复
- 页面时间

本地服务会把同一个 ChatGPT 会话保存到同一个 Markdown 文件中。

保存目录：

```text
local-server/gpt_replies/
```

文件名规则：

```text
ChatGPT会话标题.md
```

例如 ChatGPT 左侧会话标题是：

```text
GitHub 插件调试
```

则保存为：

```text
local-server/gpt_replies/GitHub 插件调试.md
```

如果新版插件发送了完整页面快照，则本地服务会覆盖写入同一个文件，保证文件内容是当前会话最新状态。

如果仍是旧版发送逻辑，则本地服务会把每次回答追加到同一个会话文件中，避免覆盖历史内容。

日志目录：

```text
local-server/logs/
```

### 3. 本地服务中转

Chrome 页面直接请求 `http://127.0.0.1:18888` 可能会被浏览器拦截。

当前版本使用 Chrome 扩展后台脚本中转：

```text
content script
  -> chrome.runtime.sendMessage
  -> background.js
  -> http://127.0.0.1:18888
```

这样可以避免 ChatGPT 页面直接访问本机地址时出现 loopback / CORS 拦截问题。

### 4. GitHub 工具确认辅助

插件会检测 ChatGPT 页面中的 GitHub 工具确认请求，例如：

```text
Update GitHub file
Create GitHub file
```

检测到后会执行安全校验，并显示确认面板。

确认方式为：

- 安全校验通过：右侧中间弹窗提示，并自动确认
- 安全校验通过：也可以使用快捷键 `Alt + A`
- 安全校验不通过：右侧中间弹窗红色提示原因，也可手动点击“仍然确认”

---

## 目录结构

```text
gpt-github-helper/
├─ chrome-extension/
│  ├─ manifest.json
│  ├─ config.js
│  ├─ background.js
│  ├─ page_reader.js
│  ├─ local_api.js
│  ├─ github_prompt.js
│  ├─ safety_check.js
│  ├─ panel.js
│  └─ content.js
├─ local-server/
│  ├─ local_notify_server.py
│  ├─ requirements.txt
│  └─ start_server.bat
├─ images2/
└─ README.md
```

---

## 第一步：启动本地服务

进入目录：

```bash
cd local-server
```

安装依赖并启动：

```bash
python -m pip install -r requirements.txt
python local_notify_server.py
```

Windows 也可以双击：

```text
local-server/start_server.bat
```

启动成功后，浏览器访问：

```text
http://127.0.0.1:18888/health
```

看到下面内容说明成功：

```json
{
  "success": true,
  "message": "GPT 本地通知服务运行中"
}
```

---

## 第二步：安装 Chrome 插件

打开 Chrome 扩展页面：

```text
chrome://extensions/
```

然后：

1. 打开右上角「开发者模式」
2. 点击「加载已解压的扩展程序」
3. 选择项目里的 `chrome-extension` 文件夹

注意：选择的是 `chrome-extension` 文件夹，不是整个仓库目录。

---

## 第三步：使用流程

1. 启动本地服务
2. 刷新 Chrome 插件
3. 刷新 ChatGPT 页面
4. 正常向 ChatGPT 提问
5. GPT 回答结束后，本地服务会收到 `/gpt-finished` 请求
6. 会话会保存到 `local-server/gpt_replies/会话标题.md`

如果浏览器控制台出现：

```text
ERR_CONNECTION_REFUSED
```

通常表示本地服务没有启动，或者端口不是 `18888`。

如果出现：

```text
loopback address space
CORS policy
```

请确认已经更新到包含 `background.js` 的版本，并且已经刷新 Chrome 插件。

---

## GitHub 确认规则

当前配置文件：

```text
chrome-extension/config.js
```

默认配置示例：

```js
window.GptGithubHelper.config = {
  localServerBaseUrl: 'http://127.0.0.1:18888',

  allowedRepos: [
    'wuzheng-yang/gpt-github-helper'
  ],

  blockedBranches: ['master'],

  allowedActions: [
    'Update GitHub file',
    'Create GitHub file'
  ],

  blockedPaths: [],

  dangerWords: [],

  shortcut: {
    confirmAllowKey: 'a'
  },

  titles: {
    thinking: '⏳ GPT 回答中 - ChatGPT',
    finished: '✅ GPT 已结束 - ChatGPT'
  }
};
```

### 安全校验含义

| 配置项 | 作用 |
| --- | --- |
| `allowedRepos` | 只允许这些仓库进入快捷确认流程 |
| `blockedBranches` | 命中这些分支时不允许快捷确认 |
| `allowedActions` | 只允许指定 GitHub 操作类型 |
| `blockedPaths` | 命中这些路径时不允许快捷确认 |
| `dangerWords` | 页面文本中出现这些词时不允许快捷确认 |
| `shortcut.confirmAllowKey` | 快捷确认键，默认 `Alt + A` |

---

## GitHub 请求日志

检测到 GitHub 工具确认请求时，本地服务会记录日志。

日志文件：

```text
local-server/logs/github_confirm.log
```

日志内容包括：

- ChatGPT 会话标题
- ChatGPT 页面地址
- GitHub 文件路径
- 安全校验是否通过
- 未通过原因
- 用户最后提问

---

## 本地调用外部程序

打开：

```text
local-server/local_notify_server.py
```

找到：

```python
def call_your_program(event_type: str, markdown_file: Optional[Path] = None):
```

可以改成调用自己的 exe / bat / Java 程序：

```python
subprocess.Popen([
    r"D:\your_app\notify.exe",
    event_type,
    str(markdown_file or "")
], shell=False)
```

这样 GPT 回答结束后，会自动调用你的程序，并把 Markdown 文件路径传进去。

---

## 常见问题

### 1. 本地服务启动了，但浏览器还是报错

先确认是否能访问：

```text
http://127.0.0.1:18888/health
```

如果健康检查正常，但 ChatGPT 页面仍报 loopback / CORS 错误，请刷新插件：

```text
chrome://extensions/
```

然后刷新 ChatGPT 页面。

### 2. 回答结束后没有保存 Markdown

检查：

1. 本地服务是否启动
2. Chrome 插件是否刷新
3. ChatGPT 页面是否刷新
4. 控制台是否还有请求错误
5. `local-server/logs/finished.log` 是否有记录

### 3. 为什么文件名是“未命名会话.md”

通常是 ChatGPT 页面还没有生成左侧会话标题，或者插件启动时只读到了默认标题。

解决方法：

1. 等 ChatGPT 左侧标题生成后再继续提问一次
2. 刷新 ChatGPT 页面
3. 检查保存文件是否变成真实标题

### 4. 标题一直显示回答中

当前判断逻辑基于最后一条 GPT 回复文本是否变化。

如果页面中最后一条回复区域持续发生 DOM 文本变化，可能会延迟判断结束。一般等待几秒后会变为：

```text
✅ GPT 已结束 - ChatGPT
```

### 5. 本地服务没启动会怎样

不会影响 ChatGPT 页面正常使用，但内容不会保存成功。

控制台通常会打印：

```text
Failed to fetch
ERR_CONNECTION_REFUSED
```

启动本地服务后，重新刷新 ChatGPT 页面即可。

---

## 注意事项

1. 插件从 ChatGPT 页面 DOM 读取内容，不是官方 API。
2. 如果 ChatGPT 页面结构变化，可能需要调整 `page_reader.js` 或 `github_prompt.js` 里的选择器。
3. GitHub 请求安全校验通过后会自动确认；未通过时需要手动点击“仍然确认”。
4. 本地服务必须先启动，插件才能保存回复。
5. 修改 `manifest.json` 后必须在 `chrome://extensions/` 里刷新插件。
6. 修改 `config.js` 后也需要刷新插件和 ChatGPT 页面。
