import type { EpisodeSummary, RunStatus, SlotStatus } from '@vesper/shared'

export type Tone = 'ok' | 'warn' | 'stale' | 'fail' | 'idle' | 'busy'

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  stale: 'text-stale',
  fail: 'text-fail',
  idle: 'text-idle',
  busy: 'text-busy',
}

export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  stale: 'bg-stale',
  fail: 'bg-fail',
  idle: 'bg-idle',
  busy: 'bg-busy',
}

export const SLOT_TONE: Record<SlotStatus, Tone> = {
  ready: 'ok',
  stale: 'stale',
  running: 'busy',
  failed: 'fail',
  missing: 'idle',
  skipped: 'idle',
}

export const RUN_TONE: Record<RunStatus, Tone> = {
  running: 'busy',
  succeeded: 'ok',
  failed: 'fail',
  cancelled: 'idle',
  interrupted: 'warn',
}

export const SLOT_LABEL: Record<SlotStatus, string> = {
  ready: '已生成',
  stale: '过时',
  running: '生成中',
  failed: '失败',
  missing: '未生成',
  skipped: '无需生成',
}

/** 侧栏不上红，失败按「待处理」的黄。 */
export function episodeTone(episode: EpisodeSummary): Tone {
  const counts = episode.progress?.counts
  if (counts?.failed) return 'warn'
  if (counts?.running) return 'busy'
  if (episode.film) return episode.film.state === 'stale' ? 'stale' : 'ok'
  if (counts?.stale) return 'stale'
  return 'idle'
}

export function episodeMeta(episode: EpisodeSummary): string {
  if (episode.shots > 0) return `${episode.shots} 镜 · ${episode.progress?.percent ?? 0}%`
  if (episode.beats_count === 0) return '待生成节拍'
  return episode.beats_state === 'confirmed' ? '待拆分镜' : `${episode.beats_count} 拍 · 待确认`
}
