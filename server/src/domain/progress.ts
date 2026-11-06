/** 按镜头与产物状态汇总进度。纯函数。 */

import { utteranceTexts } from './beats'
import { SHOT_ARTIFACT_KINDS, type ArtifactKind, type ArtifactState, type Assemblability, type AudioMode, type ClipSource, type JobStatus, type SlotStatus, type Utterance } from '@vesper/shared'

export interface ArtifactView {
  readonly kind: ArtifactKind
  readonly state: ArtifactState
}

export interface ShotView {
  readonly id: string
  readonly utterances: readonly Utterance[]
  readonly seconds: number
  readonly clipSource?: ClipSource | undefined
  readonly artifacts: readonly ArtifactView[]
  /** 各产物位最近一次生成的状态，用于区分未生成与进行中、失败。 */
  readonly jobs?: Readonly<Partial<Record<ArtifactKind, JobStatus>>> | undefined
}

export interface ShotProgress {
  readonly shotId: string
  readonly slots: Readonly<Record<ArtifactKind, SlotStatus>>
  /** 取各产物位中最差的状态。 */
  readonly status: SlotStatus
}

const SEVERITY: Readonly<Record<SlotStatus, number>> = {
  failed: 0,
  missing: 1,
  running: 2,
  stale: 3,
  ready: 4,
  skipped: 5,
}

export function shotProgress(shot: ShotView, audio: AudioMode): ShotProgress {
  const slots = {} as Record<ArtifactKind, SlotStatus>
  for (const kind of SHOT_ARTIFACT_KINDS) {
    slots[kind] = slotStatus(shot, kind, audio)
  }
  const status = SHOT_ARTIFACT_KINDS.map((k) => slots[k]).reduce((worst, s) =>
    SEVERITY[s] < SEVERITY[worst] ? s : worst,
  )
  return { shotId: shot.id, slots, status }
}

function slotStatus(shot: ShotView, kind: ArtifactKind, audio: AudioMode): SlotStatus {
  // 视频自带声音时，配音位不算缺失。
  if (kind === 'voice' && (audio === 'native' || utteranceTexts(shot.utterances).length === 0)) return 'skipped'
  if (kind === 'first_frame' && shot.clipSource === 'reference') return 'skipped'

  const artifact = shot.artifacts.find((a) => a.kind === kind)
  if (artifact) return artifact.state === 'stale' ? 'stale' : 'ready'

  switch (shot.jobs?.[kind]) {
    case 'queued':
    case 'running':
      return 'running'
    case 'failed':
    case 'cancelled':
      return 'failed'
    default:
      return 'missing'
  }
}

export interface EpisodeProgress {
  readonly shots: readonly ShotProgress[]
  readonly counts: Readonly<Record<SlotStatus, number>>
  /** 已就绪的产物位 / 需要的产物位，0–100 整数。skipped 不计入分母。 */
  readonly percent: number
  readonly assemblable: Assemblability
  /** 分镜声明时长之和。 */
  readonly totalSeconds: number
}

export function episodeProgress(shots: readonly ShotView[], audio: AudioMode): EpisodeProgress {
  const progress = shots.map((shot) => shotProgress(shot, audio))

  const counts = Object.fromEntries(Object.keys(SEVERITY).map((k) => [k, 0])) as Record<SlotStatus, number>
  let needed = 0
  let ready = 0
  for (const shot of progress) {
    for (const kind of SHOT_ARTIFACT_KINDS) {
      const status = shot.slots[kind]
      counts[status] += 1
      if (status === 'skipped') continue
      needed += 1
      if (status === 'ready') ready += 1
    }
  }

  return {
    shots: progress,
    counts,
    percent: needed === 0 ? 0 : Math.round((ready / needed) * 100),
    assemblable: assemblability(progress),
    totalSeconds: shots.reduce((sum, s) => sum + s.seconds, 0),
  }
}

/** 合成只看视频与配音，首帧过时不影响合成。 */
const ASSEMBLE_INPUTS: readonly ArtifactKind[] = ['clip', 'voice']

function assemblability(shots: readonly ShotProgress[]): Assemblability {
  if (shots.length === 0) return 'blocked'

  let stale = false
  for (const shot of shots) {
    for (const kind of ASSEMBLE_INPUTS) {
      const status = shot.slots[kind]
      if (status === 'skipped' || status === 'ready') continue
      if (status === 'stale') {
        stale = true
        continue
      }
      return 'blocked'
    }
  }
  return stale ? 'needs_confirm' : 'ready'
}

export function overallPercent(episodes: readonly EpisodeProgress[]): number {
  if (episodes.length === 0) return 0
  return Math.round(episodes.reduce((sum, e) => sum + e.percent, 0) / episodes.length)
}
