/** 生成一镜的首帧、视频与配音。请求内容由 preview 计算，这里负责发送与落库。 */

import type { ArtifactKind, AudioMode, ContinuityMode } from '@vesper/shared'

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assetRefFromFile, type AssetRef } from '../endpoint/asset'
import { polishShot } from './polish'
import { buildContext, renderSection, type RenderedInputs } from '../endpoint/render'
import { assertContainsAsset } from '../endpoint/verify'
import { stampInputs } from '../runner/execute'
import { runCommand } from '../local/command'
import { compactImageArgs, tailFrameArgs, trimAudioArgs } from '../local/ffmpeg'
import { argsFor, generate, projectStyle, roleCapabilities, roleDefinition, type GenContext } from './gen'
import {
  chainsFrom,
  clipOf,
  labelOf,
  offFrameCast,
  planClip,
  planFirstFrame,
  soleSpeakerOf,
  tailPath,
  type RefSlot,
  type VoiceSlot,
  speakerVoice,
} from './preview'
import { resolveAudioMode } from '../domain/audio'
import { assertRefsLocked } from '../service/assets'
import { Conflict } from '../domain/errors'
import { appendEvent } from '../repo/runs'
import { currentArtifacts, getShot, insertArtifact, refsOf, utterancesOf, type ShotRow } from '../repo/shots'
import { utteranceTexts } from '../domain/beats'
import { impactOfShotFields } from '../domain/stale'

export interface ProduceResult {
  readonly kind: ArtifactKind
  readonly path: string | null
  readonly jobId: string | null
  /** 跳过的原因，如无台词的镜头不配音。 */
  readonly skipped: string | null
}

async function produceFirstFrame(ctx: GenContext, shot: ShotRow, audio: AudioMode, continuity: ContinuityMode): Promise<ProduceResult> {
  // 提示词为空时端点不报错，会自由发挥。
  if (shot.image_prompt.trim() === '') throw new Conflict('本镜还没有首帧提示词，先写提示词再出图')
  assertRefsLocked(ctx.db, refsOf(shot))

  const tail = await tailFrameFor(ctx, shot, continuity)
  const plan = planFirstFrame(ctx.db, shot, {
    style: projectStyle(ctx),
    tail,
    maxRefs: roleCapabilities(ctx, 'image').max_reference_images,
    args: argsFor(ctx, 'first_frame'),
  })
  noteDropped(ctx, shot, plan)
  const absent = offFrameCast(ctx.db, shot)
  if (absent.length > 0) {
    appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', shot_id: shot.id, message: `第 ${shot.idx + 1} 镜首帧提示词里没有${absent.join('、')}，视频里的长相会与设定图不符` })
  }

  const refs = await toRefs(plan.kept.map((k) => compactImage(k.image)))
  const result = await generate(ctx, {
    owner: { kind: 'shot', id: shot.id },
    purpose: 'first_frame',
    label: `第 ${shot.idx + 1} 镜首帧`,
    role: 'image',
    params: { prompt: plan.prompt },
    inputs: refs.length > 0 ? { reference_images: refs } : {},
  })

  const path = result.outcome.artifacts[0]
  if (path === undefined) throw new Conflict('首帧任务成功但没有产出图像文件')
  land(ctx, shot, 'first_frame', { path, jobId: result.jobId }, audio)
  return { kind: 'first_frame', path, jobId: result.jobId, skipped: null }
}

async function produceClip(ctx: GenContext, shot: ShotRow, audio: AudioMode, continuity: ContinuityMode): Promise<ProduceResult> {
  if (shot.motion_prompt.trim() === '') throw new Conflict('本镜还没有运动提示词，先写提示词再生成视频')

  const definition = roleDefinition(ctx, 'video')
  const capabilities = roleCapabilities(ctx, 'video')
  const byReference = shot.clip_source === 'reference'
  const reference =
    byReference
      ? { style: projectStyle(ctx), tail: await tailFrameFor(ctx, shot, continuity), maxRefs: capabilities.max_reference_images }
      : undefined
  const plan = planClip(ctx.db, shot, { audio, capabilities, args: argsFor(ctx, 'clip'), reference })
  for (const speaker of plan.unregisteredSpeakers) noteDefaultVoice(ctx, shot, speaker)

  // 截出来的音色样本只在这次请求里用。
  const scratch: string[] = []
  try {
    let inputs: RenderedInputs
    // 参考图模式下没有图就是文生视频，允许。
    let anchor: { path: string; what: string } | null
    if (byReference) {
      assertRefsLocked(ctx.db, refsOf(shot))
      noteDropped(ctx, shot, plan)
      for (const miss of plan.voiceMisses) appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', shot_id: shot.id, message: `第 ${shot.idx + 1} 镜「${miss.name}」的试音没带上：${miss.reason}` })
      const images = plan.kept.map((k) => compactImage(k.image))
      inputs = {
        ...(images.length === 0 ? {} : { reference_images: await toRefs(images) }),
        ...(plan.voices.length === 0 ? {} : { reference_audio_files: await toRefs(plan.voices.map((voice) => trimmedSample(voice, scratch))) }),
      }
      anchor = images[0] === undefined ? null : { path: images[0], what: '参考图' }
    } else {
      const firstFrame = currentArtifacts(ctx.db, { kind: 'shot', id: shot.id }).find((a) => a.kind === 'first_frame')
      if (!firstFrame?.path) throw new Conflict('本镜尚无首帧，请先生成首帧')
      inputs = { start_image: await assetRefFromFile(firstFrame.path) }
      anchor = { path: firstFrame.path, what: '首帧' }
    }
    const params: Record<string, unknown> = {
      prompt: plan.prompt,
      ...(plan.duration === undefined ? {} : { duration: plan.duration }),
    }

    // 按实际会发出的结构渲染一遍，断言首帧或参考图确实在请求体里。凭证用占位值。
    const preview = renderSection(
      definition,
      'submit',
      buildContext({ api_key: 'preflight', base_url: 'https://preflight.invalid', ...params }, stampInputs(inputs, definition), definition.defaults),
    )
    if (anchor !== null) assertContainsAsset(preview?.body, anchor.path, anchor.what)

    const result = await generate(ctx, {
      owner: { kind: 'shot', id: shot.id },
      purpose: 'clip',
      label: `第 ${shot.idx + 1} 镜视频`,
      role: 'video',
      params,
      inputs,
    })

    const path = result.outcome.artifacts[0]
    if (path === undefined) throw new Conflict('视频任务成功但没有产出文件')
    land(ctx, shot, 'clip', { path, jobId: result.jobId }, audio)
    return { kind: 'clip', path, jobId: result.jobId, skipped: null }
  } finally {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
  }
}

async function produceVoice(ctx: GenContext, shot: ShotRow, audio: AudioMode): Promise<ProduceResult> {
  if (audio === 'native') {
    const reason = '无需生成：声音由视频模型一起出'
    appendEvent(ctx.db, ctx.runId, { type: 'skipped', shot_id: shot.id, purpose: 'voice', message: reason })
    return { kind: 'voice', path: null, jobId: null, skipped: reason }
  }

  const utterances = utterancesOf(shot)
  const texts = utteranceTexts(utterances)
  if (texts.length === 0) {
    const reason = '无需生成：这一镜没有台词'
    appendEvent(ctx.db, ctx.runId, { type: 'skipped', shot_id: shot.id, purpose: 'voice', message: reason })
    return { kind: 'voice', path: null, jobId: null, skipped: reason }
  }

  const line = texts.join('\n')
  // 台词可以手工改，这里再校验一次单一说话人。
  const speaker = soleSpeakerOf(shot, utterances)
  const voice = typeof speaker === 'string' ? voiceHintFor(ctx, shot, speaker) : ''

  const result = await generate(ctx, {
    owner: { kind: 'shot', id: shot.id },
    purpose: 'voice',
    label: `第 ${shot.idx + 1} 镜配音`,
    role: 'tts',
    params: voice === '' ? { text: line } : { text: line, voice_hint: voice },
  })

  const path = result.outcome.artifacts[0]
  if (path === undefined) throw new Conflict('配音任务成功但没有产出音频文件')
  land(ctx, shot, 'voice', { path, jobId: result.jobId }, audio)
  return { kind: 'voice', path, jobId: result.jobId, skipped: null }
}

/** 按依赖顺序生成：视频依赖首帧，配音独立。 */
export async function produceShot(ctx: GenContext, shot: ShotRow, kinds: readonly ArtifactKind[], audio: AudioMode, continuity: ContinuityMode): Promise<ProduceResult[]> {
  // 视频端点不出声时改为单独配音，否则合成版没有声音。
  const mode = resolveAudioMode(audio, roleCapabilities(ctx, 'video').audio === 'native')
  if (mode !== audio) {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'warn',
      shot_id: shot.id,
      message: '当前视频模型不自带声音，本次改用单独配音',
    })
  }

  // 提示词在生成这一镜时才写，逐镜推进。
  if (shot.image_prompt.trim() === '' && (kinds.includes('first_frame') || kinds.includes('clip'))) {
    await polishShot(ctx, shot)
    shot = getShot(ctx.db, shot.id)
  }

  const out: ProduceResult[] = []
  if (kinds.includes('first_frame')) out.push(shot.clip_source === 'reference' ? skipFirstFrame(ctx, shot) : await produceFirstFrame(ctx, shot, mode, continuity))
  if (kinds.includes('clip')) out.push(await produceClip(ctx, shot, mode, continuity))
  if (kinds.includes('voice')) out.push(await produceVoice(ctx, shot, mode))
  return out
}

/** 生成期间镜头改过且波及这一件，就按过时落库。 */
function land(ctx: GenContext, shot: ShotRow, kind: ArtifactKind, source: { path: string; jobId: string }, audio: AudioMode): void {
  const now = getShot(ctx.db, shot.id)
  const changed = (Object.keys(shot) as (keyof ShotRow)[]).filter((key) => shot[key] !== now[key])
  const state = impactOfShotFields(changed, audio).includes(kind) ? 'stale' : 'fresh'
  insertArtifact(ctx.db, { kind: 'shot', id: shot.id }, kind, { state, ...source })
}

function skipFirstFrame(ctx: GenContext, shot: ShotRow): ProduceResult {
  const reason = '无需生成：这一镜画面来源是参考图'
  appendEvent(ctx.db, ctx.runId, { type: 'skipped', shot_id: shot.id, purpose: 'first_frame', message: reason })
  return { kind: 'first_frame', path: null, jobId: null, skipped: reason }
}

function noteDropped(ctx: GenContext, shot: ShotRow, plan: { kept: readonly RefSlot[]; dropped: readonly RefSlot[]; limit: number }): void {
  if (plan.dropped.length === 0) return
  appendEvent(ctx.db, ctx.runId, {
    type: 'note',
    level: 'warn',
    message:
      `第 ${shot.idx + 1} 镜有 ${plan.kept.length + plan.dropped.length} 张参考图，接口最多接受 ${plan.limit} 张，` +
      `已丢弃：${plan.dropped.map(labelOf).join('、')}`,
  })
}

/** 取上一镜末帧。取不到只少一张参考图，不中断，但记一条警告。 */
async function tailFrameFor(ctx: GenContext, shot: ShotRow, continuity: ContinuityMode): Promise<string | null> {
  const previous = chainsFrom(ctx.db, shot, continuity)
  if (previous === null) return null

  const note = (message: string) =>
    appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', shot_id: shot.id, message })

  const clip = clipOf(ctx.db, previous.id)
  if (clip === null) {
    note(`第 ${previous.idx + 1} 镜还没有视频，本镜首帧不接末帧`)
    return null
  }

  const output = tailPath(clip)
  if (await Bun.file(output).exists()) return output

  appendEvent(ctx.db, ctx.runId, { type: 'command_started', kind: 'tail_frame', shot_id: shot.id })
  const outcome = await runCommand(ctx.db, {
    owner: { kind: 'shot', id: shot.id },
    kind: 'tail_frame',
    argv: tailFrameArgs(clip, output),
    artifacts: [output],
  })
  appendEvent(ctx.db, ctx.runId, {
    type: 'command_finished',
    command_id: outcome.id,
    exit_code: outcome.exitCode,
    error: outcome.error,
  })

  if (outcome.error) {
    note(`取第 ${previous.idx + 1} 镜末帧失败，本镜首帧不接末帧：${outcome.error}`)
    return null
  }
  return output
}

function voiceHintFor(ctx: GenContext, shot: ShotRow, speaker: string): string {
  const found = speakerVoice(ctx.db, shot, speaker)
  if (!found.registered) noteDefaultVoice(ctx, shot, speaker)
  return found.voice
}

/** 没有锁定角色的说话人用默认音色，同一角色可能换声，所以记一条警告。 */
function noteDefaultVoice(ctx: GenContext, shot: ShotRow, speaker: string): void {
  appendEvent(ctx.db, ctx.runId, {
    type: 'note',
    level: 'warn',
    shot_id: shot.id,
    message: `说话人「${speaker}」没有已锁定的同名角色，配音走默认音色`,
  })
}

async function toRefs(paths: readonly string[]): Promise<AssetRef[]> {
  return Promise.all(paths.map((path) => assetRefFromFile(path)))
}

/** 大于 1 MB 的参考图压成 JPEG 存在原图旁边再发，几张原图一起提交会超时。压缩失败就发原图。 */
function compactImage(path: string): string {
  if (Bun.file(path).size <= 1_000_000) return path
  const output = `${path}.ref.jpg`
  if (existsSync(output)) return output
  const proc = Bun.spawnSync(compactImageArgs(path, output), { stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode === 0) return output
  rmSync(output, { force: true })
  return path
}

/** 样本超出分到的时长时截取前段，截取失败就报错，不带整段发出。 */
function trimmedSample(voice: VoiceSlot, scratch: string[]): string {
  if (!voice.trimmed) return voice.path
  const dir = mkdtempSync(join(tmpdir(), 'vesper-voice-'))
  scratch.push(dir)
  const output = join(dir, 'sample.mp3')
  const proc = Bun.spawnSync(trimAudioArgs(voice.path, voice.seconds, output), { stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) throw new Error(`截取「${voice.name}」的试音失败：${proc.stderr.toString().trim()}`)
  return output
}
