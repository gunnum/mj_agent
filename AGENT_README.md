# Agent Setup

这份文档给需要在另一台机器上安装调用器的 agent 使用。

## Prerequisites

- `git`
- `node >= 20`
- `npm`
- `curl`

## Install

```bash
git clone https://github.com/gunnum/mj_agent.git
cd mj_agent
npm install
npm install -g .
```

## First-Time Setup

运行：

```bash
mj-agent setup
```

按提示输入两项由服务运营方提供的信息：

- `Base URL`
- `Bearer Token`

配置会保存在：

```text
~/.mj-agent-cli/config.json
```

## Verify

```bash
mj-agent doctor
mj-agent get /health
```

## Make Requests

GET:

```bash
mj-agent get '/api/explore/search?prompt=red&page=1'
```

POST:

```bash
mj-agent post /api/explore/search '{"prompt":"red","page":1}'
```

Raw request:

```bash
mj-agent request GET /health
```

## Optional Commands

```bash
mj-agent version
mj-agent restart /path/to/mj_agent
```
