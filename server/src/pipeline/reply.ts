/** 解析模型回复里的 JSON，容忍代码围栏与前后多余文字。 */

import { z } from 'zod'

export class ReplyError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message)
    this.name = 'ReplyError'
  }
}

export function parseReply<T>(text: string, schema: z.ZodType<T>, what: string): T {
  const json = extractJson(text)
  if (json === null) throw new ReplyError(`${what}：回复中未找到 JSON：${excerpt(text)}`, text)

  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (cause) {
    throw new ReplyError(`${what}：JSON 解析失败（${(cause as Error).message}）：${excerpt(json)}`, text)
  }

  const result = schema.safeParse(value)
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')
    throw new ReplyError(`${what}：结构不符：${detail}`, text)
  }
  return result.data
}

/** 先去掉代码围栏；没有围栏时取第一个 { 到最后一个 } 之间。 */
function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced?.[1] ?? text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return body.slice(start, end + 1)
}

function excerpt(text: string, limit = 300): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`
}

export { z }
