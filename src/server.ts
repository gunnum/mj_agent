import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { config } from './config.js'
import { midjourneyBrowser } from './browser.js'
import { getRemoteAddress, getRequestLogDir, getRequestPath, getUserAgent, logRequest } from './logger.js'
import { isAuthorizedToken } from './tokens.js'
import { json, getNumber, readJson } from './utils.js'

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

async function handle(request: Request) {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }), request)
  }

  if (!(await isAuthorizedToken(request.headers.get('authorization')))) {
    return withCors(
      new Response(JSON.stringify({ error: 'Unauthorized' }, null, 2), {
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

  if (request.method === 'GET' && url.pathname === '/health') {
    return withCors(json(await midjourneyBrowser.getStatus()), request)
  }

  if (request.method === 'POST' && url.pathname === '/api/browser/open') {
    return withCors(json(await midjourneyBrowser.openExplore()), request)
  }

  if (request.method === 'GET' && url.pathname === '/api/login/status') {
    return withCors(json(await midjourneyBrowser.getStatus()), request)
  }

  if (request.method === 'POST' && url.pathname === '/api/explore/search') {
    const body = await readJson<{ prompt?: string; page?: number }>(request)
    const prompt = body.prompt?.trim()
    if (!prompt) {
      return withCors(json({ error: 'prompt is required' }, { status: 400 }), request)
    }
    const page = Number.isFinite(body.page) ? Number(body.page) : 1
    return withCors(json(await midjourneyBrowser.runSearch(prompt, page)), request)
  }

  if (request.method === 'GET' && url.pathname === '/api/explore/search') {
    const prompt = url.searchParams.get('prompt')?.trim()
    if (!prompt) {
      return withCors(json({ error: 'prompt is required' }, { status: 400 }), request)
    }
    const page = getNumber(url.searchParams.get('page'), 1)
    return withCors(json(await midjourneyBrowser.runSearch(prompt, page)), request)
  }

  if (request.method === 'GET' && url.pathname === '/api/explore/styles-top') {
    const page = getNumber(url.searchParams.get('page'), 1)
    return withCors(json(await midjourneyBrowser.fetchStylesTop(page)), request)
  }

  if (request.method === 'GET' && url.pathname === '/api/explore/video-top') {
    const page = getNumber(url.searchParams.get('page'), 1)
    return withCors(json(await midjourneyBrowser.fetchVideoTop(page)), request)
  }

  return withCors(json({ error: 'Not found' }, { status: 404 }), request)
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
    const response = await handle(request)
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
    const response = withCors(
      new Response(JSON.stringify({ error: message }, null, 2), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
      request,
    )
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(await response.text())
    await logRequest({
      method,
      path,
      status: 500,
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
  console.log(`[midjourney-agent] profile=${config.userDataDir}`)
  console.log(`[midjourney-agent] requestLogs=${getRequestLogDir()}`)
})

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
