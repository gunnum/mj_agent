#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output, exit } from 'node:process'

const execFileAsync = promisify(execFile)
const CONFIG_DIR = join(homedir(), '.mj-agent-cli')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const DEFAULT_BASE_URL = process.env.MJ_AGENT_CLI_BASE_URL || 'https://mjagent-production.up.railway.app'
const MIN_NODE_MAJOR = 20

function printHelp() {
  console.log(`mj-agent

Usage:
  mj-agent setup
  mj-agent doctor
  mj-agent auth [token]
  mj-agent version
  mj-agent restart [project-path]
  mj-agent get <path>
  mj-agent post <path> [json]
  mj-agent request <method> <path> [json]

Examples:
  mj-agent setup
  mj-agent auth <token>
  mj-agent version
  mj-agent restart /Users/you/Documents/ide/midjourney-agent
  mj-agent get /health
  mj-agent get '/api/explore/search?prompt=red&page=1'
  mj-agent post /api/explore/search '{"prompt":"red","page":1}'
`)
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '')
}

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function commandExists(name) {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${name}`])
    return true
  } catch {
    return false
  }
}

function getNodeCheck() {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10)
  return {
    ok: major >= MIN_NODE_MAJOR,
    message: `node ${process.versions.node}`,
  }
}

async function runCurlJson({ method, url, token, body }) {
  const args = [
    '-sS',
    '--connect-timeout',
    '10',
    '--max-time',
    '180',
    '-X',
    method,
    '-H',
    'Accept: application/json',
    '-H',
    `Authorization: Bearer ${token}`,
  ]

  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '-d', body)
  }

  args.push('-w', '\n%{http_code}', url)

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 20 * 1024 * 1024 })
  const separator = stdout.lastIndexOf('\n')
  const responseBody = separator >= 0 ? stdout.slice(0, separator) : stdout
  const statusText = separator >= 0 ? stdout.slice(separator + 1).trim() : '0'
  const status = Number.parseInt(statusText, 10)

  return {
    status,
    body: responseBody,
  }
}

async function validateAuth(config) {
  if (!config.baseUrl || !config.token) {
    return { ok: false, message: 'missing baseUrl or token' }
  }

  try {
    const response = await runCurlJson({
      method: 'GET',
      url: `${normalizeBaseUrl(config.baseUrl)}/health`,
      token: config.token,
    })

    if (response.status === 401) {
      return { ok: false, message: 'token rejected by server' }
    }

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, message: 'authentication succeeded' }
    }

    return { ok: false, message: `server returned ${response.status}` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function printCheck(label, ok, message) {
  console.log(`${ok ? 'OK' : 'FAIL'}  ${label}: ${message}`)
}

async function runDoctor() {
  const config = await loadConfig()
  const nodeCheck = getNodeCheck()
  const curlInstalled = await commandExists('curl')
  const hasBaseUrl = Boolean(config.baseUrl)
  const hasToken = Boolean(config.token)

  printCheck('Node', nodeCheck.ok, nodeCheck.message)
  printCheck('curl', curlInstalled, curlInstalled ? 'installed' : 'not found')
  printCheck('Config file', Boolean(config.baseUrl || config.token), CONFIG_PATH)
  printCheck('Base URL', hasBaseUrl, config.baseUrl || 'not configured')
  printCheck('Token', hasToken, hasToken ? 'configured' : 'not configured')

  if (hasBaseUrl && hasToken && curlInstalled) {
    const authCheck = await validateAuth(config)
    printCheck('Auth', authCheck.ok, authCheck.message)
  } else {
    printCheck('Auth', false, 'run `mj-agent setup` first')
  }
}

async function promptForConfig(existing = {}) {
  const rl = readline.createInterface({ input, output })
  try {
    const baseUrlInput = await rl.question(`Base URL [${existing.baseUrl || DEFAULT_BASE_URL}]: `)
    const baseUrl = normalizeBaseUrl((baseUrlInput || existing.baseUrl || DEFAULT_BASE_URL).trim())
    const tokenInput = await rl.question(`Bearer token${existing.token ? ' [press enter to keep current]' : ''}: `)
    const token = tokenInput.trim() || existing.token || ''

    return { baseUrl, token }
  } finally {
    rl.close()
  }
}

async function runSetup() {
  console.log(`Checking local environment...`)
  const nodeCheck = getNodeCheck()
  const curlInstalled = await commandExists('curl')

  if (!nodeCheck.ok) {
    console.error(`Node ${MIN_NODE_MAJOR}+ is required. Current: ${process.versions.node}`)
    exit(1)
  }

  if (!curlInstalled) {
    console.error('curl is required but was not found in PATH')
    exit(1)
  }

  console.log(`Node ok: ${process.versions.node}`)
  console.log(`curl ok`)

  const current = await loadConfig()
  const nextConfig = await promptForConfig(current)

  if (!nextConfig.token) {
    console.error('Token is required')
    exit(1)
  }

  await saveConfig(nextConfig)
  const authCheck = await validateAuth(nextConfig)
  if (!authCheck.ok) {
    console.error(`Authentication failed: ${authCheck.message}`)
    exit(1)
  }

  console.log(`Configuration saved to ${CONFIG_PATH}`)
  console.log(`Authentication succeeded`)
}

async function runAuth(tokenArg) {
  const current = await loadConfig()
  let token = tokenArg?.trim()

  if (!token) {
    const rl = readline.createInterface({ input, output })
    try {
      const tokenInput = await rl.question('Bearer token: ')
      token = tokenInput.trim()
    } finally {
      rl.close()
    }
  }

  if (!token) {
    console.error('Token is required')
    exit(1)
  }

  const nextConfig = {
    ...current,
    baseUrl: normalizeBaseUrl(current.baseUrl || DEFAULT_BASE_URL),
    token,
  }

  const authCheck = await validateAuth(nextConfig)
  if (!authCheck.ok) {
    console.error(`Authentication failed: ${authCheck.message}`)
    exit(1)
  }

  await saveConfig(nextConfig)
  console.log(`Token saved to ${CONFIG_PATH}`)
  console.log(`Authentication succeeded`)
}

async function runRequest(method, pathArg, bodyArg) {
  const config = await loadConfig()
  if (!config.baseUrl || !config.token) {
    console.error('CLI is not configured. Run `mj-agent setup` first.')
    exit(1)
  }

  if (!pathArg) {
    console.error('Path is required')
    exit(1)
  }

  const path = pathArg.startsWith('/') ? pathArg : `/${pathArg}`
  const url = `${normalizeBaseUrl(config.baseUrl)}${path}`
  const body = bodyArg !== undefined ? bodyArg : undefined

  try {
    const response = await runCurlJson({
      method: method.toUpperCase(),
      url,
      token: config.token,
      body,
    })

    let outputText = response.body
    try {
      outputText = `${JSON.stringify(JSON.parse(response.body), null, 2)}\n`
    } catch {
      outputText = `${response.body}\n`
    }

    process.stdout.write(outputText)
    if (response.status < 200 || response.status >= 300) {
      exit(1)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    exit(1)
  }
}

async function runVersion() {
  const packageJsonPath = new URL('../package.json', import.meta.url)
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  console.log(`${packageJson.name} ${packageJson.version}`)
}

async function runRestart(projectPathArg) {
  const projectPath = projectPathArg || process.cwd()
  const scriptPath = join(projectPath, 'restart.command')

  try {
    await execFileAsync(scriptPath, [], { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 })
    console.log(`Restarted project: ${projectPath}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Failed to restart project via ${scriptPath}`)
    console.error(message)
    exit(1)
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'setup':
      await runSetup()
      return
    case 'doctor':
      await runDoctor()
      return
    case 'auth':
      await runAuth(args[0])
      return
    case 'version':
      await runVersion()
      return
    case 'restart':
      await runRestart(args[0])
      return
    case 'get':
      await runRequest('GET', args[0])
      return
    case 'post':
      await runRequest('POST', args[0], args[1])
      return
    case 'request':
      await runRequest(args[0] || 'GET', args[1], args[2])
      return
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      return
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  exit(1)
})
