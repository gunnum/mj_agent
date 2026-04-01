import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'

try {
  loadEnvFile()
} catch {
  // Railway and other managed runtimes may inject env vars without a local .env file.
}

function requireAbsoluteChromePath(input: string) {
  const value = input.trim()
  if (!value.startsWith('/')) {
    throw new Error(`MJ_CHROME_PATH must be an absolute path, received: ${value}`)
  }
  return value
}

export const config = {
  mode: process.env.MJ_AGENT_MODE?.trim() || 'executor',
  port: Number.parseInt(process.env.PORT || process.env.MJ_AGENT_PORT || '18123', 10),
  host: process.env.MJ_AGENT_HOST?.trim() || '127.0.0.1',
  runtimeDir: process.env.MJ_RUNTIME_DIR?.trim() || join(process.cwd(), 'runtime'),
  requestLogDir: process.env.MJ_REQUEST_LOG_DIR?.trim() || join(process.cwd(), 'runtime', 'request-logs'),
  apiToken: process.env.MJ_API_TOKEN?.trim() || '',
  apiTokens: (process.env.MJ_API_TOKENS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean),
  tokenRegistryPath: process.env.MJ_TOKEN_REGISTRY_PATH?.trim() || join(process.cwd(), 'runtime', 'token-registry.md'),
  gatewayUrl: process.env.MJ_GATEWAY_URL?.trim() || '',
  bridgeToken: process.env.MJ_BRIDGE_TOKEN?.trim() || '',
  bridgePollTimeoutMs: Number.parseInt(process.env.MJ_BRIDGE_POLL_TIMEOUT_MS || '25000', 10),
  bridgeRequestTimeoutMs: Number.parseInt(process.env.MJ_BRIDGE_REQUEST_TIMEOUT_MS || '120000', 10),
  bridgeRetryDelayMs: Number.parseInt(process.env.MJ_BRIDGE_RETRY_DELAY_MS || '3000', 10),
  corsOrigins: (process.env.MJ_CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  chromePath: requireAbsoluteChromePath(
    process.env.MJ_CHROME_PATH?.trim() || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ),
  profileName: process.env.MJ_PROFILE_NAME?.trim() || 'default',
  userDataDir:
    process.env.MJ_USER_DATA_DIR?.trim() ||
    join(homedir(), '.midjourney-agent', process.env.MJ_PROFILE_NAME?.trim() || 'default'),
  headless: /^(1|true|yes)$/i.test(process.env.MJ_HEADLESS || ''),
  backgroundHeadless: process.env.MJ_BACKGROUND_HEADLESS
    ? /^(1|true|yes)$/i.test(process.env.MJ_BACKGROUND_HEADLESS)
    : true,
  defaultTimeoutMs: Number.parseInt(process.env.MJ_TIMEOUT_MS || '30000', 10),
  apiFetchTimeoutMs: Number.parseInt(process.env.MJ_FETCH_TIMEOUT_MS || '20000', 10),
  executionQueueTimeoutMs: Number.parseInt(process.env.MJ_EXECUTION_QUEUE_TIMEOUT_MS || '60000', 10),
  targetExploreUrl: process.env.MJ_EXPLORE_URL?.trim() || 'https://www.midjourney.com/explore',
}
