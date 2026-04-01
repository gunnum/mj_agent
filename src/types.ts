export type MidjourneyEndpointKind = 'search_images' | 'styles_top' | 'video_top'

export interface MidjourneyAgentStatus {
  ok: boolean
  checkedAt: string
  chromePath: string
  userDataDir: string
  profileName: string
  headless: boolean
  browserReady: boolean
  loginState: 'unknown' | 'logged_in' | 'logged_out'
  currentPageUrl?: string | null
  serialMode?: boolean
  activeTask?: string | null
  queuedTasks?: number
  error?: string
}

export interface MidjourneyQueryOptions {
  page?: number
  prompt?: string
}

export interface MidjourneyApiCapture {
  url: string
  status: number
  ok: boolean
  body: unknown
  capturedAt: string
}

export interface MidjourneyQueryResult {
  ok: boolean
  kind: MidjourneyEndpointKind
  query: {
    page: number
    prompt?: string
  }
  response: MidjourneyApiCapture
}
