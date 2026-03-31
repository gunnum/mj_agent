# midjourney-agent

本地 Midjourney Explore 代理服务。

它不依赖 `dnews` 运行时、队列或存储，专门负责：

- 提供本地 HTTP API
- 维护本地 Chrome 持久化用户目录
- 通过 Playwright 驱动 Midjourney Explore 页面

这个服务适合被其他本地应用直接调用，例如桌面端、Node.js 服务、自动化脚本或低代码工作流。

## 快速启动

```bash
cd /Users/gunnum/Documents/ide/midjourney-agent
npm install
npm run start
```

也可以使用项目根目录下的重启脚本：

```bash
cd /Users/gunnum/Documents/ide/midjourney-agent
./restart.command
```

默认启动地址：

```text
http://127.0.0.1:18123
```

服务启动后会输出：

```text
[midjourney-agent] listening on http://127.0.0.1:18123
```

运行脚本会在项目下生成：

- `runtime/midjourney-agent.pid`：当前服务进程 PID
- `runtime/service.log`：服务启动和运行输出
- `runtime/request-logs/YYYY-MM-DD.log`：按日期分割的请求日志

## 推荐接入流程

首次使用建议按下面顺序调用：

1. 调用 `GET /health`，确认服务可用。
2. 调用 `POST /api/browser/open`，拉起 Midjourney Explore 页面。
3. 在打开的 Chrome 窗口中完成 Midjourney 登录、Cloudflare 验证或 Cookie 校验。
4. 调用搜索或榜单接口获取数据。

说明：

- `GET /health` 和 `GET /api/login/status` 都会触发浏览器懒初始化，所以第一次调用通常会慢一些。
- 该服务依赖本机有人值守的 Chrome 会话，不适合作为纯无头云服务直接暴露公网。
- 如果 Midjourney 更新了页面结构或接口参数，需要同步更新 [src/browser.ts](/Users/gunnum/Documents/ide/midjourney-agent/src/browser.ts)。

## 运行模式

服务支持两种模式：

- `executor`：运行在你的本机 Mac 上，真正调用 Playwright 和 Midjourney
- `gateway`：运行在 Railway 这类公网环境中，只做鉴权、接收公网请求，再把任务转发给本机 executor

推荐架构：

```text
Client -> Railway gateway -> 本机 executor -> Midjourney
```

这样外部客户端只打 Railway 域名，本机只需要主动向 Railway 拉任务，不需要额外开放入站端口。

## 基础信息

- Base URL: `http://127.0.0.1:18123`
- Content-Type: `application/json`
- 编码: `utf-8`
- 鉴权方式: 默认无鉴权；若配置 `runtime/token-registry.md` 中的激活 token，或设置 `MJ_API_TOKEN`，则所有接口都需要 `Authorization: Bearer <token>`

## 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 服务健康检查，同时返回浏览器状态 |
| `GET` | `/healthz` | 当前服务进程健康检查，返回运行模式 |
| `GET` | `/api/login/status` | 查看当前浏览器登录状态 |
| `POST` | `/api/browser/open` | 打开 Midjourney Explore 页面 |
| `GET` | `/api/explore/search?prompt=...&page=1` | 通过 query string 搜索图片 |
| `POST` | `/api/explore/search` | 通过 JSON body 搜索图片 |
| `GET` | `/api/explore/styles-top?page=1` | 获取 styles top 榜单 |
| `GET` | `/api/explore/video-top?page=1` | 获取 video top 榜单 |

## 响应约定

成功时通常返回：

```json
{
  "ok": true
}
```

失败时通常返回：

```json
{
  "error": "prompt is required"
}
```

常见 HTTP 状态码：

- `200` 请求成功
- `400` 参数错误
- `404` 路径不存在
- `500` 浏览器初始化失败、页面执行失败或 Midjourney 页面异常

## 请求日志

服务会记录每一次 HTTP 调用。

默认日志目录：

```text
/Users/gunnum/Documents/ide/midjourney-agent/runtime/request-logs
```

日志规则：

- 按本机日期生成文件，例如 `2026-03-31.log`
- 只有当天真的收到请求时，才会创建当天日志文件
- 每行一条 JSON，便于后续用脚本、ELK 或数据工具分析

日志内容示例：

```json
{"timestamp":"2026-03-31T13:00:00.000Z","method":"GET","path":"/health","status":200,"durationMs":542,"remoteAddress":"127.0.0.1","userAgent":"curl/8.7.1"}
```

## 接口文档

### 1. 健康检查

`GET /health`

用途：

- 检查服务是否可用
- 返回 Playwright/Chrome 当前状态
- 首次调用时会懒启动浏览器上下文

请求示例：

```bash
curl -sS http://127.0.0.1:18123/health
```

如果启用了 token：

```bash
curl -sS \
  -H "Authorization: Bearer <your-token>" \
  http://127.0.0.1:18123/health
```

响应示例：

```json
{
  "ok": true,
  "checkedAt": "2026-03-31T12:47:55.933Z",
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "userDataDir": "/Users/gunnum/.midjourney-agent/default",
  "profileName": "default",
  "headless": false,
  "browserReady": true,
  "loginState": "unknown",
  "currentPageUrl": "about:blank"
}
```

字段说明：

- `ok`: 服务是否正常
- `checkedAt`: 检查时间，ISO 字符串
- `chromePath`: 当前 Chrome 可执行文件路径
- `userDataDir`: 浏览器用户目录
- `profileName`: 当前 profile 名称
- `headless`: 是否无头模式
- `browserReady`: 浏览器上下文是否已就绪
- `loginState`: `unknown`、`logged_in`、`logged_out`
- `currentPageUrl`: 当前页地址

### 1.1 进程健康检查

`GET /healthz`

用途：

- 检查当前服务进程是否存活
- 返回当前运行模式
- 适合给 Railway、反向代理或监控系统做存活探针

请求示例：

```bash
curl -sS http://127.0.0.1:18123/healthz
```

### 2. 查询登录状态

`GET /api/login/status`

用途：

- 查询当前 Midjourney 登录状态
- 返回结构与 `/health` 基本一致

请求示例：

```bash
curl -sS http://127.0.0.1:18123/api/login/status
```

### 3. 打开浏览器

`POST /api/browser/open`

用途：

- 打开或激活本机 Chrome
- 导航到 Midjourney Explore 页面
- 方便人工完成登录或验证

请求示例：

```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer <your-token>" \
  http://127.0.0.1:18123/api/browser/open
```

响应示例：

```json
{
  "ok": true,
  "url": "https://www.midjourney.com/explore",
  "message": "Explore page opened. Complete login or Cloudflare in the Chrome window if needed."
}
```

说明：

- 首次打开浏览器时响应可能比其他接口更慢。
- 如果 Midjourney 页面还没完成登录，这个接口只负责打开页面，不会自动完成认证。

### 4. 搜索图片

支持两种调用方式。

#### 4.1 GET 方式

`GET /api/explore/search?prompt=<关键词>&page=<页码>`

参数：

- `prompt`: 必填，搜索词
- `page`: 可选，页码，默认 `1`

请求示例：

```bash
curl -sS \
  -H "Authorization: Bearer <your-token>" \
  "http://127.0.0.1:18123/api/explore/search?prompt=red%20dress&page=1"
```

#### 4.2 POST 方式

`POST /api/explore/search`

请求体：

```json
{
  "prompt": "red dress",
  "page": 1
}
```

请求示例：

```bash
curl -sS \
  -X POST http://127.0.0.1:18123/api/explore/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"prompt":"red dress","page":1}'
```

成功响应示例：

```json
{
  "ok": true,
  "kind": "search_images",
  "query": {
    "prompt": "red dress",
    "page": 1
  },
  "response": {
    "url": "https://www.midjourney.com/api/explore-vector-search?prompt=red%20dress&page=1&_ql=explore",
    "status": 200,
    "ok": true,
    "body": {},
    "capturedAt": "2026-03-31T12:00:00.000Z"
  }
}
```

字段说明：

- `kind`: 固定为 `search_images`
- `query`: 回显本次请求参数
- `response.url`: Midjourney 实际调用的接口地址
- `response.status`: Midjourney 返回状态码
- `response.ok`: Midjourney 请求是否成功
- `response.body`: Midjourney 原始返回体
- `response.capturedAt`: 捕获时间

失败响应示例：

```json
{
  "error": "prompt is required"
}
```

### 5. 获取 styles top 榜单

`GET /api/explore/styles-top?page=<页码>`

参数：

- `page`: 可选，默认 `1`

请求示例：

```bash
curl -sS \
  -H "Authorization: Bearer <your-token>" \
  "http://127.0.0.1:18123/api/explore/styles-top?page=1"
```

成功响应示例：

```json
{
  "ok": true,
  "kind": "styles_top",
  "query": {
    "page": 1
  },
  "response": {
    "url": "https://www.midjourney.com/api/explore-srefs?page=1&_ql=explore&feed=styles_top",
    "status": 200,
    "ok": true,
    "body": {},
    "capturedAt": "2026-03-31T12:00:00.000Z"
  }
}
```

### 6. 获取 video top 榜单

`GET /api/explore/video-top?page=<页码>`

参数：

- `page`: 可选，默认 `1`

请求示例：

```bash
curl -sS \
  -H "Authorization: Bearer <your-token>" \
  "http://127.0.0.1:18123/api/explore/video-top?page=1"
```

成功响应示例：

```json
{
  "ok": true,
  "kind": "video_top",
  "query": {
    "page": 1
  },
  "response": {
    "url": "https://www.midjourney.com/api/explore?page=1&feed=video_top&_ql=explore",
    "status": 200,
    "ok": true,
    "body": {},
    "capturedAt": "2026-03-31T12:00:00.000Z"
  }
}
```

## 其他应用调用示例

### Node.js

```ts
const baseUrl = 'http://127.0.0.1:18123'

async function searchMidjourney(prompt: string, page = 1) {
  const response = await fetch(`${baseUrl}/api/explore/search`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prompt, page }),
  })

  if (!response.ok) {
    throw new Error(`midjourney-agent request failed: ${response.status}`)
  }

  return response.json()
}
```

### Python

```python
import requests

base_url = "http://127.0.0.1:18123"

resp = requests.post(
    f"{base_url}/api/explore/search",
    json={"prompt": "red dress", "page": 1},
    timeout=60,
)
resp.raise_for_status()
data = resp.json()
print(data)
```

## 环境变量

- `MJ_AGENT_MODE`: `executor` 或 `gateway`，默认 `executor`
- `MJ_AGENT_PORT`: 服务端口，默认 `18123`
- `MJ_AGENT_HOST`: 监听地址，默认 `127.0.0.1`
- `MJ_RUNTIME_DIR`: 运行时目录，默认 `<project>/runtime`
- `MJ_REQUEST_LOG_DIR`: 请求日志目录，默认 `<project>/runtime/request-logs`
- `MJ_TOKEN_REGISTRY_PATH`: 本地 Markdown token 台账路径。若文件中存在 `active` token，则所有请求都必须带 `Authorization: Bearer <token>`
- `MJ_API_TOKEN`: 单个 API Bearer Token 兼容项；如果 token 台账里已有激活 token，优先使用台账
- `MJ_GATEWAY_URL`: 本机 executor 主动连接的 gateway 地址
- `MJ_BRIDGE_TOKEN`: gateway 与 executor 之间共享的桥接 token
- `MJ_BRIDGE_POLL_TIMEOUT_MS`: bridge 长轮询超时，默认 `25000`
- `MJ_BRIDGE_REQUEST_TIMEOUT_MS`: gateway 等待 executor 完成任务的超时，默认 `120000`
- `MJ_BRIDGE_RETRY_DELAY_MS`: bridge 出错后的重试间隔，默认 `3000`
- `MJ_CORS_ORIGINS`: 允许跨域的来源列表，逗号分隔；未配置时不返回 CORS 头
- `MJ_CHROME_PATH`: Chrome 可执行文件绝对路径
- `MJ_PROFILE_NAME`: 浏览器 profile 名称，默认 `default`
- `MJ_USER_DATA_DIR`: 浏览器用户目录，默认 `~/.midjourney-agent/<profile>`
- `MJ_HEADLESS`: 是否启用无头模式，默认 `false`
- `MJ_TIMEOUT_MS`: 默认超时时间，默认 `30000`
- `MJ_EXPLORE_URL`: Explore 页面地址，默认 `https://www.midjourney.com/explore`

示例：

```bash
MJ_AGENT_MODE=executor \
MJ_AGENT_PORT=18123 \
MJ_TOKEN_REGISTRY_PATH=/path/to/runtime/token-registry.md \
MJ_PROFILE_NAME=default \
MJ_HEADLESS=false \
npm run start
```

## 公网部署建议

推荐使用 `Railway gateway + 本机 executor`：

```bash
MJ_AGENT_MODE=gateway
MJ_AGENT_HOST=0.0.0.0
MJ_API_TOKEN=your-public-api-token
MJ_BRIDGE_TOKEN=your-bridge-token
MJ_TOKEN_REGISTRY_PATH=/tmp/mj-agent-empty-registry.md
MJ_CORS_ORIGINS=https://your-app.example.com
```

说明：

- Railway gateway 用 `MJ_API_TOKEN` 保护公网调用
- Railway gateway 用 `MJ_BRIDGE_TOKEN` 只接受你的本机 executor 轮询
- Railway 上不需要 Midjourney 登录态，也不需要真实 Chrome 会话
- 本机 executor 通过 `MJ_GATEWAY_URL` 主动向 gateway 拉任务
- `MJ_CORS_ORIGINS` 只在浏览器前端直连 gateway 时需要配置

### Railway Gateway

```bash
MJ_AGENT_MODE=gateway
MJ_AGENT_HOST=0.0.0.0
MJ_API_TOKEN=<public-api-token>
MJ_BRIDGE_TOKEN=<bridge-token>
MJ_TOKEN_REGISTRY_PATH=/tmp/mj-agent-empty-registry.md
```

### Local Executor

```bash
MJ_AGENT_MODE=executor
MJ_AGENT_HOST=127.0.0.1
MJ_AGENT_PORT=18123
MJ_TOKEN_REGISTRY_PATH=/Users/your-user/Documents/ide/midjourney-agent/runtime/token-registry.md
MJ_GATEWAY_URL=https://mjagent-production.up.railway.app
MJ_BRIDGE_TOKEN=<bridge-token>
```

## Token 台账

推荐把 token 记录在本地 Markdown 文件里，例如：

```md
# Token Registry

| status | name | token | note |
| --- | --- | --- | --- |
| active | local-admin | your-token-here | 主控 token |
| disabled | old-client | old-token-here | 已停用 |
```

规则：

- 只有 `status` 为 `active` 的 token 会被服务接受
- 这个文件建议放在 `runtime/` 下，只保留在本机，不要提交到 Git
- 如果台账里有任意一个激活 token，服务就会强制要求 Bearer Token

## 已知限制

- 依赖本机已安装的 Google Chrome。
- 依赖 Midjourney 登录态，未登录时搜索类接口可能返回登录页或鉴权失败结果。
- 当前搜索与榜单接口本质上是透传 Midjourney Explore 页面中的请求结果，返回体结构由 Midjourney 决定。
- 浏览器前端直连时，只有 `MJ_CORS_ORIGINS` 中列出的来源会收到 CORS 头。

## 运维说明

操作和交接信息见 [HANDOFF.md](/Users/gunnum/Documents/ide/midjourney-agent/HANDOFF.md)。
