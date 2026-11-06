/** 按末句锚点把原文切成连续区间。纯函数。 */

/** 值必须是单字符，折叠副本与原文逐字符等长，下标才对得上。 */
const PUNCT_FOLD: Readonly<Record<string, string>> = {
  '。': '.',
  '．': '.',
  '，': ',',
  '！': '!',
  '？': '?',
  '：': ':',
  '；': ';',
  '（': '(',
  '）': ')',
  '～': '~',
  '〜': '~',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '＂': '"',
  '＇': "'",
}

for (const [src, dst] of Object.entries(PUNCT_FOLD)) {
  if ([...dst].length !== 1) throw new Error(`折叠表的值必须是单字符：${src} → ${dst}`)
}

/** 匹配用的折叠副本：全角标点转半角、每个空白字符转成空格。只容忍这两类差异，改了字就匹配不上。 */
export function foldForMatch(text: string): string {
  let out = ''
  for (const ch of text) {
    const folded = PUNCT_FOLD[ch]
    if (folded !== undefined) out += folded
    else if (/\s/u.test(ch)) out += ' '
    else out += ch
  }
  return out
}

/** needle 的全部起点，允许重叠。 */
function findAll(haystack: string, needle: string): number[] {
  if (needle === '') return []
  const starts: number[] = []
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    starts.push(at)
    at = haystack.indexOf(needle, at + 1)
  }
  return starts
}

export interface AnchorSpan {
  readonly start: number
  readonly end: number
}

export type AnchorResult =
  /** 最后一集末句在原文里的位置。末段总会补齐到文末，回复是否写全要看它。 */
  | { readonly ok: true; readonly spans: AnchorSpan[]; readonly reached: number }
  | { readonly ok: false; readonly reasons: string[] }

/** 末句 → 区间，连续且盖满原文。校验失败时一次返回全部原因。 */
export function locateAnchors(source: string, endings: readonly string[]): AnchorResult {
  const reasons: string[] = []
  const spans: AnchorSpan[] = []
  let cursor = 0
  let reached = 0
  let folded: string | null = null

  for (const [i, ending] of endings.entries()) {
    const label = `第 ${i + 1} 集`
    const needle = ending.trim()
    if (needle === '') {
      reasons.push(`${label}的 ends_with 是空的`)
      continue
    }

    let starts = findAll(source, needle)
    if (starts.length === 0) {
      folded ??= foldForMatch(source)
      starts = findAll(folded, foldForMatch(needle))
    }

    if (starts.length === 0) {
      reasons.push(`${label}的 ends_with「${needle}」在原文里不存在，必须逐字抄原文，不能改写或换代词`)
      continue
    }
    if (starts.length > 1) {
      reasons.push(`${label}的 ends_with「${needle}」在原文里出现了 ${starts.length} 次，无法确定切在哪一处，请换一句更独特的`)
      continue
    }

    const at = starts[0]!
    // 最后一段延伸到文末，末尾的文字才有归属。
    const end = i === endings.length - 1 ? source.length : at + needle.length
    if (end <= cursor) {
      reasons.push(`${label}的 ends_with「${needle}」出现在上一集的收尾之前，分集必须按原文顺序排`)
      continue
    }
    spans.push({ start: cursor, end })
    cursor = end
    reached = at + needle.length
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, spans, reached }
}
