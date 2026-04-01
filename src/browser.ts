import { mkdir } from 'node:fs/promises'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { config } from './config.js'
import { activateChrome } from './utils.js'

class MidjourneyBrowser {
  private contextPromise: Promise<BrowserContext> | null = null
  private contextHeadless: boolean | null = null
  private contextLock: Promise<void> = Promise.resolve()
  private backgroundHeadlessAvailable = config.backgroundHeadless
  private executionQueue: Array<{ label: string; start: () => void }> = []
  private isExecuting = false
  private queuedTasks = 0
  private activeTaskLabel: string | null = null

  async getContext(options: { interactive?: boolean } = {}) {
    return this.withContextLock(async () => {
      const desiredHeadless = options.interactive
        ? false
        : this.contextHeadless ?? (this.backgroundHeadlessAvailable ? true : config.headless)

      if (this.contextPromise && this.contextHeadless === desiredHeadless) {
        return this.contextPromise
      }

      if (this.contextPromise) {
        await this.closeContext()
      }

      this.contextHeadless = desiredHeadless
      this.contextPromise = this.createContext(desiredHeadless).catch((error) => {
        this.contextPromise = null
        this.contextHeadless = null
        throw error
      })

      return this.contextPromise
    })
  }

  async getPage(options: { interactive?: boolean } = {}) {
    try {
      const context = await this.getContext(options)
      return await this.preparePage(context)
    } catch (error) {
      if (!options.interactive && this.contextHeadless && this.shouldFallbackToBackgroundWindow(error)) {
        this.backgroundHeadlessAvailable = false
        await this.withContextLock(async () => {
          await this.closeContext()
        })
        const context = await this.getContext(options)
        return this.preparePage(context)
      }
      throw error
    }
  }

  async getStatus() {
    return this.withExecutionQueue('status', async () => {
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
          headless: this.contextHeadless ?? (this.backgroundHeadlessAvailable ? true : config.headless),
          browserReady: true,
          loginState,
          currentPageUrl: url,
          serialMode: true,
          activeTask: this.activeTaskLabel,
          queuedTasks: this.queuedTasks,
        }
      } catch (error) {
        return {
          ok: false,
          checkedAt: new Date().toISOString(),
          chromePath: config.chromePath,
          userDataDir: config.userDataDir,
          profileName: config.profileName,
          headless: this.contextHeadless ?? (this.backgroundHeadlessAvailable ? true : config.headless),
          browserReady: false,
          loginState: 'unknown' as const,
          currentPageUrl: null,
          error: error instanceof Error ? error.message : String(error),
          serialMode: true,
          activeTask: this.activeTaskLabel,
          queuedTasks: this.queuedTasks,
        }
      }
    })
  }

  async openExplore() {
    return this.withExecutionQueue('open_explore', async () => {
      const page = await this.ensureExploreReady(config.targetExploreUrl, { focus: true, interactive: true })
      return {
        ok: true,
        url: page.url(),
        message: 'Explore page opened. Complete login or Cloudflare in the Chrome window if needed.',
      }
    })
  }

  async runSearch(prompt: string, pageNumber: number) {
    return this.withExecutionQueue('search_images', async () => {
      const response = await this.fetchApiWithFallback(
        config.targetExploreUrl,
        `/api/explore-vector-search?prompt=${encodeURIComponent(prompt)}&page=${pageNumber}&_ql=explore`,
      )

      return {
        ok: true,
        kind: 'search_images' as const,
        query: { prompt, page: pageNumber },
        response,
      }
    })
  }

  async fetchStylesTop(pageNumber: number) {
    return this.withExecutionQueue('styles_top', async () => {
      const targetUrl = 'https://www.midjourney.com/explore?tab=styles_top'
      const response = await this.fetchApiWithFallback(targetUrl, `/api/explore-srefs?page=${pageNumber}&_ql=explore&feed=styles_top`)

      return {
        ok: true,
        kind: 'styles_top' as const,
        query: { page: pageNumber },
        response,
      }
    })
  }

  async fetchVideoTop(pageNumber: number) {
    return this.withExecutionQueue('video_top', async () => {
      const targetUrl = 'https://www.midjourney.com/explore?tab=video_top'
      const response = await this.fetchApiWithFallback(targetUrl, `/api/explore?page=${pageNumber}&feed=video_top&_ql=explore`)

      return {
        ok: true,
        kind: 'video_top' as const,
        query: { page: pageNumber },
        response,
      }
    })
  }

  private async createContext(headless: boolean) {
    await mkdir(config.userDataDir, { recursive: true })
    const context = await chromium.launchPersistentContext(config.userDataDir, {
      headless,
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

  private async preparePage(context: BrowserContext) {
    const page = (await this.findBestPage(context)) || (await context.newPage())
    page.setDefaultTimeout(config.defaultTimeoutMs)
    return page
  }

  private async ensureExploreReady(
    targetUrl = config.targetExploreUrl,
    options: { focus?: boolean; interactive?: boolean } = {},
  ) {
    const page = await this.getPage({ interactive: options.interactive })
    if (!page.url() || !page.url().includes('midjourney.com/explore')) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.defaultTimeoutMs }).catch(() => {})
    }
    if (options.focus) {
      await page.bringToFront().catch(() => {})
      activateChrome()
    }
    return page
  }

  private async closeContext() {
    const contextPromise = this.contextPromise
    this.contextPromise = null
    this.contextHeadless = null
    if (!contextPromise) return

    const context = await contextPromise.catch(() => null)
    if (context) {
      await context.close().catch(() => {})
    }
  }

  private async withContextLock<T>(fn: () => Promise<T>) {
    const previous = this.contextLock
    let release!: () => void
    this.contextLock = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private async withExecutionQueue<T>(label: string, fn: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      let started = false
      const waitTimeout = setTimeout(() => {
        if (started) return
        const index = this.executionQueue.indexOf(task)
        if (index >= 0) {
          this.executionQueue.splice(index, 1)
          this.queuedTasks = this.executionQueue.length
        }
        reject(new Error(`Execution queue timed out after ${config.executionQueueTimeoutMs}ms`))
      }, config.executionQueueTimeoutMs)

      const task = {
        label,
        start: () => {
          started = true
          clearTimeout(waitTimeout)
          this.isExecuting = true
          this.activeTaskLabel = label
          void (async () => {
            try {
              resolve(await fn())
            } catch (error) {
              reject(error)
            } finally {
              this.activeTaskLabel = null
              this.isExecuting = false
              this.drainExecutionQueue()
            }
          })()
        },
      }

      this.executionQueue.push(task)
      this.queuedTasks = this.isExecuting ? this.executionQueue.length : Math.max(this.executionQueue.length - 1, 0)
      this.drainExecutionQueue()
    })
  }

  private drainExecutionQueue() {
    if (this.isExecuting) {
      this.queuedTasks = this.executionQueue.length
      return
    }

    const task = this.executionQueue.shift()
    this.queuedTasks = this.executionQueue.length
    if (!task) return
    task.start()
  }

  private shouldFallbackToBackgroundWindow(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return /Target page, context or browser has been closed|Browser closed|Page closed/i.test(message)
  }

  private async fetchApi(page: Page, path: string) {
    const result = await page.evaluate(
      async ({ relativePath, timeoutMs }) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        try {
          const response = await fetch(relativePath, {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
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
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Midjourney API fetch timed out after ${timeoutMs}ms`)
          }
          throw new Error(error instanceof Error ? error.message : String(error))
        } finally {
          clearTimeout(timeout)
        }
      },
      { relativePath: path, timeoutMs: config.apiFetchTimeoutMs },
    )

    return {
      ...result,
      capturedAt: new Date().toISOString(),
    }
  }

  private async fetchApiWithFallback(targetUrl: string, path: string) {
    let page = await this.ensureExploreReady(targetUrl)
    let response = await this.fetchApi(page, path)

    if (this.contextHeadless && this.isCloudflareChallenge(response)) {
      this.backgroundHeadlessAvailable = false
      await this.withContextLock(async () => {
        await this.closeContext()
      })
      page = await this.ensureExploreReady(targetUrl)
      response = await this.fetchApi(page, path)
    }

    return response
  }

  private async detectLoginState(page: Page) {
    const url = page.url()
    if (/login|signin|auth/i.test(url)) return 'logged_out' as const
    const content = await page.content().catch(() => '')
    if (/sign in|log in|join midjourney/i.test(content)) return 'logged_out' as const
    if (/midjourney/i.test(content)) return 'logged_in' as const
    return 'unknown' as const
  }

  private isCloudflareChallenge(response: { status: number; body: unknown }) {
    if (response.status !== 403) return false
    if (typeof response.body !== 'string') return false
    return /Just a moment|challenge-platform|Enable JavaScript and cookies to continue/i.test(response.body)
  }
}

export const midjourneyBrowser = new MidjourneyBrowser()
