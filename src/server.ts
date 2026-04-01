import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { bridgeClient, forwardToBridge, handleGatewayBridgeRequest } from './bridge.js'
import { config } from './config.js'
import { getRemoteAddress, getRequestLogDir, getRequestPath, getUserAgent, logRequest } from './logger.js'
import { handleAgentRequest } from './routes.js'
import { isAuthorizedToken } from './tokens.js'
import { errorJson, json } from './utils.js'

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get('origin')?.trim()
  if (!origin) return {}
  if (!config.corsOrigins.includes(origin)) return {}

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

function withCors(response: Response, request: Request) {
  const headers = buildCorsHeaders(request)
  if (!Object.keys(headers).length) return response

  const nextHeaders = new Headers(response.headers)
  for (const [key, value] of Object.entries(headers)) {
    nextHeaders.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  })
}

async function handlePublicRequest(request: Request) {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }), request)
  }

  if (url.pathname === '/healthz') {
    return withCors(
      json({
        ok: true,
        mode: config.mode,
        checkedAt: new Date().toISOString(),
        bridgeEnabled: config.mode === 'gateway' ? Boolean(config.bridgeToken) : Boolean(config.gatewayUrl && config.bridgeToken),
      }),
      request,
    )
  }

  if (!(await isAuthorizedToken(request.headers.get('authorization')))) {
    return withCors(
      new Response(errorJson('UNAUTHORIZED', 'Unauthorized', 401).body, {
        status: 401,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'www-authenticate': 'Bearer',
        },
      }),
      request,
    )
  }

  const response =
    config.mode === 'gateway' ? await forwardToBridge(request) : await handleAgentRequest(request)

  return withCors(response, request)
}

async function handleRequest(request: Request) {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/bridge/')) {
    return handleGatewayBridgeRequest(request)
  }

  return handlePublicRequest(request)
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now()
  const origin = `http://${req.headers.host || `${config.host}:${config.port}`}`
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req)
  const requestUrl = new URL(req.url || '/', origin)
  const request = new Request(requestUrl, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body,
  })
  const method = req.method || 'GET'
  const path = getRequestPath(requestUrl)
  const remoteAddress = getRemoteAddress(req.socket.remoteAddress)
  const userAgent = getUserAgent(req.headers['user-agent'])

  try {
    const response = await handleRequest(request)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    const responseBody = await response.text()
    res.end(responseBody)
    await logRequest({
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      remoteAddress,
      userAgent,
    }).catch((logError) => {
      console.error('[midjourney-agent] failed to write request log:', logError)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /timed out/i.test(message) ? 504 : 500
    const code = status === 504 ? 'TIMEOUT' : 'INTERNAL_ERROR'
    const response = withCors(
      errorJson(code, message, status),
      request,
    )
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(await response.text())
    await logRequest({
      method,
      path,
      status,
      durationMs: Date.now() - startedAt,
      remoteAddress,
      userAgent,
      error: message,
    }).catch((logError) => {
      console.error('[midjourney-agent] failed to write request log:', logError)
    })
  }
})

server.listen(config.port, config.host, () => {
  console.log(`[midjourney-agent] listening on http://${config.host}:${config.port}`)
  console.log(`[midjourney-agent] mode=${config.mode}`)
  console.log(`[midjourney-agent] profile=${config.userDataDir}`)
  console.log(`[midjourney-agent] requestLogs=${getRequestLogDir()}`)
  if (config.mode !== 'gateway' && config.gatewayUrl && config.bridgeToken) {
    console.log(`[midjourney-agent] bridge->gateway=${config.gatewayUrl}`)
    bridgeClient.start()
  }
})

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
