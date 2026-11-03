/** JSONPath 的子集，只够从响应里取值，不支持过滤器与表达式。 */

export class JsonPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonPathError'
  }
}

type Step = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'wildcard' }

const STEP = /^(?:\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[\*\]|\[(['"])(.*?)\3\])/

function parse(path: string): Step[] {
  if (!path.startsWith('$')) throw new JsonPathError(`路径必须以 $ 开头：${path}`)
  let rest = path.slice(1)
  const steps: Step[] = []
  while (rest.length > 0) {
    const match = STEP.exec(rest)
    if (!match) throw new JsonPathError(`无法解析的路径片段：${path} 于 "${rest}"`)
    const [consumed, dotKey, index, , quotedKey] = match
    if (dotKey !== undefined) steps.push({ kind: 'key', key: dotKey })
    else if (index !== undefined) steps.push({ kind: 'index', index: Number(index) })
    else if (quotedKey !== undefined) steps.push({ kind: 'key', key: quotedKey })
    else steps.push({ kind: 'wildcard' })
    rest = rest.slice(consumed.length)
  }
  return steps
}

/** 含 `[*]` 时可能匹配多个值，按文档顺序返回。 */
export function query(root: unknown, path: string): unknown[] {
  let cursor: unknown[] = [root]
  for (const step of parse(path)) {
    const next: unknown[] = []
    for (const node of cursor) {
      if (node === null || node === undefined) continue
      if (step.kind === 'key') {
        if (typeof node === 'object' && !Array.isArray(node)) {
          const value = (node as Record<string, unknown>)[step.key]
          if (value !== undefined) next.push(value)
        }
      } else if (step.kind === 'index') {
        if (Array.isArray(node) && step.index < node.length) next.push(node[step.index])
      } else if (Array.isArray(node)) {
        next.push(...node)
      }
    }
    cursor = next
    if (cursor.length === 0) break
  }
  return cursor
}

/** 按候选顺序取第一个非空值：同一家的成功、排队与错误响应常把同一条信息放在不同路径上。 */
export function extractFirst(root: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    for (const hit of query(root, path)) {
      if (hit !== null && hit !== undefined && hit !== '') return hit
    }
  }
  return undefined
}

/** 取不到的字段不出现在结果里。 */
export function extractAll(root: unknown, declaration: Record<string, string[]> | undefined): Record<string, unknown> {
  if (!declaration) return {}
  const out: Record<string, unknown> = {}
  for (const [field, paths] of Object.entries(declaration)) {
    const value = extractFirst(root, paths)
    if (value !== undefined) out[field] = value
  }
  return out
}
