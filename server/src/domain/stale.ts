/** 过时传播。过时表示产物按旧内容生成，只标记不删除。 */

import { ARTIFACT_KINDS, type ArtifactKind, type AudioMode, type ClipSource } from '@vesper/shared'

/** 视频由首帧生成，合成版由视频与配音合成。 */
const DOWNSTREAM: Readonly<Record<ArtifactKind, readonly ArtifactKind[]>> = {
  first_frame: ['clip'],
  clip: ['film'],
  voice: ['film'],
  film: [],
}

/** kind 下游的全部产物，不含自身。 */
export function downstreamOf(kind: ArtifactKind): ArtifactKind[] {
  const out = new Set<ArtifactKind>()
  const queue = [...DOWNSTREAM[kind]]
  while (queue.length > 0) {
    const next = queue.shift()
    if (!next || out.has(next)) continue
    out.add(next)
    queue.push(...DOWNSTREAM[next])
  }
  return [...out]
}

/** 镜头字段 → 首个受影响的产物。shots 表加字段时要同步登记。 */
const SHOT_FIELD_IMPACT: Readonly<Record<string, ArtifactKind>> = {
  scene: 'first_frame',
  camera: 'first_frame',
  shot_size: 'first_frame',
  // 是否接末帧决定首帧的参考图，接缝转场也随之变化。
  join_mode: 'first_frame',
  image_prompt: 'first_frame',
  // mood 只用于写提示词，改了不使产物过时。
  camera_move: 'clip',
  clip_source: 'clip',
  cast: 'first_frame',
  scene_ref: 'first_frame',
  props: 'first_frame',
  motion_prompt: 'clip',
  utterances: 'voice',
  seconds: 'film',
}

/** 视频自带声音时台词、声音段与秒数都进视频请求，从视频起算过时。 */
const NATIVE_FIELD_IMPACT: Readonly<Record<string, ArtifactKind>> = { ...SHOT_FIELD_IMPACT, utterances: 'clip', seconds: 'clip', sound: 'clip' }

export function impactOfShotFields(fields: Iterable<string>, audio: AudioMode): ArtifactKind[] {
  const impact = audio === 'native' ? NATIVE_FIELD_IMPACT : SHOT_FIELD_IMPACT
  const out = new Set<ArtifactKind>()
  for (const field of fields) {
    const kind = impact[field]
    if (!kind) continue
    out.add(kind)
    for (const down of downstreamOf(kind)) out.add(down)
  }
  return ARTIFACT_KINDS.filter((k) => out.has(k))
}

export interface VersionContent {
  readonly data: object
  readonly files: readonly { readonly role: string; readonly path: string }[]
}

/** 镜头换挂同一资产的另一版后，从哪一件起过时；没有影响回 null。音色样本只在视频自带声音且用参考图模式时发出。 */
export function impactOfVersionSwap(before: VersionContent, after: VersionContent, audio: AudioMode, clipSource: ClipSource): ArtifactKind | null {
  const picture = (version: VersionContent) => JSON.stringify([{ ...version.data, voice: undefined }, version.files.filter((f) => f.role !== 'voice_sample').map((f) => [f.role, f.path])])
  const voice = (version: VersionContent) => String((version.data as { voice?: unknown }).voice ?? '')
  // 快照里同一类型新的在前，第一条是选定的样本。
  const sample = (version: VersionContent) => version.files.find((f) => f.role === 'voice_sample')?.path ?? null
  if (picture(before) !== picture(after)) return 'first_frame'
  const sampleUsed = audio === 'native' && clipSource === 'reference'
  if (voice(before) !== voice(after) || (sampleUsed && sample(before) !== sample(after))) return audio === 'native' ? 'clip' : 'voice'
  return null
}
