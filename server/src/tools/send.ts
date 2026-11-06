/** 按调用记录页导出的请求 JSON 发一次，素材现读现编码，不经 shell。 */

import { DEFAULT_ENV_VAR } from '../endpoint/curl'
import { maskSecret } from '../endpoint/redact'
import type { RenderedRequest } from '../endpoint/render'
import { isBinaryBody, sendRequest } from '../runner/send'

const MAX_PRINT = 4000
const TIMEOUT_MS = 300_000

const path = process.argv[2]
if (path === undefined) {
  console.error(`用法：export ${DEFAULT_ENV_VAR}=… && bun run server/src/tools/send.ts <请求.json>`)
  process.exit(2)
}

const request = (await Bun.file(path).json()) as RenderedRequest
if (typeof request.method !== 'string' || typeof request.url !== 'string') {
  console.error(`${path} 里缺 method 或 url，不像是从调用记录导出的请求`)
  process.exit(2)
}

/** 记录里的凭证是脱敏后的值，用环境变量里的 key 按同样规则脱敏后再替换回去。 */
function fillKey<T>(value: T, masked: string, key: string): T {
  if (typeof value === 'string') return value.split(masked).join(key) as T
  if (Array.isArray(value)) return value.map((item) => fillKey(item, masked, key)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillKey(v, masked, key)])) as T
  }
  return value
}

const key = process.env[DEFAULT_ENV_VAR] ?? ''
const masked = key === '' ? '' : maskSecret(key)
// 脱敏后只剩星号时没法换回去：正文里同样的星号会被一起替换。
const fillable = masked.length > 4
if (key === '') console.error(`没设 ${DEFAULT_ENV_VAR}，凭证还是脱敏后的值，多半回 401`)
else if (!fillable) console.error(`${DEFAULT_ENV_VAR} 太短，脱敏后认不出记录里的凭证，按原样发出，多半回 401`)

const outcome = await sendRequest(fillable ? fillKey(request, masked, key) : request, { timeoutMs: TIMEOUT_MS })
if (outcome.error !== undefined && outcome.statusCode === undefined) {
  console.error(outcome.error)
  process.exit(1)
}

console.error(`${outcome.statusCode} · ${outcome.durationMs}ms`)
const body = isBinaryBody(outcome.responseBody)
  ? `<${outcome.responseBody.bytes} 字节 ${outcome.responseBody.contentType ?? '未知类型'}>`
  : typeof outcome.responseBody === 'string'
    ? outcome.responseBody
    : JSON.stringify(outcome.responseBody, null, 2)
console.log(body.length > MAX_PRINT ? `${body.slice(0, MAX_PRINT)}\n…（还有 ${body.length - MAX_PRINT} 字符）` : body)
