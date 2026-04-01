import { execFileSync } from 'node:child_process'

export function json(data: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export function errorJson(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return json(
    {
      ok: false,
      code,
      error: message,
      ...extra,
    },
    { status },
  )
}

export async function readJson<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>
}

export function getNumber(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parsePage(value: number | string | null | undefined, fallback = 1) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN

  return Number.isFinite(parsed) ? parsed : fallback
}

export function isValidPage(page: number) {
  return Number.isInteger(page) && page >= 1 && page <= 100
}

export function activateChrome() {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('/usr/bin/osascript', ['-e', 'tell application "Google Chrome" to activate'], {
      stdio: 'ignore',
    })
  } catch {
    // ignore activation failures
  }
}
