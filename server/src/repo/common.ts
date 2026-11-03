export { NotFound } from '../domain/errors'

export function nowIso(): string {
  return new Date().toISOString()
}

export function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
