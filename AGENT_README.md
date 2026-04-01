# MJ Agent Readme

这份文档是给接入方 agent 直接看的唯一说明文档。

它只关注一件事：

- 怎样在另一台机器上安装 `mj-agent` CLI
- 怎样配置服务地址和 Token
- 怎样发起搜索请求
- 怎样理解分页和返回结果

## 1. 这是什么

`mj-agent` 是一个轻量命令行调用器。

它运行在调用方机器上，负责：

- 检查本机环境
- 保存 `Base URL` 和 `Bearer Token`
- 验证鉴权
- 调用 MJ Agent 服务
- 输出 JSON 结果

它不负责：

- 部署服务
- 管理 Midjourney 登录态
- 在调用方机器上打开浏览器

浏览器实际运行在服务端机器上。

## 2. 前置要求

调用方机器需要：

- `git`
- `node >= 20`
- `npm`
- `curl`

## 3. 安装

```bash
git clone https://github.com/gunnum/mj_agent.git
cd mj_agent
npm install
npm install -g .
```

安装完成后可以验证：

```bash
mj-agent version
```

## 4. 首次配置

首次使用执行：

```bash
mj-agent setup
```

按提示输入：

- `Base URL`
- `Bearer Token`

配置文件会保存到：

```text
~/.mj-agent-cli/config.json
```

## 5. 配置检查

```bash
mj-agent doctor
```

会检查：

- Node 版本
- `curl` 是否已安装
- 配置文件是否存在
- `Base URL` 是否已配置
- Token 是否已配置
- 当前鉴权是否成功

## 6. 更新 Token

```bash
mj-agent auth <token>
```

或者：

```bash
mj-agent auth
```

不带参数时会提示手动输入。

## 7. 常用命令

健康检查：

```bash
mj-agent get /health
```

搜索：

```bash
mj-agent get '/api/explore/search?prompt=red&page=1'
```

POST 搜索：

```bash
mj-agent post /api/explore/search '{"prompt":"red","page":1}'
```

通用请求：

```bash
mj-agent request GET /health
mj-agent request POST /api/explore/search '{"prompt":"red","page":1}'
```

查看版本：

```bash
mj-agent version
```

重启项目：

```bash
mj-agent restart /path/to/mj_agent
```

说明：

- `restart` 本质上是执行目标目录下的 `restart.command`

## 8. 分页规则

当前系统采用“按页抓取”，不采用“按数量抓取”。

也就是说，调用方应传：

- `page=1` 到 `page=100`

当前允许范围是：

- 最小值：`1`
- 最大值：`100`
- 超出范围会直接返回 `400`

按 Midjourney 当前分页大小估算：

- 每页大约 `50` 条
- `page=1` 约对应前 `50` 条
- `page=2` 约对应前 `100` 条范围
- `page=10` 约对应前 `500` 条范围
- `page=100` 约对应前 `5000` 条范围

这里要特别注意：

- 这是基于当前 Midjourney 分页大小的估算
- 我们的系统逻辑永远是“抓第几页”
- 不是“精确抓多少条”
- 如果以后 Midjourney 更改每页条数，实际数量会变化
- 但系统仍然按页抓取，不会改成按数量抓取

示例：

```bash
mj-agent get '/api/explore/search?prompt=red&page=1'
mj-agent get '/api/explore/search?prompt=red&page=2'
mj-agent get '/api/explore/search?prompt=red&page=10'
mj-agent get '/api/explore/search?prompt=red&page=100'
```

如果接入方需要固定数量，应在拿到结果后自行截断。

## 9. 返回结果约定

推荐服务端把搜索结果统一整理成一个 `items` 数组，再交给接入侧使用。

推荐每个 item 至少包含：

- `id`
- `type`
- `prompt`
- `media_url`
- `detail_url`

推荐返回形态：

```json
{
  "ok": true,
  "query": {
    "prompt": "red",
    "page": 2
  },
  "items": [
    {
      "id": "xxx",
      "type": "image",
      "prompt": "red dress in studio light",
      "media_url": "https://...",
      "detail_url": "https://..."
    }
  ]
}
```

为什么推荐这样做：

- 接入侧只需要解析统一的 `items`
- 不需要理解 Midjourney 原始字段结构
- 如果上游字段变化，影响可以尽量收敛在服务端

不推荐只透传原始 body 给接入侧自己解析，因为：

- 接入方必须了解 Midjourney 原始结构
- 上游字段变化时，所有接入方都要一起改
- 对 agent、脚本和第三方应用都不够友好

## 10. 运行行为说明

服务端常规查询会优先后台执行，不会在每次请求时把服务端机器上的 Chrome 切到前台。

如果本机 Chrome profile 不支持 headless，或者搜索命中 Cloudflare challenge，服务会自动回退到后台有界面模式。

服务端当前采用单实例串行执行：

- 所有 Midjourney 相关操作共用一个全局执行队列
- 同一时间只会执行 1 个任务
- 其他请求会等待前一个任务完成后再继续
- 这个串行规则同时适用于直连 executor 和经由 gateway 转发的请求

`GET /health` 返回中会包含串行状态字段：

- `serialMode`
- `activeTask`
- `queuedTasks`

当前超时规则：

- 页面导航和 Playwright 默认操作超时：`30s`
- Midjourney 页面内 API fetch 超时：`20s`
- 串行队列等待超时：`60s`
- gateway 等待 executor 回结果超时：`120s`
- CLI 单次请求整体超时：`180s`

这套超时是按当前实测耗时估算的：

- `/health` 通常约 `2s`
- 搜索通常约 `7s`
- 所以页面内 fetch 超时定为 `20s`
- 串行队列等待超时定为 `60s`
- 超过这些值会尽快失败，而不是长时间挂起

只有在需要人工处理登录或验证时，才调用：

```bash
POST /api/browser/open
```

## 11. 输出说明

- CLI 默认直接把服务端响应输出到终端
- 如果响应是 JSON，会自动格式化
- 如果接口返回非 `2xx`，CLI 会以失败状态退出

所以它也适合被：

- agent
- 自动化脚本
- CI
- 第三方工具

直接调用。

## 12. 状态码与错误码对照表

调用方应同时判断：

- HTTP 状态码
- JSON 中的 `code`

成功返回通常为：

```json
{
  "ok": true
}
```

失败返回通常为：

```json
{
  "ok": false,
  "code": "INVALID_ARGUMENT",
  "error": "prompt is required"
}
```

对照表如下：

- `200` + 无错误码：请求成功
- `400` + `INVALID_ARGUMENT`：参数错误。应修正参数后重试
- `401` + `UNAUTHORIZED`：鉴权失败。应检查或更新 Token
- `401` + `UNAUTHORIZED_BRIDGE`：bridge 鉴权失败。通常是服务端内部配置问题
- `404` + `NOT_FOUND`：路径不存在。应检查接口路径
- `504` + `TIMEOUT`：请求超时。可能是排队超时、页面内 API 超时，或 bridge 等待超时
- `500` + `INTERNAL_ERROR`：服务端内部错误。通常应记录错误并稍后重试

调用方建议处理方式：

- 遇到 `400`：不要自动重试，先修参数
- 遇到 `401`：不要自动重试，先修 Token 或鉴权配置
- 遇到 `404`：不要自动重试，先修路径
- 遇到 `504`：可以有限次重试
- 遇到 `500`：可以有限次重试，并记录错误内容

## 13. 常见问题

提示 `CLI is not configured`：

```bash
mj-agent setup
```

提示 `token rejected by server`：

- Token 不正确
- Token 已失效
- `Base URL` 配错

可尝试：

```bash
mj-agent auth
```

或者重新执行：

```bash
mj-agent setup
```

提示 Node 版本太低：

```text
node >= 20
```

调用成功但结果异常，通常是服务端问题，不是 CLI 问题，例如：

- Midjourney 登录态失效
- 服务端浏览器需要重新验证
- 服务端风控触发

## 14. 命令总览

```bash
mj-agent setup
mj-agent doctor
mj-agent auth [token]
mj-agent version
mj-agent restart [project-path]
mj-agent get <path>
mj-agent post <path> [json]
mj-agent request <method> <path> [json]
```

## 14. 最小接入示例

```bash
git clone https://github.com/gunnum/mj_agent.git
cd mj_agent
npm install
npm install -g .

mj-agent setup
mj-agent doctor
mj-agent get /health
mj-agent get '/api/explore/search?prompt=red&page=1'
```
