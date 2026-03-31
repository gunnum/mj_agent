import { midjourneyBrowser } from './browser.js'
import { getNumber, json, readJson } from './utils.js'

export async function handleAgentRequest(request: Request) {
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
