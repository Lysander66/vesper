/** 计算一镜会发出的请求内容，发起与预览共用。只读库。 */

import type { Database } from 'bun:sqlite'

import { CAMERA_MOVE_LABEL, SHOT_SIZE_LABEL, type AssetFileRole, type AudioMode, type ContinuityMode, type EndpointCapabilities, type Utterance } from '@vesper/shared'

import { snapDuration } from './gen'
import { durationArgs } from '../local/ffmpeg'
import { clipPrompt, CREATURE_DUTY, firstFramePrompt, h3ClipPrompt, LOOK_DUTY, REF_KINDS, type ClipInput, type FirstFrameInput, type FirstFrameRef, type PromptArgs } from './prompts'
import { soleSpeaker, speakersOf } from '../domain/beats'
import { continuesPrevious } from '../domain/continuity'
import { anchorText, characterIn, characterOf, getAssetVersion, latestVersionOf, listAssets, referenceImages, roleOfImage, type LockedVersion } from '../repo/assets'
import { getEpisode } from '../repo/projects'
import { Conflict } from '../domain/errors'
import {
  castOf,
  currentArtifacts,
  previousShot,
  propsOf,
  sceneRefOf,
  utterancesOf,
  type ShotRow,
} from '../repo/shots'

/** 参考图清单与实际挂的图从同一份列表派生，序号才对得上。 */
export interface RefSlot {
  readonly image: string
  readonly note: FirstFrameRef
}

export function labelOf(slot: RefSlot): string {
  return slot.note.name === '' ? slot.note.kind : slot.note.name
}

export interface FirstFrameContext {
  readonly style: string
  /** 上一镜末帧图的路径，不接上一镜时为 null。 */
  readonly tail: string | null
  /** 端点没声明时不限。 */
  readonly maxRefs?: number | undefined
  readonly args?: PromptArgs | undefined
}

export interface FirstFramePlan {
  readonly prompt: string
  readonly input: FirstFrameInput
  readonly kept: readonly RefSlot[]
  /** 超出端点上限挂不上的。 */
  readonly dropped: readonly RefSlot[]
  readonly limit: number
  readonly chained: boolean
}

export function planFirstFrame(db: Database, shot: ShotRow, context: FirstFrameContext): FirstFramePlan {
  const wanted = orderedRefs(db, shot, context.tail)
  const limit = context.maxRefs ?? wanted.length
  const kept = wanted.slice(0, limit)
  // 末帧被截掉时，提示词里也不能再说接上一镜。
  const chained = kept.some((slot) => slot.image === context.tail)

  const input: FirstFrameInput = {
    style: context.style,
    scene: shot.scene,
    shotSize: SHOT_SIZE_LABEL[shot.shot_size],
    camera: shot.camera,
    imagePrompt: shot.image_prompt,
    refs: kept.map((slot) => slot.note),
    continues: chained,
  }
  return {
    prompt: firstFramePrompt(input, context.args ?? {}),
    input,
    kept,
    dropped: wanted.slice(limit),
    limit,
    chained,
  }
}

/** 首帧提示词里没写到的出场人物。首帧模式的视频只带首帧，这些人的长相由视频模型自己编。 */
export function offFrameCast(db: Database, shot: ShotRow): string[] {
  if (shot.clip_source !== 'first_frame') return []
  return personsIn(db, shot).filter((name) => !shot.image_prompt.includes(name))
}

/** 本镜出场的人，换装用本体的名字。 */
export function personsIn(db: Database, shot: ShotRow): string[] {
  return castOf(shot).map((m) => getAssetVersion(db, m.version_id).person)
}

/** 按重要度排，超额时从末尾截。接上一镜末帧时场景图排最后，末帧里已有场景。 */
function orderedRefs(db: Database, shot: ShotRow, tail: string | null): RefSlot[] {
  const scene = sceneRefOf(shot)
  const cast = castOf(shot).map((m) => ({ version: getAssetVersion(db, m.version_id), look: m.look }))
  // 主角在前；sort 是稳定排序，同类保持分镜里的顺序。
  cast.sort((a, b) => Number(characterIn(b.version).tier === 'lead') - Number(characterIn(a.version).tier === 'lead'))

  const props = propsOf(shot).map((p) => ({ version: getAssetVersion(db, p.version_id) }))
  const sceneSlots = scene ? fromVersions([{ version: getAssetVersion(db, scene.version_id) }]) : []
  const body = fromVersions([...cast, ...props])

  if (tail === null) return [...sceneSlots, ...body]
  return [
    { image: tail, note: { kind: '上一镜的末帧', name: '', anchor: '这一镜紧接着它发生' } },
    ...body,
    ...sceneSlots,
  ]
}

/** 锁定版里没有可作参考的图就不占参考图名额。 */
function fromVersions(picks: readonly { version: LockedVersion; look?: AssetFileRole | undefined }[]): RefSlot[] {
  return picks.flatMap(({ version, look }) => {
    const image = referenceImages(version, 1, look)[0]
    if (image === undefined) return []
    const kind = REF_KINDS[version.category as keyof typeof REF_KINDS]
    const role = roleOfImage(version, image)
    const duties = version.category === 'character' && characterIn(version).form === 'creature' ? CREATURE_DUTY : LOOK_DUTY
    const note = {
      kind: kind?.label ?? '参考',
      name: version.person,
      anchor: anchorText(version),
      // 职责按实际挑中的设定图类型说明，服装图不能当长相参考。
      duty: (role !== undefined ? duties[role] : undefined) ?? kind?.duty,
    }
    return [{ image, note }]
  })
}

export interface ClipContext {
  readonly audio: AudioMode
  /** 端点未配置时为 null，此时不填时长。 */
  readonly capabilities: EndpointCapabilities | null
  readonly args?: PromptArgs | undefined
  /** 参考图模式才有，上限取视频端点的。 */
  readonly reference?: Omit<FirstFrameContext, 'args'> | undefined
  /** 音频时长（秒），读不出为 null。缺省用 ffprobe。 */
  readonly measure?: ((path: string) => number | null) | undefined
}

export interface VoiceSlot {
  readonly name: string
  readonly path: string
  /** 实际发出的秒数，样本超出分到的时长时只取前段。 */
  readonly seconds: number
  readonly trimmed: boolean
}

export interface VoiceMiss {
  readonly name: string
  readonly reason: string
}

export interface ClipPlan {
  readonly prompt: string
  /** 参考图模式挂的图，首帧模式为空。 */
  readonly kept: readonly RefSlot[]
  readonly dropped: readonly RefSlot[]
  readonly limit: number
  /** 取到端点档位后的时长，端点不接受时长时为 undefined。 */
  readonly duration: number | undefined
  /** 没有已锁定同名角色的说话人，用默认音色。 */
  readonly unregisteredSpeakers: readonly string[]
  /** 顺序即 `<Audio N>`。 */
  readonly voices: readonly VoiceSlot[]
  readonly voiceMisses: readonly VoiceMiss[]
}

/** MiniMax H3 对参考音频的时长限制。 */
const SAMPLE_SECONDS = { min: 2, total: 15 }

export function planClip(db: Database, shot: ShotRow, context: ClipContext): ClipPlan {
  const speech = speechFor(db, shot, context.audio)
  // 提示词里写的秒数与实际发送的时长一致。
  const duration = context.capabilities === null ? undefined : snapDuration(context.capabilities, shot.seconds)
  const opening = context.reference === undefined ? undefined : planFirstFrame(db, shot, context.reference)
  const samples =
    opening === undefined || speech.input.speech === undefined
      ? { kept: [], missed: [] }
      : pickSamples(db, shot, speech.input.speech.lines, opening.kept, context.capabilities?.max_reference_audios ?? 0, context.measure ?? probeSeconds)
  const compose = context.capabilities?.prompt_style === 'h3' ? h3ClipPrompt : clipPrompt
  return {
    prompt: compose(
      {
        motionPrompt: shot.motion_prompt,
        summary: shot.summary,
        // 固定镜头已写在 motion_prompt 里。
        cameraMove: shot.camera_move === 'static' ? undefined : CAMERA_MOVE_LABEL[shot.camera_move],
        scene: shot.scene,
        castNames: personsIn(db, shot),
        seconds: duration ?? shot.seconds,
        sound: context.audio === 'native' ? shot.sound : undefined,
        opening: opening?.input,
        speech: speech.input.speech === undefined ? undefined : { ...speech.input.speech, samples: samples.kept.map((v) => v.name) },
      },
      context.args ?? {},
    ),
    kept: opening?.kept ?? [],
    dropped: opening?.dropped ?? [],
    limit: opening?.limit ?? 0,
    duration,
    unregisteredSpeakers: speech.unregistered,
    voices: samples.kept,
    voiceMisses: samples.missed,
  }
}

/** 按开口顺序挑在画面里且锁定版有音色样本的说话人，画外音不带。总时长按人数均分，超出的截前段。 */
function pickSamples(db: Database, shot: ShotRow, lines: readonly Utterance[], kept: readonly RefSlot[], limit: number, measure: (path: string) => number | null): { kept: VoiceSlot[]; missed: VoiceMiss[] } {
  const eligible: { name: string; path: string; seconds: number }[] = []
  const missed: VoiceMiss[] = []
  if (limit === 0) return { kept: [], missed }
  const cast = personsIn(db, shot)
  for (const name of speakersOf(lines)) {
    if (!cast.includes(name) || !kept.some((slot) => slot.note.name === name)) continue
    const path = speakerVoice(db, shot, name).sample
    if (path === null) continue
    const seconds = measure(path)
    if (seconds === null) missed.push({ name, reason: '读不出样本时长' })
    else if (seconds < SAMPLE_SECONDS.min) missed.push({ name, reason: `样本 ${seconds.toFixed(1)} 秒，短于 ${SAMPLE_SECONDS.min} 秒` })
    else if (eligible.length >= limit) missed.push({ name, reason: `接口最多接受 ${limit} 段` })
    else eligible.push({ name, path, seconds })
  }
  const share = Math.floor((SAMPLE_SECONDS.total / Math.max(eligible.length, 1)) * 10) / 10
  const out = eligible.flatMap((v): VoiceSlot[] => {
    if (share < SAMPLE_SECONDS.min) {
      missed.push({ name: v.name, reason: `${eligible.length} 人均分 ${SAMPLE_SECONDS.total} 秒，每人不足 ${SAMPLE_SECONDS.min} 秒` })
      return []
    }
    return [{ name: v.name, path: v.path, seconds: Math.min(v.seconds, share), trimmed: v.seconds > share }]
  })
  return { kept: out, missed }
}

function probeSeconds(path: string): number | null {
  const proc = Bun.spawnSync(durationArgs(path), { stdout: 'pipe', stderr: 'pipe' })
  const seconds = Number.parseFloat(proc.stdout.toString())
  return proc.exitCode === 0 && Number.isFinite(seconds) ? seconds : null
}

/** 只在视频自带声音时给，不限说话人数。 */
function speechFor(db: Database, shot: ShotRow, audio: AudioMode): { input: Pick<ClipInput, 'speech'>; unregistered: string[] } {
  if (audio !== 'native') return { input: {}, unregistered: [] }
  const lines = utterancesOf(shot).filter((line) => line.text.trim() !== '')
  if (lines.length === 0) return { input: {}, unregistered: [] }

  const voices: Record<string, string> = {}
  const unregistered: string[] = []
  for (const name of speakersOf(lines)) {
    const found = speakerVoice(db, shot, name)
    if (!found.registered) unregistered.push(name)
    if (found.voice.trim() !== '') voices[name] = found.voice
  }
  return { input: { speech: { lines, voices, unregistered } }, unregistered }
}

export function soleSpeakerOf(shot: ShotRow, utterances: readonly Utterance[]): string | null | undefined {
  try {
    return soleSpeaker(utterances)
  } catch (error) {
    throw new Conflict(`第 ${shot.idx + 1} 镜：${(error as Error).message}`)
  }
}

/** 按名字取说话人的音色描述与样本：先找本镜出镜角色，再找作品里已锁定的角色（含别名）。 */
export function speakerVoice(db: Database, shot: ShotRow, speaker: string): { voice: string; sample: string | null; registered: boolean } {
  const member = castOf(shot).find((m) => getAssetVersion(db, m.version_id).person === speaker)
  if (member) return { ...versionVoice(getAssetVersion(db, member.version_id)), registered: true }
  const projectId = getEpisode(db, shot.episode_id).project_id
  for (const asset of listAssets(db, projectId, 'character')) {
    if (asset.name !== speaker && !characterOf(asset).aliases.includes(speaker)) continue
    const locked = latestVersionOf(db, asset.id)
    if (locked !== null) return { ...versionVoice(getAssetVersion(db, locked.id)), registered: true }
  }
  return { voice: '', sample: null, registered: false }
}

/** 快照里同一类型新的在前，第一条即选定的样本。 */
function versionVoice(version: LockedVersion): { voice: string; sample: string | null } {
  return { voice: characterIn(version).voice, sample: version.files.find((f) => f.role === 'voice_sample')?.path ?? null }
}

/** 要接末帧的上一镜，不接时为 null。 */
export function chainsFrom(db: Database, shot: ShotRow, continuity: ContinuityMode): ShotRow | null {
  const previous = previousShot(db, shot)
  if (previous === null) return null
  const scene = sceneRefOf(shot)?.version_id ?? null
  return continuesPrevious(continuity, shot.join_mode, sceneRefOf(previous)?.version_id ?? null, scene) ? previous : null
}

export function clipOf(db: Database, shotId: string): string | null {
  return currentArtifacts(db, { kind: 'shot', id: shotId }).find((a) => a.kind === 'clip')?.path ?? null
}

/** 末帧图路径。视频文件名含 jobId，重新生成后末帧也随之换新。 */
export function tailPath(clip: string): string {
  return `${clip}.tail.jpg`
}
