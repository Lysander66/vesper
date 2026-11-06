/** 从响应里整理用量，按官方价折成金额。纯函数。 */

import type { Currency, JobStatus, Money, ModelCost, Usage } from '@vesper/shared'

type EndpointKind = 'text' | 'image' | 'video' | 'audio'

type Price =
  | {
      kind: 'tokens'
      currency: Currency
      per_million: { input: number; cache_write_5m: number; cache_write_1h: number; cache_read: number; output: number }
    }
  | { kind: 'image'; currency: Currency; per_million: { text_input: number; image_input: number; image_output: number } }
  | { kind: 'video'; currency: Currency; per_second: Record<string, number>; free_images: number; per_extra_image: number }

/** 官方刊例价，不用渠道价。键是响应或参数里的模型名。 */
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': {
    kind: 'tokens',
    currency: 'USD',
    per_million: { input: 4, cache_write_5m: 5, cache_write_1h: 8, cache_read: 0.2, output: 20 },
  },
  'claude-opus-5': {
    kind: 'tokens',
    currency: 'USD',
    per_million: { input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  },
  'gpt-image-2.5-flare': {
    kind: 'image',
    currency: 'USD',
    per_million: { text_input: 5, image_input: 8, image_output: 30 },
  },
  'MiniMax-H3': {
    kind: 'video',
    currency: 'CNY',
    per_second: { '768P': 0.5, '2K': 0.8 },
    free_images: 5,
    per_extra_image: 0.2,
  },
}

/** `bodies` 是各次往返的响应体，按先后排；响应没回模型名时用 `model`。 */
export function readUsage(kind: EndpointKind, model: string, bodies: readonly unknown[]): Usage | null {
  if (kind === 'text') return readTokens(model, bodies)
  if (kind === 'image') return readImage(model, bodies)
  if (kind === 'video') return readVideo(model, bodies)
  return null
}

/** 价目表里没有这个模型、或视频分辨率没有单价时回 null。 */
export function priceUsage(usage: Usage): Money | null {
  // 响应里的模型名可能带发布日期后缀，如 claude-opus-5-5-20260301。
  const price = PRICES[usage.model] ?? PRICES[usage.model.replace(/-\d{8}$/, '')]
  if (!price || price.kind !== usage.kind) return null

  if (price.kind === 'tokens' && usage.kind === 'tokens') {
    const rate = price.per_million
    const amount =
      usage.input * rate.input +
      usage.cache_write_5m * rate.cache_write_5m +
      usage.cache_write_1h * rate.cache_write_1h +
      usage.cache_read * rate.cache_read +
      usage.output * rate.output
    return { [price.currency]: amount / 1e6 }
  }

  if (price.kind === 'image' && usage.kind === 'image') {
    const rate = price.per_million
    const amount = usage.text_input * rate.text_input + usage.image_input * rate.image_input + usage.image_output * rate.image_output
    return { [price.currency]: amount / 1e6 }
  }

  if (price.kind === 'video' && usage.kind === 'video') {
    const perSecond = price.per_second[usage.resolution]
    if (perSecond === undefined) return null
    const extraImages = Math.max(0, usage.input_images - price.free_images)
    return { [price.currency]: usage.seconds * perSecond + extraImages * price.per_extra_image }
  }

  return null
}

/** 按模型合计，按金额从高到低，没单价的排最后。金额为零的调用不计次数。 */
export function sumCosts(jobs: readonly { usage: Usage | null; status: JobStatus }[]): ModelCost[] {
  const byModel = new Map<string, ModelCost>()
  for (const { usage, status } of jobs) {
    if (usage === null) continue
    const cost = priceUsage(usage)
    if (cost && Object.values(cost).every((amount) => amount === 0)) continue
    const entry = byModel.get(usage.model) ?? { model: usage.model, money: null, succeeded: 0, failed: 0 }
    if (status === 'succeeded') entry.succeeded++
    else entry.failed++
    if (cost) {
      const money = (entry.money ??= {})
      for (const [currency, amount] of Object.entries(cost) as [Currency, number][]) money[currency] = (money[currency] ?? 0) + amount
    }
    byModel.set(usage.model, entry)
  }
  const total = (entry: ModelCost) => (entry.money ? Object.values(entry.money).reduce((a, b) => a + b, 0) : -1)
  return [...byModel.values()].sort((a, b) => total(b) - total(a))
}

function readTokens(model: string, bodies: readonly unknown[]): Usage | null {
  let found = false
  const usage = { kind: 'tokens' as const, model, input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0 }
  for (const body of bodies) {
    const raw = record(record(body)?.usage)
    if (!raw) continue
    found = true
    usage.model = text(record(body)?.model) ?? usage.model
    usage.input += count(raw.input_tokens)
    usage.output += count(raw.output_tokens)
    usage.cache_read += count(raw.cache_read_input_tokens)
    // 没有按时长拆开的明细时，整笔写入按默认的 5 分钟档算。
    const split = record(raw.cache_creation)
    if (split) {
      usage.cache_write_5m += count(split.ephemeral_5m_input_tokens)
      usage.cache_write_1h += count(split.ephemeral_1h_input_tokens)
    } else {
      usage.cache_write_5m += count(raw.cache_creation_input_tokens)
    }
  }
  return found ? usage : null
}

function readImage(model: string, bodies: readonly unknown[]): Usage | null {
  let found = false
  const usage = { kind: 'image' as const, model, text_input: 0, image_input: 0, image_output: 0 }
  for (const body of bodies) {
    const raw = record(record(body)?.usage)
    if (!raw) continue
    found = true
    usage.model = text(record(body)?.model) ?? usage.model
    const input = record(raw.input_tokens_details)
    usage.text_input += input ? count(input.text_tokens) : count(raw.input_tokens)
    usage.image_input += count(input?.image_tokens)
    const output = record(raw.output_tokens_details)
    usage.image_output += output ? count(output.image_tokens) : count(raw.output_tokens)
  }
  return found ? usage : null
}

/** 每次轮询都回截至当时的用量，只取最后一份。 */
function readVideo(model: string, bodies: readonly unknown[]): Usage | null {
  for (const body of [...bodies].reverse()) {
    const task = record(record(body)?.task)
    const raw = record(task?.usage)
    if (!task || !raw) continue
    return {
      kind: 'video',
      model: text(task.model) ?? model,
      resolution: text(task.resolution) ?? '',
      seconds: count(raw.output_seconds),
      input_images: count(raw.input_image_count),
    }
  }
  return null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
