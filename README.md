# GPT GitHub Helper Full

这是一个 Chrome 插件 + 本地 Python 服务组合工具，用于辅助个人在 ChatGPT 页面中保存会话内容、记录 GitHub 工具确认请求、从 Python 向 ChatGPT 输入框发送消息，并提供 GitHub 工具确认辅助。

> 当前项目定位：个人本地开发辅助工具。

---

## 主要功能

### 1. ChatGPT 回答状态检测

当前版本使用“双保险”判断 GPT 是否回答中：

```text
优先：监听 ChatGPT 页面接口请求开始 / 结束
兜底：检测最后一条 GPT 回复文本是否变化
```

网络接口判断流程：

```text
network_watcher.js 在 MAIN world 运行
        ↓
包装页面原生 fetch / XMLHttpRequest
        ↓
检测疑似 ChatGPT 回答流接口 start / end
        ↓
通过 window.postMessage 发给 network_bridge.js
        ↓
network_bridge.js 包装 pageReader.isThinking()
        ↓
content.js 根据 isThinking() 更新标题和保存会话
```

DOM 兜底判断流程：

```text
MutationObserver 监听页面 DOM 变化
        ↓
缓存最后一条 user / assistant 消息节点
        ↓
网络接口未命中时，按最后一条 assistant 文本变化判断
```

页面标题会同步变化：

```text
⏳ GPT 回答中 - ChatGPT
✅ GPT 已结束 - ChatGPT
```

插件会单独记录 ChatGPT 原始会话标题，不会把上面的状态标题当成保存文件名。

---

### 2. 一个会话保存为一个 Markdown 文件

回答结束后，插件会把下面内容发送给本地 Python 服务：

- ChatGPT 原始会话标题
- 页面地址
- 最后一条用户提问
- 最后一条 GPT 回复
- 页面时间
- 完整会话快照 `pageData`

本地服务会把同一个 ChatGPT 会话保存到同一个 Markdown 文件中。

保存目录：

```text
local-server/gpt_replies/
```

文件名规则：

```text
ChatGPT会话标题.md
```

保存策略：

```text
新版完整快照模式：覆盖写入同一个文件，保存当前会话完整内容
旧版最后一轮模式：追加写入同一个文件，避免覆盖历史内容
```

日志目录：

```text
local-server/logs/
```

---

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

---

### 4. Python 向 ChatGPT 自动发送消息

本地 Python 服务提供消息队列接口。

外部 Python 程序把消息提交到：

```text
POST http://127.0.0.1:18888/send-chat-message
```

Chrome 插件会轮询：

```text
GET http://127.0.0.1:18888/next-chat-message?pageUrl=...&pageActive=...&pageId=...
```

如果队列中有当前页面可处理的消息，插件会自动：

```text
读取消息 -> 填入 ChatGPT 输入框 -> 点击发送按钮 -> 确认页面出现用户消息 -> ack 删除队列消息
```

注意：

- GPT 正在回答中时，插件不会取队列消息。
- 点击发送按钮后不会立刻删除队列消息。
- 插件确认最后一条用户消息已经出现在页面里，才会调用 `/ack-chat-message` 删除队列消息。
- 如果没有确认成功，消息会保留在队列里，稍后重试。

---

### 5. 支持指定 ChatGPT 会话 URL

Python 发送消息时可以不指定 URL，也可以指定 URL。

规则：

```text
不指定 targetUrl：
只允许当前前台激活的 ChatGPT 页面领取并发送

指定 targetUrl：
只允许 URL 匹配的 ChatGPT 页面领取并发送
即使这个标签页在后台，也可以尝试发送
```

为了避免多个窗口同时发送同一条消息，后端会给被领取的消息加短期锁：

```text
MESSAGE_CLAIM_SECONDS = 45
```

如果插件没有成功 ack，锁过期后消息会重新允许匹配页面领取。

---

### 6. GitHub 工具确认辅助

插件会检测 ChatGPT 页面中的 GitHub 工具确认请求，例如：

```text
Update GitHub file
Create GitHub file
Delete GitHub file
update_file
create_file
delete_file
```

检测到后会执行配置校验，并显示确认面板。

确认方式：

- 配置校验通过：右侧中间弹窗提示，并自动确认
- 配置校验通过：也可以使用快捷键 `Alt + A`
- 配置校验不通过：右侧中间弹窗提示原因，也可手动点击“仍然确认”

---

## 目录结构

```text
gpt-github-helper/
├─ chrome-extension/
│  ├─ manifest.json
│  ├─ config.js
│  ├─ background.js
│  ├─ network_watcher.js
│  ├─ network_bridge.js
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

看到类似下面内容说明成功：

```json
{
  "success": true,
  "message": "GPT 本地通知服务运行中",
  "pendingChatMessages": 0,
  "targetedChatMessages": 0,
  "claimedChatMessages": 0
}
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `pendingChatMessages` | 等待发送的消息总数 |
| `targetedChatMessages` | 指定了 `targetUrl` 的消息数 |
| `claimedChatMessages` | 已被某个页面领取、等待 ack 的消息数 |

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

## Python 自动发送消息用法

### 1. 不指定 URL，发送到当前前台 ChatGPT 页面

```python
import requests

url = "http://127.0.0.1:18888/send-chat-message"

data = {
    "text": "帮我总结一下这个会话当前进度"
}

response = requests.post(url, json=data, timeout=10)

print(response.status_code)
print(response.json())
```

### 2. 指定 URL，发送到指定 ChatGPT 会话

```python
import requests

url = "http://127.0.0.1:18888/send-chat-message"

data = {
    "text": "继续修改剩下的问题",
    "targetUrl": "https://chatgpt.com/c/你的会话ID"
}

response = requests.post(url, json=data, timeout=10)

print(response.status_code)
print(response.json())
```

说明：

```text
targetUrl 为空：只发给当前前台激活页面
targetUrl 有值：只发给 URL 匹配页面，后台标签页也可以尝试发送
```

### 3. curl 调用

不指定 URL：

```bash
curl -X POST http://127.0.0.1:18888/send-chat-message ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"帮我总结一下这个会话当前进度\"}"
```

指定 URL：

```bash
curl -X POST http://127.0.0.1:18888/send-chat-message ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"继续\",\"targetUrl\":\"https://chatgpt.com/c/你的会话ID\"}"
```

### 4. 队列状态

查看本地服务健康状态：

```text
http://127.0.0.1:18888/health
```

---

## 自动发送内部机制

### 1. 加入队列

Python 调用：

```text
POST /send-chat-message
```

服务端生成消息：

```json
{
  "id": "uuid",
  "text": "继续",
  "targetUrl": "https://chatgpt.com/c/xxx",
  "createdAt": "2026-06-08T12:00:00",
  "claimedBy": "",
  "claimExpiresAt": ""
}
```

### 2. 插件轮询

每个 ChatGPT 页面都会带上当前页面信息：

```text
pageUrl    当前页面 URL
pageActive 当前页面是否前台激活
pageId     当前页面唯一 ID
```

### 3. 后端匹配规则

```text
如果消息 targetUrl 有值：
  pageUrl == targetUrl 才能领取
  不要求 pageActive=true

如果消息 targetUrl 为空：
  pageActive=true 才能领取
```

### 4. 领取锁

消息被某个页面领取后，会写入：

```text
claimedBy
claimExpiresAt
```

用于避免多个窗口重复发送。

### 5. ack 删除

插件点击发送后，会等待最后一条用户消息出现在页面中。

确认成功后调用：

```text
POST /ack-chat-message
```

后端收到 ack 后才从队列删除消息。

---

## 回答状态检测内部机制

### 1. 网络接口优先

`network_watcher.js` 在 `manifest.json` 里配置为：

```json
{
  "js": ["network_watcher.js"],
  "run_at": "document_start",
  "world": "MAIN"
}
```

这样它可以运行在 ChatGPT 页面真实上下文里，包装页面自己的 `fetch` 和 `XMLHttpRequest`。

检测到疑似回答流接口后，会发出：

```text
start：接口开始，认为 GPT 正在回答
end / error：接口结束，短暂缓冲后认为 GPT 已结束
```

`network_bridge.js` 接收这些事件，并包装：

```js
window.GptGithubHelper.pageReader.isThinking()
```

### 2. DOM 兜底

如果网络接口监听没有命中，则继续使用原来的 DOM 方式：

```text
最后一条 assistant 文本变化：回答中
最后一条 assistant 超过约 2 秒不变：已结束
```

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

配置项说明：

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
- 配置校验是否通过
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

## 调试命令

在 ChatGPT 页面控制台执行。

### 1. 查看回答状态判断

```js
window.GptGithubHelper.pageReader.getThinkingDebug()
```

网络命中时返回示例：

```js
{
  thinking: false,
  reason: 'network_stream_finished',
  source: 'network',
  activeRequestCount: 0,
  networkInstalled: true
}
```

DOM 兜底时返回示例：

```js
{
  thinking: false,
  reason: 'text_stable_finished',
  source: 'dom_fallback',
  assistantLength: 1234,
  cacheReady: true
}
```

### 2. 查看网络监听状态

```js
window.GptGithubHelper.pageReader.getNetworkDebug()
```

或：

```js
window.GptGithubHelper.networkBridge.getNetworkDebug()
```

重点看：

```text
installed
activeRequestCount
lastUrl
networkThinkingState.reason
```

### 3. 查看最后消息缓存

```js
window.GptGithubHelper.pageReader.getLastMessageDebug()
```

### 4. 查看插件是否启动

刷新 ChatGPT 页面后，控制台应看到类似日志：

```text
[GPT GitHub Helper Full] 已启动
```

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
6. `getThinkingDebug()` 的 `source` 是 `network` 还是 `dom_fallback`

### 3. 为什么文件名是“未命名会话.md”

通常是 ChatGPT 页面还没有生成左侧会话标题，或者插件启动时只读到了默认标题。

解决方法：

1. 等 ChatGPT 左侧标题生成后再继续提问一次
2. 刷新 ChatGPT 页面
3. 检查保存文件是否变成真实标题

### 4. 标题一直显示回答中

在 ChatGPT 页面控制台执行：

```js
window.GptGithubHelper.pageReader.getThinkingDebug()
```

重点看：

```text
source
reason
activeRequestCount
lastUrl
networkReason
```

如果 `source=network` 且 `activeRequestCount` 长时间大于 0，说明网络请求还没结束或没有收到 end 事件。

如果 `source=dom_fallback` 且 `assistant_text_changed` 一直出现，说明最后一条 assistant 文本还在变化。

### 5. Python 消息没有自动发送

检查：

1. 本地服务是否启动
2. 插件是否刷新
3. ChatGPT 页面是否刷新
4. 当前页面是否正在回答
5. `/health` 中 `pendingChatMessages` 是否大于 0
6. 如果传了 `targetUrl`，确认当前 ChatGPT 页面 URL 完全匹配

### 6. 指定 targetUrl 后后台标签页没有发送

原因可能是：

1. 后台标签页定时器被 Chrome 降频
2. ChatGPT 输入框在后台页面没有正常接收 focus
3. 发送按钮没有及时变成可用
4. URL 不完全匹配

可以把目标标签页切到前台后再观察是否发送。

### 7. 多个窗口会不会重复发送

当前后端有 45 秒领取锁。

```text
claimedBy
claimExpiresAt
```

同一条消息被一个页面领取后，其他页面不会立即拿到。插件成功发送并 ack 后，消息会从队列删除。

---

## 更新代码后需要做什么

每次拉取新代码后：

```bash
git pull
```

然后：

1. 重启本地 Python 服务
2. 打开 `chrome://extensions/`
3. 点击插件的「重新加载」
4. 刷新 ChatGPT 页面

---

## 当前限制

- 队列保存在内存里，本地服务重启后未发送消息会丢失。
- 指定 `targetUrl` 的后台发送是“尝试发送”，受 Chrome 后台标签页限制，不保证 100% 成功。
- 网络接口监听依赖 ChatGPT 当前接口路径，接口变化时会自动回退 DOM 判断。
- 完整会话快照在超长会话里会比最后一条消息读取更重。
- ChatGPT 页面 DOM 经常变化，选择器后续可能需要继续适配。
