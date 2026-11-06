/** 写叙事节拍与拆分镜，两步之间要人工确认节拍。分镜按下标引用节拍里的台词。 */

import { ASSET_FILE_ROLES, CAMERA_MOVES, CLIP_SOURCES, SHOT_JOINS, SHOT_SIZES, SHOT_SIZE_LABEL, type AssetCategory, type AssetFileRole, type Beat, type ShotRef, type Utterance } from '@vesper/shared'

import { argsFor, effectiveAudioMode, generateText, maxDuration, roleCapabilities, type GenContext } from './gen'
import { parseReply, z } from './reply'
import { BEATS_SYSTEM, SHOTS_SYSTEM, beatsPrompt, shotsPrompt } from './prompts'
import { locateAnchors } from '../domain/anchor'
import { fitSeconds, overlongShots, parseBeats, soleSpeaker, speakersOf, utteranceTexts } from '../domain/beats'
import { REFERENCE_ROLES, characterIn, dataOf, getAssetVersion, latestVersionOf, listAssets } from '../repo/assets'
import { Conflict } from '../domain/errors'
import { speechSeconds } from '../domain/pacing'
import { episodeTitle, getProject, setEpisodeBeats, shotSecondsOf, type EpisodeRow } from '../repo/projects'
import { appendEvent } from '../repo/runs'
import { replaceShots, type ShotDraft } from '../repo/shots'
import { episodeText } from '../repo/sources'

const beatsSchema = z.object({
  beats: z
    .array(
      z.object({
        mode: z.enum(['scene', 'narration']),
        summary: z.string().default(''),
        ends_with: z.string().default(''),
        utterances: z
          .array(z.object({ speaker: z.string().nullable().default(null), text: z.string() }))
          .default([]),
      }),
    )
    .min(1),
})

/** beatsSchema 的 JSON Schema 版，放进请求的 output_config 约束回复格式。两边同步改。 */
const beatsOutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      beats: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['scene', 'narration'] },
            summary: { type: 'string' },
            ends_with: { type: 'string' },
            utterances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  speaker: { type: ['string', 'null'] },
                  text: { type: 'string' },
                },
                required: ['speaker', 'text'],
                additionalProperties: false,
              },
            },
          },
          required: ['mode', 'summary', 'ends_with', 'utterances'],
          additionalProperties: false,
        },
      },
    },
    required: ['beats'],
    additionalProperties: false,
  },
} as const

/** 枚举字段解析后再归一化，写法不规范不让整批分镜作废。 */
const shotsSchema = z.object({
  shots: z
    .array(
      z.object({
        summary: z.string().default(''),
        scene: z.string().default(''),
        shot_size: z.string().default(''),
        camera: z.string().default(''),
        camera_move: z.string().default(''),
        mood: z.string().default(''),
        join: z.string().default(''),
        clip_source: z.string().default(''),
        utterance_indexes: z.array(z.number().int().nonnegative()).default([]),
        seconds: z.number().positive(),
        cast: z
          .array(z.union([z.string(), z.object({ name: z.string(), look: z.string().default('') })]))
          .default([]),
        scene_ref: z.string().default(''),
        props: z.array(z.string()).default([]),
      }),
    )
    .min(1),
})

/** 忽略大小写、连字符与空格；认不出用默认值并记下。 */
function enumOf<T extends string>(values: readonly T[], raw: string, fallback: T, unknown: Set<string>, field: string): T {
  const key = raw.trim().toLowerCase().replace(/[-\s]+/g, '_')
  const hit = values.find((v) => v === key)
  if (hit !== undefined) return hit
  if (raw.trim() !== '') unknown.add(`${field}=${raw}`)
  return fallback
}

/** 最后一拍的末句落在原文这个比例之前，视为回复没写完。 */
const BEATS_REACH = 0.8

export async function writeBeats(ctx: GenContext, episode: EpisodeRow): Promise<Beat[]> {
  const source = episodeText(ctx.db, episode)
  let attempt = await draftBeats(ctx, episode, source)
  // 只重写一次，仍然偏短就收下并告警，由人决定是否再写。
  if (attempt.short) {
    appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', message: `节拍只写到原文的 ${attempt.short}，重写一次` })
    attempt = await draftBeats(ctx, episode, source)
    if (attempt.short) appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', message: `重写后节拍仍只写到原文的 ${attempt.short}，后半段可能没改编` })
  }

  const { beats, located } = attempt
  // 区间供逐镜写提示词时取原文细节，定位不上只告警。
  if (located.ok) {
    beats.forEach((beat, i) => {
      const span = located.spans[i]
      if (span) Object.assign(beat, { source_start: span.start, source_end: span.end })
    })
  } else {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'warn',
      message: `部分节拍未能在原文中定位，写分镜提示词时将缺少对应原文：${located.reasons.join('；')}`,
    })
  }

  setEpisodeBeats(ctx.db, episode.id, beats)
  return beats
}

/** short 不为空时是节拍写到了原文的百分之几；末句定位不上时不判断。 */
async function draftBeats(ctx: GenContext, episode: EpisodeRow, source: string): Promise<{ beats: Beat[]; located: ReturnType<typeof locateAnchors>; short: string }> {
  const project = getProject(ctx.db, episode.project_id)
  const cast = lockedAssets(ctx, episode.project_id, 'character')

  const { text } = await generateText(ctx, {
    owner: { kind: 'episode', id: episode.id },
    purpose: 'beats',
    label: `第 ${episode.idx + 1} 集节拍`,
    params: {
      system: BEATS_SYSTEM,
      prompt: beatsPrompt(
        {
          title: episodeTitle(episode),
          synopsis: episode.synopsis,
          source,
          targetSeconds: project.target_seconds,
          // 换装不进名单，节拍只关心人物。
          cast: cast.filter((c) => c.baseId === null).map((c) => ({ name: c.name, identity: c.identity })),
        },
        argsFor(ctx, 'beats'),
      ),
      // 模板不引用它的端点渲染时会整键删掉。
      output_config: { format: beatsOutputFormat },
    },
  })

  const reply = parseReply(text, beatsSchema, '叙事节拍')
  const beats: Beat[] = reply.beats.map((beat) => ({
    mode: beat.mode,
    summary: beat.summary,
    utterances: beat.utterances.filter((line) => line.text.trim() !== ''),
  }))
  const located = locateAnchors(source, reply.beats.map((beat) => beat.ends_with))
  const short = located.ok && located.reached < source.length * BEATS_REACH ? `${Math.round((located.reached / source.length) * 100)}%` : ''
  return { beats, located, short }
}

export interface SplitResult {
  readonly shotIds: string[]
  readonly totalSeconds: number
  readonly targetSeconds: number
}

/** 只出镜头结构，提示词留到逐镜生成时写。 */
export async function splitShots(ctx: GenContext, episode: EpisodeRow): Promise<SplitResult> {
  const project = getProject(ctx.db, episode.project_id)
  const beats = parseBeats(episode.beats)
  if (beats.length === 0) throw new Conflict('本集还没有叙事节拍，先生成节拍再拆分镜')
  if (episode.beats_state !== 'confirmed') throw new Conflict('叙事节拍还没确认，确认之后再拆分镜')

  const cast = lockedAssets(ctx, episode.project_id, 'character')
  if (cast.length === 0) throw new Conflict('还没有已锁定的角色，先出设定图并锁定再拆分镜')
  const scenes = lockedAssets(ctx, episode.project_id, 'scene')
  const props = lockedAssets(ctx, episode.project_id, 'prop')

  const bounds = shotSecondsOf(project)
  const limit = speechLimit(ctx, bounds.max)
  assertUtterancesFit(beats, project.speech_rate, limit)
  // 附上每拍对应的原文，拆几镜要看原文里的动作；定位失败的节拍只给梗概。
  const source = episodeText(ctx.db, episode)
  const beatsWithSource = beats.map((beat) => ({
    ...beat,
    source:
      beat.source_start !== undefined && beat.source_end !== undefined
        ? source.slice(beat.source_start, beat.source_end)
        : '',
  }))
  // 按实际声音来源拆：单独配音时一镜只能有一个说话人。
  const audio = effectiveAudioMode(ctx.db, ctx.projectId, project.audio_mode)

  // 一拍一次请求，格式出错只重拆这一拍；每拍带上前一拍的最后一镜衔接。
  const replies: (z.infer<typeof shotsSchema>['shots'][number] & { beat_index: number })[] = []
  for (const [focus, beat] of beatsWithSource.entries()) {
    const last = replies.at(-1)
    const promptFor = (overlong: readonly string[]) => shotsPrompt(
      {
        beats: beatsWithSource,
        cast: cast.map((c) => ({ name: c.name, identity: c.identity, looks: c.looks, outfit: costumed(cast, c) ? c.outfit : '' })),
        sceneNames: scenes.map((s) => s.name),
        propNames: props.map((p) => p.name),
        minSeconds: bounds.min,
        maxSeconds: bounds.max,
        targetSeconds: project.target_seconds,
        // 按时长上下限估算已用秒数，按语速的修正放到最后。
        spentSeconds: replies.reduce((sum, shot) => sum + Math.min(Math.max(shot.seconds, bounds.min), bounds.max), 0),
        audioMode: audio,
        focus,
        previous: last === undefined ? null : { summary: last.summary, shotSize: SHOT_SIZE_LABEL[enumOf(SHOT_SIZES, last.shot_size, 'medium', new Set(), 'shot_size')], camera: last.camera, scene: last.scene_ref },
        overlong,
      },
      argsFor(ctx, 'shots'),
    )
    const overlongOf = (shots: z.infer<typeof shotsSchema>['shots']) =>
      overlongShots(shots.map((shot) => utteranceTexts(shot.utterance_indexes.flatMap((at) => beat.utterances[at] ?? []))), project.speech_rate, limit.seconds)
        .map(({ index, seconds }) => `第 ${index + 1} 镜的台词念完约 ${seconds.toFixed(1)} 秒，${limit.label} ${limit.seconds} 秒`)
    const ask = (prompt: string) => generateText(ctx, {
      owner: { kind: 'episode', id: episode.id },
      purpose: 'shots',
      label: `第 ${episode.idx + 1} 集分镜（节拍 ${focus + 1}）`,
      params: { system: SHOTS_SYSTEM, prompt },
    }).then((result) => result.text)
    const warn = (message: string) => appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', message })
    const reply = await splitBeat(ask, warn, focus, beat.summary, promptFor, overlongOf)
    replies.push(...reply.shots.map((shot) => ({ ...shot, beat_index: focus })))
  }

  const castByName = nameIndex(cast)
  const sceneByName = nameIndex(scenes)
  const propByName = nameIndex(props)

  const unknownCast = new Set<string>()
  const droppedRefs = new Set<string>()
  const unknownValues = new Set<string>()
  const downgraded: string[] = []
  const drafts: ShotDraft[] = replies.map((shot, i) => {
    const utterances = pickUtterances(beats, shot.beat_index, shot.utterance_indexes, i)
    if (audio === 'separate') {
      try {
        soleSpeaker(utterances)
      } catch (error) {
        throw new Conflict(`第 ${i + 1} 镜：${(error as Error).message}`)
      }
    }
    const sceneName = shot.scene_ref.trim()
    const scene = sceneName === '' ? undefined : sceneByName.get(sceneName)
    if (sceneName !== '' && !scene) droppedRefs.add(sceneName)
    const members = shot.cast.flatMap((entry) => {
      const { name, look } = typeof entry === 'string' ? { name: entry, look: '' } : entry
      const member = castByName.get(name.trim())
      if (!member) {
        unknownCast.add(name)
        return []
      }
      // 锁定版里没有这张图就不指定，取图时按固定顺序选。
      const role = enumOf(ASSET_FILE_ROLES, look, 'full_body', unknownValues, `look(${name})`)
      return [member.looks.includes(role) ? { ...toRef(member), look: role } : toRef(member)]
    })
    // 空镜或换场景时接末帧会把上一镜的人或地方带进来，改为硬切。
    let join = enumOf(SHOT_JOINS, shot.join, 'cut', unknownValues, 'join')
    const previousScene = replies[i - 1]?.scene_ref.trim() ?? ''
    if (join === 'continue' && (i === 0 || members.length === 0 || sceneName === '' || sceneName !== previousScene)) {
      downgraded.push(`第 ${i + 1} 镜`)
      join = 'cut'
    }
    return {
      summary: shot.summary,
      scene: shot.scene,
      camera: shot.camera,
      shotSize: enumOf(SHOT_SIZES, shot.shot_size, 'medium', unknownValues, 'shot_size'),
      cameraMove: enumOf(CAMERA_MOVES, shot.camera_move, 'static', unknownValues, 'camera_move'),
      mood: shot.mood.trim(),
      joinMode: join,
      clipSource: enumOf(CLIP_SOURCES, shot.clip_source, 'first_frame', unknownValues, 'clip_source'),
      imagePrompt: '',
      motionPrompt: '',
      utterances,
      seconds: fitSeconds(shot.seconds, utterances, project.speech_rate, bounds),
      cast: members,
      sceneRef: scene ? toRef(scene) : null,
      props: shot.props.flatMap((name) => {
        const prop = propByName.get(name.trim())
        if (!prop) {
          droppedRefs.add(name)
          return []
        }
        return [toRef(prop)]
      }),
      beatIndex: shot.beat_index,
    }
  })

  // 角色对不上就中止：没有设定图参考，人物长相前后不一致。
  if (unknownCast.size > 0) {
    throw new Conflict(
      `分镜里出现了未锁定的角色：${[...unknownCast].join('、')}。请先出设定图并锁定，或重新拆分镜。`,
    )
  }
  // 场景道具对不上只去掉引用并告警，按文字描述画。
  if (droppedRefs.size > 0) {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'warn',
      message: `分镜引用了未锁定的场景 / 道具，已忽略：${[...droppedRefs].join('、')}`,
    })
  }
  assertAllUtterancesUsed(beats, replies)
  if (unknownValues.size > 0) {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'warn',
      message: `分镜含无法识别的取值，已改用默认值：${[...unknownValues].join('、')}`,
    })
  }
  // 群演不需要设定图，没锁定的说话人只列出来由人判断。
  const unlockedSpeakers = speakersOf(beats.flatMap((beat) => beat.utterances)).filter((name) => !castByName.has(name.trim()))
  if (unlockedSpeakers.length > 0) {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'info',
      message: `这些说话人没有设定图，出镜时按文字现画、用默认音色：${unlockedSpeakers.join('、')}`,
    })
  }
  if (downgraded.length > 0) {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'warn',
      message: `${downgraded.join('、')}标了「接上一镜」但不是同一场景或画面里没人，已改成硬切`,
    })
  }

  const shotIds = replaceShots(ctx.db, episode.id, drafts)

  return {
    shotIds,
    totalSeconds: drafts.reduce((sum, d) => sum + d.seconds, 0),
    targetSeconds: project.target_seconds,
  }
}

/** 一镜台词最多能念多久：视频端点单次最长的秒数，还没配置视频端点时按作品的单镜上限。 */
function speechLimit(ctx: GenContext, fallback: number): { seconds: number; label: string } {
  try {
    const seconds = maxDuration(roleCapabilities(ctx, 'video'))
    if (seconds !== undefined) return { seconds, label: '视频模型单次最长' }
  } catch (error) {
    if (!(error instanceof Conflict)) throw error
  }
  return { seconds: fallback, label: '单镜最长' }
}

/** 单句台词就超过上限时拆镜也念不完，只能回叙事节拍改。 */
export function assertUtterancesFit(beats: readonly Beat[], speechRate: number, limit: { seconds: number; label: string }): void {
  const tooLong = beats.flatMap((beat, i) =>
    beat.utterances
      .filter((line) => speechSeconds([line.text], speechRate) > limit.seconds)
      .map((line) => `节拍 ${i + 1} 的「${line.text.slice(0, 12)}」`),
  )
  if (tooLong.length > 0) throw new Conflict(`这些台词一句就超过${limit.label} ${limit.seconds} 秒，拆镜也念不完：${tooLong.join('、')}。请在叙事节拍里改短或拆成几句`)
}

/** 解析失败或有镜头台词念不完时，重拆这一拍一次。 */
export async function splitBeat(ask: (prompt: string) => Promise<string>, warn: (message: string) => void, focus: number, summary: string, promptFor: (overlong: readonly string[]) => string, overlongOf: (shots: z.infer<typeof shotsSchema>['shots']) => string[]): Promise<z.infer<typeof shotsSchema>> {
  let overlong: string[] = []
  for (let attempt = 1; ; attempt++) {
    const text = await ask(promptFor(overlong))
    let reply: z.infer<typeof shotsSchema>
    try {
      reply = parseReply(text, shotsSchema, `拆分镜（节拍 ${focus + 1}）`)
    } catch (error) {
      if (attempt >= 2) throw error
      warn(`节拍 ${focus + 1}「${summary.slice(0, 20)}」的回复解析失败，重拆这一拍`)
      continue
    }
    overlong = overlongOf(reply.shots)
    if (overlong.length === 0) return reply
    if (attempt >= 2) throw new Conflict(`节拍 ${focus + 1} 重拆后仍有镜头的台词念不完：${overlong.join('；')}`)
    warn(`节拍 ${focus + 1}「${summary.slice(0, 20)}」有镜头的台词念不完，重拆这一拍`)
  }
}

export function pickUtterances(beats: readonly Beat[], beatIndex: number, indexes: readonly number[], shotIndex: number): Utterance[] {
  const beat = beats[beatIndex]
  if (!beat) throw new Conflict(`第 ${shotIndex + 1} 镜引用了不存在的节拍 ${beatIndex + 1}`)
  return indexes.map((at) => {
    const line = beat.utterances[at]
    if (!line) throw new Conflict(`第 ${shotIndex + 1} 镜引用了节拍 ${beatIndex + 1} 里不存在的台词 ${at + 1}`)
    return line
  })
}

/** 每条已确认的台词必须恰好分到一镜上。 */
export function assertAllUtterancesUsed(beats: readonly Beat[], shots: readonly { beat_index: number; utterance_indexes: readonly number[] }[]): void {
  const used = new Map<string, number>()
  for (const shot of shots) {
    for (const at of shot.utterance_indexes) {
      const key = `${shot.beat_index}:${at}`
      used.set(key, (used.get(key) ?? 0) + 1)
    }
  }
  const missing: string[] = []
  const repeated: string[] = []
  beats.forEach((beat, i) => {
    beat.utterances.forEach((line, j) => {
      const count = used.get(`${i}:${j}`) ?? 0
      const label = `节拍 ${i + 1} 的「${line.text.slice(0, 12)}」`
      if (count === 0) missing.push(label)
      if (count > 1) repeated.push(label)
    })
  })
  if (missing.length > 0 || repeated.length > 0) {
    const parts = [
      missing.length > 0 ? `没有镜头念：${missing.join('、')}` : '',
      repeated.length > 0 ? `被多镜重复引用：${repeated.join('、')}` : '',
    ].filter(Boolean)
    throw new Conflict(`分镜没有把台词分配完整。${parts.join('；')}。请重新拆分镜。`)
  }
}

interface LockedAsset {
  readonly assetId: string
  readonly versionId: string
  readonly name: string
  readonly aliases: readonly string[]
  /** 角色的身份与关系，其他类别为空串。 */
  readonly identity: string
  /** 锁定版里能当参考图的设定图类型，拆分镜时只能从中挑。 */
  readonly looks: readonly AssetFileRole[]
  /** 角色的着装，其他类别为空串。 */
  readonly outfit: string
  /** 换装才有：本体的资产 id。 */
  readonly baseId: string | null
}

/** 这个人有不止一身装扮，名单里要写出各身着装。 */
function costumed(cast: readonly LockedAsset[], asset: LockedAsset): boolean {
  const person = asset.baseId ?? asset.assetId
  return cast.some((other) => other !== asset && (other.baseId ?? other.assetId) === person)
}

/** 可被镜头引用的资产：已锁定且有快照版本。 */
function lockedAssets(ctx: GenContext, projectId: string, category: AssetCategory): LockedAsset[] {
  return listAssets(ctx.db, projectId, category)
    .filter((asset) => asset.state === 'locked')
    .flatMap((asset) => {
      const version = latestVersionOf(ctx.db, asset.id)
      if (!version) return []
      const locked = getAssetVersion(ctx.db, version.id)
      return [
        {
          assetId: asset.id,
          versionId: version.id,
          name: asset.name,
          aliases: dataOf(asset).aliases,
          identity: asset.category === 'character' ? characterIn(locked).identity : '',
          looks: REFERENCE_ROLES.filter((role) => locked.files.some((f) => f.role === role)),
          outfit: asset.category === 'character' ? characterIn(locked).outfit : '',
          baseId: asset.base_id,
        },
      ]
    })
}

/** 正式名与别名都能对上。 */
function nameIndex(assets: readonly LockedAsset[]): Map<string, LockedAsset> {
  return new Map(assets.flatMap((a) => [a.name, ...a.aliases].map((n) => [n.trim(), a] as const)))
}

function toRef(asset: LockedAsset): ShotRef {
  return { asset_id: asset.assetId, version_id: asset.versionId, name: asset.name }
}
