/** 提取资产与出设定图。角色先出全身图，其余几张以它为参考图，脸才一致，所以不并行。 */

import { assetRefFromFile } from '../endpoint/asset'
import { argsFor, generate, generateText, projectStyle, type GenContext } from './gen'
import { parseReply, z } from './reply'
import { ASSETS_SYSTEM, assetsPrompt, lookPrompt, type PromptArgs } from './prompts'
import { addAssetFile } from '../service/assets'
import { ASSET_FILE_ROLE_LABEL, CHARACTER_FORMS, CREATURE_LOOKS, LOOKS_BY_CATEGORY, LOOK_ORDER, type Aspect, type AssetCategory, type AssetFileRole } from '@vesper/shared'
import { characterOf, createAsset, findProjectAsset, getAsset, listAssetFiles, listAssets, propOf, sceneOf, type AssetRow } from '../repo/assets'
import { appendEvent } from '../repo/runs'
import { Conflict } from '../domain/errors'
import { listEpisodes, type ProjectRow } from '../repo/projects'
import type { SourceRow } from '../repo/sources'
import { parseBeats } from '../domain/beats'

const assetsSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        tier: z.enum(['lead', 'support']).default('support'),
        form: z.enum(CHARACTER_FORMS).default('human'),
        identity: z.string().default(''),
        traits: z.string().default(''),
        outfit: z.string().default(''),
        costumes: z.array(z.object({ name: z.string().min(1), outfit: z.string().default('') })).default([]),
        voice: z.string().default(''),
        appearances: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  scenes: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        description: z.string().default(''),
        lighting: z.string().default(''),
        appearances: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  props: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        description: z.string().default(''),
        holder: z.string().default(''),
        appearances: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
})

export interface ExtractResult {
  readonly created: { id: string; name: string; category: AssetCategory }[]
  readonly skipped: string[]
  readonly note: string
}

/** 只取节拍已确认的集：草稿节拍随时会被重写。 */
function onScreenSpeakers(ctx: GenContext, projectId: string): string[] {
  const names = new Set<string>()
  for (const episode of listEpisodes(ctx.db, projectId)) {
    if (episode.beats_state !== 'confirmed') continue
    for (const beat of parseBeats(episode.beats)) {
      for (const line of beat.utterances) if (line.speaker !== null) names.add(line.speaker)
    }
  }
  return [...names]
}

/** 多份原文拼进一次请求，同一角色才不会在每份里各建一次。 */
function joinSources(files: readonly SourceRow[]): string {
  if (files.length === 1) return files[0]!.text
  return files.map((file) => `【${file.name}】\n${file.text}`).join('\n\n')
}

/** 已有同名资产的跳过，不覆盖。 */
export async function extractAssets(ctx: GenContext, project: ProjectRow, files: readonly SourceRow[]): Promise<ExtractResult> {
  const known = listAssets(ctx.db, project.id)
  const { text } = await generateText(ctx, {
    owner: { kind: 'project', id: project.id },
    purpose: 'asset_extract',
    label: files.length === 1 ? `提取资产（${files[0]!.name}）` : `提取资产（${files.length} 份原文）`,
    params: {
      system: ASSETS_SYSTEM,
      prompt: assetsPrompt(
        joinSources(files),
        onScreenSpeakers(ctx, project.id),
        argsFor(ctx, 'assets'),
        known.map((a) => a.name),
      ),
    },
  })

  const reply = parseReply(text, assetsSchema, '提取资产')
  // 同名按类别分开判断：角色与道具可以重名。
  const existing = new Set(known.map((a) => `${a.category}:${a.name}`))

  const created: ExtractResult['created'] = []
  const skipped: string[] = []
  const add = (category: AssetCategory, name: string, data: Record<string, unknown>, baseId?: string) => {
    if (existing.has(`${category}:${name}`)) {
      skipped.push(name)
      return
    }
    existing.add(`${category}:${name}`)
    created.push({ id: createAsset(ctx.db, { projectId: project.id, category, name, data, baseId }), name, category })
  }

  for (const c of reply.characters) {
    add('character', c.name, {
      aliases: c.aliases,
      tier: c.tier,
      form: c.form,
      identity: c.identity,
      traits: c.traits,
      outfit: c.outfit,
      voice: c.voice,
      appearances: c.appearances,
    })
    // 本体之前已提取过也照样挂上换装。
    const base = findProjectAsset(ctx.db, project.id, 'character', c.name)
    if (base !== null) for (const costume of c.costumes) add('character', `${c.name}·${costume.name}`, { tier: c.tier, outfit: costume.outfit }, base.id)
  }
  for (const s of reply.scenes) {
    add('scene', s.name, {
      aliases: s.aliases,
      description: s.description,
      lighting: s.lighting,
      appearances: s.appearances,
    })
  }
  for (const p of reply.props) {
    add('prop', p.name, {
      aliases: p.aliases,
      description: p.description,
      holder: p.holder,
      appearances: p.appearances,
    })
  }

  const note = `新建 ${created.length} 个，已存在 ${skipped.length} 个`
  appendEvent(ctx.db, ctx.runId, {
    type: 'note',
    level: 'info',
    message:
      `提取到 ${reply.characters.length} 个角色、${reply.scenes.length} 个场景、${reply.props.length} 个道具，${note}`,
  })
  return { created, skipped, note }
}

/** 设定图按设定图类型定画幅，不跟作品画幅。 */
const LOOK_ASPECT: Readonly<Partial<Record<AssetFileRole, Aspect>>> = {
  full_body: '9:16',
  portrait: '9:16',
  outfit: '9:16',
  turnaround: '1:1',
  expressions: '1:1',
  object: '1:1',
}

/** 按类别拼出逐字进提示词的设定行。换装的外貌取本体的。 */
function anchorLines(category: AssetCategory, asset: AssetRow, base: AssetRow | null): string[] {
  if (category === 'scene') {
    const scene = sceneOf(asset)
    return [`环境：${scene.description}`, `光线：${scene.lighting}`]
  }
  if (category === 'prop') {
    const prop = propOf(asset)
    return [`外观：${prop.description}`, prop.holder === '' ? '' : `归属：${prop.holder}`]
  }
  const character = characterOf(asset)
  const look = `外貌：${characterOf(base ?? asset).traits}`
  return character.form === 'creature' || character.outfit.trim() === '' ? [look] : [look, `着装：${character.outfit}`]
}

export interface GeneratedFile {
  readonly role: AssetFileRole
  readonly path: string
  readonly jobId: string
}

export interface LookPlan {
  readonly role: AssetFileRole
  readonly prompt: string
  /** 不指定 roles 时画不画，只有第一张是 'yes'。 */
  readonly wanted: 'yes' | 'no'
}

/** 不指定 roles 只画第一张，人看过再补其余。 */
function lookRoles(asset: AssetRow): { all: readonly AssetFileRole[]; byDefault: readonly AssetFileRole[] } {
  const all = asset.category === 'character' && characterOf(asset).form === 'creature' ? CREATURE_LOOKS : LOOKS_BY_CATEGORY[asset.category]
  return { all, byDefault: all.slice(0, 1) }
}

/** 设定图的提示词，发起与预览共用。base 是换装的本体。 */
export function planLooks(asset: AssetRow, base: AssetRow | null, style: string, args: PromptArgs = {}): LookPlan[] {
  const anchors = anchorLines(asset.category, asset, base).filter((line) => line !== '')
  const { all, byDefault } = lookRoles(asset)
  return LOOK_ORDER.filter((role) => all.includes(role)).map((role) => ({
    role,
    prompt: lookPrompt(role, base?.name ?? asset.name, anchors, style, args, { costume: base !== null && role === 'full_body', creature: asset.category === 'character' && characterOf(asset).form === 'creature' }),
    wanted: byDefault.includes(role) ? 'yes' : 'no',
  }))
}

function baseOf(db: GenContext['db'], asset: AssetRow): AssetRow | null {
  return asset.base_id === null ? null : getAsset(db, asset.base_id)
}

export async function generateLooks(ctx: GenContext, assetId: string, roles?: readonly AssetFileRole[]): Promise<GeneratedFile[]> {
  const asset = getAsset(ctx.db, assetId)
  const base = baseOf(ctx.db, asset)
  const plans = planLooks(asset, base, projectStyle(ctx, asset.project_id), argsFor(ctx, 'look'))
  const wanted = roles ?? plans.filter((plan) => plan.wanted === 'yes').map((plan) => plan.role)
  const results: GeneratedFile[] = []

  for (const plan of plans) {
    if (!wanted.includes(plan.role)) continue
    // 角色除全身图外都以自己的全身图为参考；换装的全身图以本体的全身图为参考。
    const anchor =
      asset.category !== 'character' ? undefined
      : plan.role !== 'full_body' ? await anchorImage(ctx, assetId)
      : base === null ? undefined
      : await requiredAnchor(ctx, base)
    const result = await generate(ctx, {
      owner: { kind: 'asset', id: assetId },
      purpose: `look_${plan.role}`,
      label: `${asset.name} 设定图（${ASSET_FILE_ROLE_LABEL[plan.role]}）`,
      role: 'image',
      params: { prompt: plan.prompt },
      inputs: anchor ? { reference_images: [anchor] } : {},
      aspect: LOOK_ASPECT[plan.role],
    })

    const path = result.outcome.artifacts[0]
    if (path === undefined) throw new Error(`${asset.name} 的${ASSET_FILE_ROLE_LABEL[plan.role]}没有产出图像文件`)
    addAssetFile(ctx.db, assetId, { role: plan.role, path, jobId: result.jobId })
    results.push({ role: plan.role, path, jobId: result.jobId })
  }
  return results
}

export interface AllLooksResult {
  readonly done: { id: string; name: string; looks: number }[]
  /** 已锁定或已有图而跳过的件数。 */
  readonly skipped: number
}

/** 批量只补未锁定且一张设定图都没有的。 */
function assetsNeedingLooks(db: GenContext['db'], projectId: string, category?: AssetCategory): AssetRow[] {
  const all = listAssets(db, projectId, category)
  const hasLook = (assetId: string) => listAssetFiles(db, assetId).some((file) => LOOK_ORDER.includes(file.role))
  const order: readonly AssetCategory[] = category ? [category] : ['character', 'scene', 'prop']
  return order.flatMap((one) =>
    all.filter((asset) => asset.category === one && asset.state !== 'locked' && !hasLook(asset.id)),
  )
}

export async function generateAllLooks(ctx: GenContext, projectId: string, category?: AssetCategory): Promise<AllLooksResult> {
  const all = listAssets(ctx.db, projectId, category)
  const todo = assetsNeedingLooks(ctx.db, projectId, category)

  appendEvent(ctx.db, ctx.runId, {
    type: 'note',
    level: 'info',
    message: `${todo.length} 件资产各出一张，${all.length - todo.length} 件跳过（已锁定或已经有图）`,
  })

  const done: AllLooksResult['done'] = []
  for (const asset of todo) {
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'info',
      message: `（${done.length + 1}/${todo.length}）${asset.name}`,
    })
    done.push({ id: asset.id, name: asset.name, looks: (await generateLooks(ctx, asset.id)).length })
  }
  return { done, skipped: all.length - todo.length }
}

/** 按音色描述出几段试音供挑选，最后一段为当前。同一句描述每次出的声音都不同。 */
export async function generateVoiceSample(ctx: GenContext, assetId: string, line: string, count: number): Promise<GeneratedFile[]> {
  const asset = getAsset(ctx.db, assetId)
  const voice = characterOf(asset).voice.trim()
  if (voice === '') throw new Conflict(`${asset.name} 还没有音色描述，先写好再试音`)
  const done: GeneratedFile[] = []
  for (let i = 1; i <= count; i++) {
    const result = await generate(ctx, {
      owner: { kind: 'asset', id: assetId },
      purpose: 'voice_sample',
      label: `${asset.name} 试音 ${i}/${count}`,
      role: 'tts',
      params: { text: line, voice_hint: voice },
    })
    const path = result.outcome.artifacts[0]
    if (path === undefined) throw new Error(`${asset.name} 的试音没有产出文件`)
    // 记下当时的描述，描述改过后仍分得清每段的来历。
    addAssetFile(ctx.db, assetId, { role: 'voice_sample', label: voice, path, jobId: result.jobId })
    done.push({ role: 'voice_sample', path, jobId: result.jobId })
  }
  return done
}

async function requiredAnchor(ctx: GenContext, base: AssetRow) {
  const anchor = await anchorImage(ctx, base.id)
  if (anchor === undefined) throw new Conflict(`「${base.name}」还没有全身图，先给本体出图`)
  return anchor
}

async function anchorImage(ctx: GenContext, assetId: string) {
  const full = listAssetFiles(ctx.db, assetId).find((f) => f.role === 'full_body')
  if (!full) return undefined
  return assetRefFromFile(full.path)
}
