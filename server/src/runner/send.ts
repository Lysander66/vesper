/** 发出 HTTP 请求。素材只在这里展开成 base64 或字节，记录层拿到的仍是引用。 */

import { basename } from 'node:path'

import { elideBase64 } from '../db/elide'
import { isAssetRef, materialize, materializeBytes } from '../endpoint/asset'
import { formEntries, type RenderedRequest } from '../endpoint/render'

export interface HttpOutcome {
  readonly statusCode?: number
  readonly responseHeaders?: Record<string, string>
  readonly responseBody?: unknown
  readonly startedAt: Date
  readonly durationMs: number
  readonly error?: string
  /** 传输层失败，区别于服务端回了错误码，可以重试。 */
  readonly transport: boolean
}

export function isOk(outcome: HttpOutcome): boolean {
  return outcome.statusCode !== undefined && outcome.statusCode >= 200 && outcome.statusCode < 300
}

/** 素材按原始字节上传，不转 base64。 */
export async function buildFormData(body: unknown): Promise<FormData> {
  const form = new FormData()
  for (const [key, item] of formEntries(body)) {
    if (typeof item === 'string') form.append(key, item)
    else form.append(key, new Blob([await materializeBytes(item)], { type: item.mime }), basename(item.path))
  }
  return form
}

/** 返回新树，不改原树。 */
export async function materializeTree(node: unknown): Promise<unknown> {
  if (isAssetRef(node)) return materialize(node)
  if (Array.isArray(node)) return Promise.all(node.map(materializeTree))
  if (typeof node === 'object' && node !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) out[key] = await materializeTree(value)
    return out
  }
  return node
}

export interface SendOptions {
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
  /** 下载产物时置 true，成功的响应体按字节返回。 */
  readonly binary?: boolean | undefined
}

export interface BinaryBody {
  readonly $binary: true
  readonly bytes: number
  readonly contentType: string | null
  readonly data: Uint8Array
}

export function isBinaryBody(value: unknown): value is BinaryBody {
  return typeof value === 'object' && value !== null && '$binary' in value
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, name) => {
    out[name] = value
  })
  return out
}

function combineSignals(timeoutMs: number | undefined, external: AbortSignal | undefined): AbortSignal | undefined {
  const signals = [timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined, external].filter(
    (s): s is AbortSignal => s !== undefined,
  )
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  return AbortSignal.any(signals)
}

export async function sendRequest(request: RenderedRequest, options: SendOptions = {}): Promise<HttpOutcome> {
  const startedAt = new Date()
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)

  const multipart = request.encoding === 'multipart'
  let payload: string | FormData | undefined
  if (request.body !== null && request.body !== undefined) {
    payload = multipart ? await buildFormData(request.body) : JSON.stringify(await materializeTree(request.body))
  }

  const headers: Record<string, string> = { ...request.headers }
  if (multipart) {
    // 边界串由 fetch 生成，写死的 Content-Type 里没有它。
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-type') delete headers[name]
    }
  } else if (payload !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers,
      body: payload ?? null,
      signal: combineSignals(options.timeoutMs, options.signal) ?? null,
    })
  } catch (cause) {
    const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
    return { startedAt, durationMs: elapsed(), error: message, transport: true }
  }

  const responseHeaders = headersToRecord(response.headers)
  let responseBody: unknown
  try {
    // 失败时响应体是错误信息，仍按文本读。
    if (options.binary && response.ok) {
      const data = new Uint8Array(await response.arrayBuffer())
      responseBody = {
        $binary: true,
        bytes: data.byteLength,
        contentType: response.headers.get('content-type'),
        data,
      } satisfies BinaryBody
    } else {
      const text = await response.text()
      responseBody = text === '' ? null : parseJsonOrText(text)
    }
  } catch (cause) {
    const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
    return {
      statusCode: response.status,
      responseHeaders,
      startedAt,
      durationMs: elapsed(),
      error: `读取响应体失败：${message}`,
      transport: true,
    }
  }

  const outcome: HttpOutcome = {
    statusCode: response.status,
    responseHeaders,
    responseBody,
    startedAt,
    durationMs: elapsed(),
    transport: false,
  }
  return isOk(outcome) ? outcome : { ...outcome, error: `HTTP ${response.status} ${response.statusText}`.trim() }
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** 落库前去掉字节本体，只记大小：产物已经落盘。 */
export function summarizeBody(body: unknown): unknown {
  if (isBinaryBody(body)) return { $binary: true, bytes: body.bytes, content_type: body.contentType }
  return elideBase64(body)
}
