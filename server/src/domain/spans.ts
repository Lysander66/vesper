/** 检查一份原文的分集区间是否连续盖满全文。纯函数。 */

export interface Span {
  /** 报错时怎么称呼这一段，通常是「第 N 集」。 */
  readonly label: string
  readonly start: number
  readonly end: number
}

/** 有缺口或重叠时回报错文案，盖满回 null。 */
export function checkFileSpans(length: number, spans: readonly Span[]): string | null {
  let cursor = 0
  for (const span of spans) {
    if (span.end <= span.start) return `${span.label}区间为空`
    if (span.end > length) return `${span.label}终点 ${span.end} 超出这份原文的 ${length} 字`
    if (span.start !== cursor) {
      return cursor === 0
        ? `${span.label}起点 ${span.start} 不是 0，开头 ${span.start} 字没有归属`
        : `${span.label}起点 ${span.start} 与上一集终点 ${cursor} 不衔接`
    }
    cursor = span.end
  }
  if (cursor !== length) return `分集只覆盖了这份原文前 ${cursor} 字，全文共 ${length} 字`
  return null
}
