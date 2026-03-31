import { mkdir } from 'node:fs/promises'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { config } from './config.js'
import { activateChrome } from './utils.js'

class MidjourneyBrowser {
  private contextPromise: Promise<BrowserContext> | null = null

  async getContext() {
    if (!this.contextPromise) {
      this.contextPromise = this.createContext()
    }
    return this.contextPromise
  }

  async getPage() {
    const context = await this.getContext()
    const page = (await this.findBestPage(context)) || (await context.newPage())
    page.setDefaultTimeout(config.defaultTimeoutMs)
    return page
  }

  async getStatus() {
    try {
      const page = await this.getPage()
      const url = page.url() || null
      const loginState = await this.detectLoginState(page)
      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        chromePath: config.chromePath,
        userDataDir: config.userDataDir,
        profileName: config.profileName,
        headless: config.headless,
        browserReady: true,
        loginState,
        currentPageUrl: url,
      }
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        chromePath: config.chromePath,
        userDataDir: config.userDataDir,
        profileName: config.profileName,
        headless: config.headless,
        browserReady: false,
        loginState: 'unknown' as const,
        currentPageUrl: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async openExplore() {
    const page = await this.getPage()
    await page.goto(config.targetExploreUrl, { waitUntil: 'domcontentloaded', timeout: config.defaultTimeoutMs }).catch(() => {})
    await page.bringToFront().catch(() => {})
    activateChrome()
    return {
      ok: true,
      url: page.url(),
      message: 'Explore page opened. Complete login or Cloudflare in the Chrome window if needed.',
    }
  }

  async runSearch(prompt: string, pageNumber: number) {
    const page = await this.ensureExploreReady()
    const response = await this.fetchApi(page, `/api/explore-vector-search?prompt=${encodeURIComponent(prompt)}&page=${pageNumber}&_ql=explore`)

    return {
      ok: true,
      kind: 'search_images' as const,
      query: { prompt, page: pageNumber },
      response,
    }
  }

  async fetchStylesTop(pageNumber: number) {
    const page = await this.ensureExploreReady('https://www.midjourney.com/explore?tab=styles_top')
    const response = await this.fetchApi(page, `/api/explore-srefs?page=${pageNumber}&_ql=explore&feed=styles_top`)

    return {
      ok: true,
      kind: 'styles_top' as const,
      query: { page: pageNumber },
      response,
    }
  }

  async fetchVideoTop(pageNumber: number) {
    const page = await this.ensureExploreReady('https://www.midjourney.com/explore?tab=video_top')
    const response = await this.fetchApi(page, `/api/explore?page=${pageNumber}&feed=video_top&_ql=explore`)

    return {
      ok: true,
      kind: 'video_top' as const,
      query: { page: pageNumber },
      response,
    }
  }

  private async createContext() {
    await mkdir(config.userDataDir, { recursive: true })
    const context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: config.headless,
      executablePath: config.chromePath,
      viewport: { width: 1600, height: 1000 },
      args: ['--disable-blink-features=AutomationControlled', '--window-size=1600,1000', '--lang=en-US'],
    })
    return context
  }

  private async findBestPage(context: BrowserContext) {
    const pages = context.pages().filter((page) => !page.isClosed())
    if (!pages.length) return null

    const candidates = [
      pages.find((page) => page.url().includes('midjourney.com/explore')),
      pages.find((page) => page.url().includes('midjourney.com')),
      pages.find((page) => page.url() && page.url() !== 'about:blank'),
      pages[0],
    ]

    return candidates.find((page): page is Page => Boolean(page)) || null
  }

  private async ensureExploreReady(targetUrl = config.targetExploreUrl) {
    const page = await this.getPage()
    if (!page.url() || !page.url().includes('midjourney.com/explore')) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.defaultTimeoutMs }).catch(() => {})
    }
    await page.bringToFront().catch(() => {})
    activateChrome()
    return page
  }

  private async fetchApi(page: Page, path: string) {
    const result = await page.evaluate(async (relativePath) => {
      const response = await fetch(relativePath, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'x-csrf-protection': '1',
          'x-requested-with': 'XMLHttpRequest',
          accept: 'application/json, text/plain, */*',
        },
      })

      const text = await response.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }

      return {
        url: response.url,
        status: response.status,
        ok: response.ok,
        body,
      }
    }, path)

    return {
      ...result,
      capturedAt: new Date().toISOString(),
    }
  }

  private async detectLoginState(page: Page) {
    const url = page.url()
    if (/login|signin|auth/i.test(url)) return 'logged_out' as const
    const content = await page.content().catch(() => '')
    if (/sign in|log in|join midjourney/i.test(content)) return 'logged_out' as const
    if (/midjourney/i.test(content)) return 'logged_in' as const
    return 'unknown' as const
  }
}

export const midjourneyBrowser = new MidjourneyBrowser()
