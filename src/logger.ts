import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.js'

interface RequestLogEntry {
  method: string
  path: string
  status: number
  durationMs: number
  remoteAddress: string
  userAgent: string
  error?: string
}

function formatDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function getLocalDateFileName(date: Date) {
  const year = date.getFullYear()
  const month = formatDatePart(date.getMonth() + 1)
  const day = formatDatePart(date.getDate())
  return `${year}-${month}-${day}.log`
}

export async function logRequest(entry: RequestLogEntry) {
  const now = new Date()
  const payload = {
    timestamp: now.toISOString(),
    ...entry,
  }

  const suffix = entry.error ? ` error=${entry.error}` : ''
  console.log(
    `[midjourney-agent] ${entry.method} ${entry.path} -> ${entry.status} ${entry.durationMs}ms ip=${entry.remoteAddress}${suffix}`,
  )

  await mkdir(config.requestLogDir, { recursive: true })
  const filePath = join(config.requestLogDir, getLocalDateFileName(now))
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

export function getRequestPath(url: URL) {
  return `${url.pathname}${url.search}`
}

export function getRemoteAddress(rawAddress: string | undefined) {
  return rawAddress?.trim() || '-'
}

export function getUserAgent(userAgent: string | undefined) {
  return userAgent?.trim() || '-'
}

export function getRequestLogDir() {
  return config.requestLogDir
}
