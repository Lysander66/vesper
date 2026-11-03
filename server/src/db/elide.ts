/** 落库前剥掉 base64 本体，产物已经落盘。只认 base64 与 data URI，文本端点的长正文原样保留。 */

const BASE64_MIN = 1024
const BASE64_ONLY = /^[A-Za-z0-9+/\s]+={0,2}$/

export function elideBase64(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length < BASE64_MIN) return value
    const payload = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
    if (!BASE64_ONLY.test(payload)) return value
    return `…（base64 已省略，${value.length} 字符）`
  }
  if (Array.isArray(value)) return value.map(elideBase64)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, elideBase64(item)]))
  }
  return value
}
