/** 按语速估算时长，只作参考，不参与自动决策。 */

/** 不计空白。标点按一个字计，近似断句停顿。 */
export function countChars(text: string): number {
  return text.replace(/\s+/gu, '').length
}

export function narratedSeconds(charCount: number, speechRate: number): number {
  if (speechRate <= 0) throw new Error(`语速必须为正：${speechRate}`)
  return charCount / speechRate
}

/** 一组台词念完需要多少秒。句间换气按每句 0.3 秒计。 */
export function speechSeconds(texts: readonly string[], speechRate: number): number {
  const spoken = texts.filter((text) => text.trim() !== '')
  if (spoken.length === 0) return 0
  const chars = spoken.reduce((sum, text) => sum + countChars(text), 0)
  return narratedSeconds(chars, speechRate) + spoken.length * BREATH_SECONDS
}

const BREATH_SECONDS = 0.3

export interface VolumeVerdict {
  readonly charCount: number
  /** 原文逐字念完的秒数，不是目标时长。 */
  readonly narratedSeconds: number
  /** 0 表示不限，合成版长度由节拍数决定。 */
  readonly targetSeconds: number
  readonly message: string
}

export function assessVolume(text: string, speechRate: number, targetSeconds: number): VolumeVerdict {
  if (targetSeconds < 0) throw new Error(`目标时长不能为负：${targetSeconds}`)

  const charCount = countChars(text)
  const seconds = narratedSeconds(charCount, speechRate)
  const volume = `原文 ${charCount} 字，逐字念完约 ${formatDuration(seconds)}`
  const message =
    targetSeconds === 0
      ? `${volume}。未设目标时长，成片长度由节拍数决定。`
      : `${volume}。目标时长 ${targetSeconds} 秒，改编时按它取舍详略。`

  return { charCount, narratedSeconds: seconds, targetSeconds, message }
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`
}
