import { readFile } from 'node:fs/promises'
import { config } from './config.js'

interface TokenRecord {
  status: string
  name: string
  token: string
  note: string
}

function normalizeCell(value: string) {
  return value.trim()
}

function parseTableRow(line: string) {
  if (!line.trim().startsWith('|')) return null
  const cells = line
    .split('|')
    .slice(1, -1)
    .map(normalizeCell)

  if (cells.length < 4) return null
  if (cells.every((cell) => /^-+$/.test(cell.replace(/:/g, '')))) return null
  if (cells[0].toLowerCase() === 'status') return null

  const [status, name, token, note] = cells
  if (!token) return null

  return {
    status,
    name,
    token,
    note,
  } satisfies TokenRecord
}

async function loadRegistryTokens() {
  try {
    const content = await readFile(config.tokenRegistryPath, 'utf8')
    return content
      .split(/\r?\n/)
      .map(parseTableRow)
      .filter((record): record is TokenRecord => Boolean(record))
  } catch {
    return []
  }
}

function isActiveStatus(value: string) {
  return /^(active|enabled|on|true|yes)$/i.test(value.trim())
}

export async function isAuthorizedToken(authorization: string | null) {
  const bearer = authorization?.trim()
  const registryTokens = await loadRegistryTokens()
  const activeRegistryTokens = registryTokens.filter((record) => isActiveStatus(record.status))

  if (activeRegistryTokens.length > 0) {
    return activeRegistryTokens.some((record) => bearer === `Bearer ${record.token}`)
  }

  if (config.apiTokens.length > 0) {
    return config.apiTokens.some((token) => bearer === `Bearer ${token}`)
  }

  if (config.apiToken) {
    return bearer === `Bearer ${config.apiToken}`
  }

  return true
}
