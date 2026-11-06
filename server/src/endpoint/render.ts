/** 端点定义渲染成请求。记录、导出与实际发送都经过这里。 */

import { isAssetRef, type AssetRef } from './asset'
import { DROP, isTruthy, lookup, renderValue, type Context, type EnumMaps } from './template'
import type { EndpointDefinition, EndpointSection, SectionName } from './types'

export interface RenderedRequest {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  /** 缺省 `json`。 */
  readonly encoding?: 'json' | 'multipart' | undefined
}

export interface ContextParams {
  api_key: string
  base_url: string
  model?: string
  prompt?: string
  duration?: number
  aspect_ratio?: string
  resolution?: string
  seed?: number | null
  task_id?: string
  result_id?: string
  [key: string]: unknown
}

/** 素材按定义里的输入名归位；多值来源给数组，单值来源给单个引用或 undefined。 */
export type RenderedInputs = Record<string, AssetRef | AssetRef[] | undefined>

export function buildContext(params: ContextParams, inputs: RenderedInputs, defaults?: Record<string, unknown>): Context {
  const ctx: Context = { ...params }
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (ctx[key] === undefined || ctx[key] === null) ctx[key] = value
  }
  ctx.inputs = inputs
  return ctx
}

export function renderRequest(section: EndpointSection, ctx: Context, options: { enumMaps?: EnumMaps; auth?: EndpointDefinition['auth'] } = {}): RenderedRequest {
  const { enumMaps, auth } = options

  const headers: Record<string, string> = {}
  for (const [name, template] of Object.entries({ ...section.headers, ...auth?.headers })) {
    const value = renderValue(template, ctx, enumMaps)
    if (value !== DROP && value !== undefined) headers[name] = String(value)
  }

  const url = renderUrl(section, ctx, enumMaps, auth)

  let body: unknown = null
  if (section.body !== undefined) {
    const rendered = renderValue(section.body, ctx, enumMaps)
    body = rendered === DROP ? null : rendered
  }

  return { method: section.method, url, headers, body, encoding: section.request ?? 'json' }
}

function renderUrl(section: EndpointSection, ctx: Context, enumMaps: EnumMaps, auth: EndpointDefinition['auth']): string {
  const base = renderValue(section.url, ctx, enumMaps)
  if (base === DROP || typeof base !== 'string') {
    throw new Error(`URL 模板渲染后不是字符串：${section.url}`)
  }

  const params = new URLSearchParams()
  for (const [name, template] of Object.entries({ ...section.query, ...auth?.query })) {
    const value = renderValue(template, ctx, enumMaps)
    if (value !== DROP && value !== undefined) params.set(name, String(value))
  }
  if ([...params].length === 0) return base
  return base.includes('?') ? `${base}&${params}` : `${base}?${params}`
}

/** 带图与不带图可能是两条提交路径。返回选中的节，渲染、判完成与取值都用同一节。 */
export function selectSubmit(definition: EndpointDefinition, ctx: Context): EndpointSection {
  const alt = definition.submit_alt
  if (alt && isTruthy(lookup(alt.when, ctx))) return alt
  return definition.submit
}

/** 定义里没有这一节时返回 null。 */
export function renderSection(definition: EndpointDefinition, name: SectionName, ctx: Context): RenderedRequest | null {
  const section = name === 'submit' ? selectSubmit(definition, ctx) : definition[name]
  if (!section) return null
  return renderRequest(section, ctx, { enumMaps: definition.enum_maps, auth: definition.auth })
}

/** multipart 体拆成表单项：数组值展开成同名多项，空值跳过，嵌套对象报错。 */
export function formEntries(body: unknown): [string, AssetRef | string][] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('multipart 请求体必须是一层键值对')
  return Object.entries(body as Record<string, unknown>).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value])
      .filter((item) => item !== undefined && item !== null)
      .map((item): [string, AssetRef | string] => {
        if (isAssetRef(item)) return [key, item]
        if (typeof item === 'object') throw new Error(`multipart 字段 ${key} 的值是嵌套对象，表单没法表达`)
        return [key, String(item)]
      }),
  )
}
