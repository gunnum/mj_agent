import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { config } from './config.js'
import { midjourneyBrowser } from './browser.js'
import { getRemoteAddress, getRequestLogDir, getRequestPath, getUserAgent, logRequest } from './logger.js'
import { json, getNumber, readJson } from './utils.js'

async function handle(request: Request) {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/health') {
    return json(await midjourneyBrowser.getStatus())
  }

  if (request.method === 'POST' && url.pathname === '/api/browser/open') {
    return json(await midjourneyBrowser.openExplore())
  }

  if (request.method === 'GET' && url.pathname === '/api/login/status') {
    return json(await midjourneyBrowser.getStatus())
  }

  if (request.method === 'POST' && url.pathname === '/api/explore/search') {
    const body = await readJson<{ prompt?: string; page?: number }>(request)
    const prompt = body.prompt?.trim()
    if (!prompt) {
      return json({ error: 'prompt is required' }, { status: 400 })
    }
    const page = Number.isFinite(body.page) ? Number(body.page) : 1
    return json(await midjourneyBrowser.runSearch(prompt, page))
  }

  if (request.method === 'GET' && url.pathname === '/api/explore/search') {
    const prompt = url.searchParams.get('prompt')?.trim()
    if (!prompt) {
      return json({ error: 'prompt is required' }, { status: 400 })
    }
    const page = getNumber(url.searchParams.get('page'), 1)
    return json(await midjourneyBrowser.runSearch(prompt, page))
  }

  if (request.method === 'GET' && url.pathname === '/api/explore/styles-top') {
    const page = getNumber(url.searchParams.get('page'), 1)
    return json(await midjourneyBrowser.fetchStylesTop(page))
  }

  if (request.method === 'GET' && url.pathname === '/api/explore/video-top') {
    const page = getNumber(url.searchParams.get('page'), 1)
    return json(await midjourneyBrowser.fetchVideoTop(page))
  }

  return json({ error: 'Not found' }, { status: 404 })
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
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: message }, null, 2))
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
