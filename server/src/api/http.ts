/** 响应与错误的统一出口。409 表示当前状态不允许，404 表示对象不存在。 */

import { z } from 'zod'

import { Conflict, NotFound } from '../domain/errors'
import { DefinitionError } from '../endpoint/types'
import { MissingAssetError } from '../endpoint/verify'
import { ReplyError } from '../pipeline/reply'
import { GenFailure } from '../pipeline/gen'

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

export function fail(error: unknown): Response {
  const { status, code } = classify(error)
  const message = error instanceof Error ? error.message : String(error)
  if (status >= 500) console.error('api 未处理异常 %s', message)
  return json({ error: message, code }, status)
}

function classify(error: unknown): { status: number; code: string } {
  if (error instanceof NotFound) return { status: 404, code: 'not_found' }
  if (error instanceof Conflict) return { status: 409, code: 'conflict' }
  if (error instanceof BadRequest) return { status: 400, code: 'bad_request' }
  if (error instanceof DefinitionError) return { status: 400, code: 'bad_definition' }
  if (error instanceof MissingAssetError) return { status: 422, code: 'missing_asset' }
  if (error instanceof ReplyError) return { status: 502, code: 'bad_reply' }
  if (error instanceof GenFailure) return { status: 502, code: 'generation_failed' }
  return { status: 500, code: 'internal' }
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequest'
  }
}

export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new BadRequest('请求体不是合法 JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new BadRequest(result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '))
  }
  return result.data
}

/** 请求体可以不给，给了就必须合法：校验失败按缺省处理会违背人的选择。 */
export async function optionalBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text()
  if (text.trim() === '') {
    const empty = schema.safeParse({})
    if (!empty.success) throw new BadRequest('这个接口的请求体不能省略')
    return empty.data
  }
  return body(new Request(request.url, { method: request.method, body: text }), schema)
}

export function query(request: Request, name: string): string | undefined {
  return new URL(request.url).searchParams.get(name) ?? undefined
}

export type Handler = (request: Request, params: Record<string, string>) => Response | Promise<Response>

/** 类型放这里，避免分组文件与 routes.ts 互相 import。 */
export type Register = (method: string, pattern: string, handler: Handler) => void

export { z }
