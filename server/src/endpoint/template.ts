/** `{{ }}` 模板与 `$when` / `$each`。整串占位符保留原类型，`{"$str": ...}` 转字符串，取不到值的字段删掉。 */

import { isAssetRef } from './asset'

/** 渲染结果里要删掉的位置：对象里删键，数组里删元素。 */
export const DROP = Symbol('drop')

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

export type Context = Record<string, unknown>
export type EnumMaps = Record<string, Record<string, string>> | undefined

const WHOLE_PLACEHOLDER = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/
const ANY_PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

export function lookup(path: string, ctx: Context): unknown {
  let cursor: unknown = ctx
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/** 枚举映射按占位符路径整串匹配，映射表里没登记的值原样透传。 */
function applyEnumMap(path: string, value: unknown, enumMaps: EnumMaps): unknown {
  const table = enumMaps?.[path]
  if (!table || typeof value !== 'string') return value
  return table[value] ?? value
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

/** 空数组也算假，参考图列表为空时不带这一块。 */
export function isTruthy(value: unknown): boolean {
  if (isAbsent(value) || value === false || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function renderValue(node: unknown, ctx: Context, enumMaps?: EnumMaps): unknown | typeof DROP {
  if (typeof node === 'string') return renderString(node, ctx, enumMaps)
  if (Array.isArray(node)) return renderArray(node, ctx, enumMaps)
  if (node !== null && typeof node === 'object') return renderObject(node as Record<string, unknown>, ctx, enumMaps)
  return node
}

function renderString(node: string, ctx: Context, enumMaps: EnumMaps): unknown | typeof DROP {
  const whole = WHOLE_PLACEHOLDER.exec(node)
  if (whole) {
    const path = whole[1] as string
    const raw = applyEnumMap(path, lookup(path, ctx), enumMaps)
    return isAbsent(raw) ? DROP : raw
  }

  let missing = false
  const interpolated = node.replace(ANY_PLACEHOLDER, (_match, path: string) => {
    const raw = applyEnumMap(path, lookup(path, ctx), enumMaps)
    if (isAbsent(raw)) {
      missing = true
      return ''
    }
    // 素材不能参与字符串插值，否则 base64 会写进记录与导出。
    if (isAssetRef(raw)) {
      throw new TemplateError(`占位符 {{ ${path} }} 是素材，只能整串引用，不能嵌在文字里`)
    }
    return String(raw)
  })
  return missing ? DROP : interpolated
}

function renderArray(node: unknown[], ctx: Context, enumMaps: EnumMaps): unknown[] {
  const out: unknown[] = []
  for (const item of node) {
    const expanded = tryExpandEach(item, ctx, enumMaps)
    if (expanded) {
      out.push(...expanded)
      continue
    }
    const rendered = renderValue(item, ctx, enumMaps)
    if (rendered !== DROP) out.push(rendered)
  }
  return out
}

function renderObject(node: Record<string, unknown>, ctx: Context, enumMaps: EnumMaps): unknown | typeof DROP {
  if ('$when' in node) {
    const guard = node.$when
    if (typeof guard !== 'string') throw new TemplateError('$when 的值必须是一个路径字符串')
    if (!isTruthy(lookup(guard, ctx))) return DROP
  }

  if ('$str' in node) {
    const rendered = renderValue(node.$str, ctx, enumMaps)
    if (rendered === DROP) return DROP
    if (isAssetRef(rendered)) throw new TemplateError('$str 里不能放素材，素材只能整串引用')
    return String(rendered)
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === '$when') continue
    const rendered = renderValue(value, ctx, enumMaps)
    if (rendered !== DROP) out[key] = rendered
  }
  return out
}

/** 展开 `{"$each": {"in": "inputs.refs", "as": "ref", "item": {...}}}`，不是 `$each` 时回 null。 */
function tryExpandEach(item: unknown, ctx: Context, enumMaps: EnumMaps): unknown[] | null {
  if (item === null || typeof item !== 'object' || !('$each' in item)) return null

  const spec = (item as { $each: unknown }).$each
  if (spec === null || typeof spec !== 'object') throw new TemplateError('$each 的值必须是对象')
  const { in: source, as: binding, item: template } = spec as Record<string, unknown>
  if (typeof source !== 'string' || typeof binding !== 'string') {
    throw new TemplateError('$each 需要 in（路径）与 as（绑定名）两个字符串字段')
  }

  const collection = lookup(source, ctx)
  if (isAbsent(collection)) return []
  if (!Array.isArray(collection)) throw new TemplateError(`$each 的 in 指向 ${source}，但它不是数组`)

  const out: unknown[] = []
  for (const element of collection) {
    const rendered = renderValue(template, { ...ctx, [binding]: element }, enumMaps)
    if (rendered !== DROP) out.push(rendered)
  }
  return out
}
