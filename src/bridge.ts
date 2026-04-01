import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'
import { handleAgentRequest } from './routes.js'
import { errorJson, json } from './utils.js'

const execFileAsync = promisify(execFile)

interface BridgeTask {
  id: string
  method: string
  path: string
  body?: string
  contentType?: string
  createdAt: string
}

interface BridgeResultPayload {
  id: string
  status: number
  headers: Record<string, string>
  body: string
}

interface BridgePendingRequest {
  resolve: (result: BridgeResultPayload) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function curlJson(url: string, token: string, body: string, maxTimeSeconds: number) {
  const { stdout } = await execFileAsync('curl', [
    '-sS',
    '--connect-timeout',
    '10',
    '--max-time',
    String(maxTimeSeconds),
    '-X',
    'POST',
    '-H',
    `Authorization: Bearer ${token}`,
    '-H',
    'Content-Type: application/json',
    '-d',
    body,
    '-w',
    '\n%{http_code}',
    url,
  ])

  const separator = stdout.lastIndexOf('\n')
  const responseBody = separator >= 0 ? stdout.slice(0, separator) : stdout
  const statusText = separator >= 0 ? stdout.slice(separator + 1).trim() : ''
  const status = Number.parseInt(statusText || '0', 10)

  return {
    status,
    body: responseBody,
  }
}

class BridgeQueue {
  private queue: BridgeTask[] = []
  private waiters: Array<(task: BridgeTask | null) => void> = []
  private pendingResults = new Map<string, BridgePendingRequest>()

  async enqueue(task: Omit<BridgeTask, 'id' | 'createdAt'>) {
    const fullTask: BridgeTask = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...task,
    }

    const resultPromise = new Promise<BridgeResultPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResults.delete(fullTask.id)
        reject(new Error('Bridge request timed out waiting for local executor'))
      }, config.bridgeRequestTimeoutMs)

      this.pendingResults.set(fullTask.id, { resolve, reject, timeout })
    })

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(fullTask)
    } else {
      this.queue.push(fullTask)
    }

    return resultPromise
  }

  async pull(timeoutMs: number) {
    const task = this.queue.shift()
    if (task) return task

    return new Promise<BridgeTask | null>((resolve) => {
      let wrappedResolve: ((task: BridgeTask | null) => void) | null = null
      const timeout = setTimeout(() => {
        if (wrappedResolve) {
          this.waiters = this.waiters.filter((waiter) => waiter !== wrappedResolve)
        }
        resolve(null)
      }, timeoutMs)

      wrappedResolve = (nextTask: BridgeTask | null) => {
        clearTimeout(timeout)
        resolve(nextTask)
      }

      this.waiters.push(wrappedResolve)
    })
  }

  complete(result: BridgeResultPayload) {
    const pending = this.pendingResults.get(result.id)
    if (!pending) return false

    clearTimeout(pending.timeout)
    this.pendingResults.delete(result.id)
    pending.resolve(result)
    return true
  }
}

const bridgeQueue = new BridgeQueue()

function isBridgeAuthorized(request: Request) {
  if (!config.bridgeToken) return false
  return request.headers.get('authorization')?.trim() === `Bearer ${config.bridgeToken}`
}

export async function handleGatewayBridgeRequest(request: Request) {
  const url = new URL(request.url)

  if (!isBridgeAuthorized(request)) {
    return errorJson('UNAUTHORIZED_BRIDGE', 'Unauthorized bridge request', 401)
  }

  if (request.method === 'POST' && url.pathname === '/api/bridge/pull') {
    const task = await bridgeQueue.pull(config.bridgePollTimeoutMs)
    return json({ ok: true, task })
  }

  if (request.method === 'POST' && url.pathname === '/api/bridge/result') {
    const body = (await request.json()) as BridgeResultPayload
    const accepted = bridgeQueue.complete(body)
    return json({ ok: accepted })
  }

  return errorJson('NOT_FOUND', 'Not found', 404)
}

export async function forwardToBridge(request: Request) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()

  const result = await bridgeQueue.enqueue({
    method: request.method,
    path: new URL(request.url).pathname + new URL(request.url).search,
    body,
    contentType: request.headers.get('content-type') || undefined,
  })

  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  })
}

async function executeBridgeTask(task: BridgeTask) {
  try {
    const response = await handleAgentRequest(
      new Request(new URL(task.path, `http://${config.host}:${config.port}`), {
        method: task.method,
        headers: task.contentType ? { 'content-type': task.contentType } : undefined,
        body: task.body,
      }),
    )

    const headers = Object.fromEntries(response.headers.entries())
    const body = await response.text()

    return {
      id: task.id,
      status: response.status,
      headers,
      body,
    } satisfies BridgeResultPayload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /timed out/i.test(message) ? 504 : 500
    const code = status === 504 ? 'TIMEOUT' : 'INTERNAL_ERROR'
    return {
      id: task.id,
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({ ok: false, code, error: message }, null, 2),
    } satisfies BridgeResultPayload
  }
}

class BridgeClient {
  private running = false

  start() {
    if (this.running) return
    if (!config.gatewayUrl || !config.bridgeToken) return
    this.running = true
    this.loop().catch((error) => {
      console.error('[midjourney-agent] bridge loop stopped:', error)
      this.running = false
    })
  }

  private async loop() {
    while (this.running) {
      try {
        const pullResponse = await curlJson(
          new URL('/api/bridge/pull', config.gatewayUrl).toString(),
          config.bridgeToken,
          JSON.stringify({ executor: config.profileName }),
          Math.ceil(config.bridgePollTimeoutMs / 1000) + 10,
        )

        if (pullResponse.status < 200 || pullResponse.status >= 300) {
          throw new Error(`Bridge pull failed with status ${pullResponse.status}`)
        }

        const payload = JSON.parse(pullResponse.body) as { task: BridgeTask | null }
        if (!payload.task) {
          continue
        }

        const result = await executeBridgeTask(payload.task)
        const pushResponse = await curlJson(
          new URL('/api/bridge/result', config.gatewayUrl).toString(),
          config.bridgeToken,
          JSON.stringify(result),
          30,
        )

        if (pushResponse.status < 200 || pushResponse.status >= 300) {
          throw new Error(`Bridge result push failed with status ${pushResponse.status}`)
        }
      } catch (error) {
        console.error('[midjourney-agent] bridge error:', error)
        await sleep(config.bridgeRetryDelayMs)
      }
    }
  }
}

export const bridgeClient = new BridgeClient()
