/** 叙事节拍与台词的解析和校验。 */

import { speechSeconds } from './pacing'
import type { Beat, Utterance } from '@vesper/shared'

export function parseBeats(json: string): Beat[] {
  const raw: unknown = JSON.parse(json || '[]')
  if (!Array.isArray(raw)) return []
  return raw.filter(isBeat)
}

function isBeat(value: unknown): value is Beat {
  if (typeof value !== 'object' || value === null) return false
  const beat = value as Record<string, unknown>
  return (
    (beat.mode === 'scene' || beat.mode === 'narration') &&
    typeof beat.summary === 'string' &&
    Array.isArray(beat.utterances) &&
    beat.utterances.every(isUtterance)
  )
}

function isUtterance(value: unknown): value is Utterance {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Record<string, unknown>
  return (line.speaker === null || typeof line.speaker === 'string') && typeof line.text === 'string' && (line.how === undefined || typeof line.how === 'string')
}

export function parseUtterances(json: string): Utterance[] {
  const raw: unknown = JSON.parse(json || '[]')
  if (!Array.isArray(raw)) return []
  return raw.filter(isUtterance)
}

/** 开口的角色，按首次出现排序，不含旁白。 */
export function speakersOf(utterances: readonly Utterance[]): string[] {
  const spoken = utterances.filter((line) => line.text.trim() !== '')
  return [...new Set(spoken.map((line) => line.speaker).filter((name): name is string => !!name))]
}

/** 一镜唯一的说话人，分离配音时用。没有台词回 undefined，只有旁白回 null，多于一人抛错。 */
export function soleSpeaker(utterances: readonly Utterance[]): string | null | undefined {
  const spoken = utterances.filter((line) => line.text.trim() !== '')
  if (spoken.length === 0) return undefined
  const speakers = speakersOf(spoken)
  if (speakers.length > 1) {
    throw new Error(`一镜只能有一个说话人，这一镜有 ${speakers.join('、')}；请把它拆成两镜`)
  }
  return speakers[0] ?? null
}

export function utteranceTexts(utterances: readonly Utterance[]): string[] {
  return utterances.map((line) => line.text).filter((text) => text.trim() !== '')
}

/** 夹到时长区间内。台词念不完时抬高下界，可以超过 max。 */
export function fitSeconds(proposed: number, utterances: readonly Utterance[], speechRate: number, bounds: { min: number; max: number }): number {
  const floor = Math.max(bounds.min, speechSeconds(utteranceTexts(utterances), speechRate))
  const ceiling = Math.max(bounds.max, floor)
  const seconds = Number.isFinite(proposed) && proposed > 0 ? proposed : floor
  return Math.round(Math.min(Math.max(seconds, floor), ceiling) * 10) / 10
}
