/** 把几张表的行拼成界面要用的形状。这些形状只服务界面，所以不放 repo。 */

import { existsSync } from 'node:fs'

import type { Database } from 'bun:sqlite'

import type { AssetCategory, AssetDataOf, AssetPreview, AssetSummary, AssetView, AudioMode, Binding, BindingRole, ContinuityMode, EndpointCapabilities, EpisodeView, Job, JobView, LibraryItem, Progress, ProjectView, Review, Run, RunLocation, ShotPreview, ShotPreviewRef, Volume } from '@vesper/shared'

import { episodeProgress, overallPercent, type EpisodeProgress } from '../domain/progress'
import { planLooks } from '../pipeline/assets'
import { effectiveAudioMode, endpointCapabilities } from '../pipeline/gen'
import { chainsFrom, clipOf, offFrameCast, planClip, planFirstFrame, tailPath, type RefSlot } from '../pipeline/preview'
import { resolveAudioMode } from '../domain/audio'
import type { PromptArgs, PromptId } from '../pipeline/prompts'
import { curlForCall, loadJob, parseUsage, type JobRow } from '../db/records'
import { priceUsage } from '../domain/billing'
import {
  characterOf,
  dataOf,
  findAsset,
  getAsset,
  latestVersionOf,
  listAssetFiles,
  listAssets,
  listLibraryAssets,
  propOf,
  sceneOf,
  type AssetRow,
} from '../repo/assets'
import { findEpisode, findProject, getEpisode, getProject, listEpisodes, type ProjectRow } from '../repo/projects'
import { getSource, listSources, type SourceRow } from '../repo/sources'
import { projectPlanState } from '../service/sources'
import {
  castOf,
  currentArtifacts,
  findShot,
  listShots,
  propsOf,
  sceneRefOf,
  shotViews,
  utterancesOf,
  type ShotRow,
} from '../repo/shots'
import type { RunRow } from '../repo/runs'
import { assessVolume } from '../domain/pacing'
import { parseBeats } from '../domain/beats'
import { findApiKey, listBindings, listCredentials, listEndpoints } from '../repo/catalog'
import { Conflict, NotFound } from '../domain/errors'
import { parseJson } from '../repo/common'

export function projectView(db: Database, projectId: string): ProjectView {
  const project = getProject(db, projectId)
  const sources = listSources(db, projectId)
  const episodes = listEpisodes(db, projectId)
  const audioMode = effectiveAudioMode(db, projectId, project.audio_mode)
  const progress = episodes.map((episode) => episodeProgress(shotViews(db, episode.id), audioMode))

  // 列表只需要节拍数与确认状态，不带节拍正文。
  const summaries = episodes.map(({ beats, review: _review, ...episode }, i) => ({
    ...episode,
    beats_count: parseBeats(beats).length,
    shots: listShots(db, episode.id).length,
    progress: summarize(progress[i]),
    film: currentArtifacts(db, { kind: 'episode', id: episode.id }).find((a) => a.kind === 'film') ?? null,
  }))

  return {
    project: { ...project, plan_state: projectPlanState(db, projectId), volume: volumeView(sources, project) },
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      char_count: source.text.length,
      plan_state: source.plan_state,
      frozen_at: source.frozen_at,
      episodes: summaries.filter((episode) => episode.source_id === source.id),
    })),
    cast: assetCards(db, projectId, 'character'),
    scenes: assetCards(db, projectId, 'scene'),
    props: assetCards(db, projectId, 'prop'),
    bindings: bindingViews(db, projectId),
    overall_percent: overallPercent(progress),
  }
}

function assetCards<C extends AssetCategory>(db: Database, projectId: string, category: C): AssetSummary<AssetDataOf<C>>[] {
  const all = listAssets(db, projectId, category)
  const bases = all.filter((asset) => asset.base_id === null).sort(byImportance)
  // 换装紧跟在本体后面。
  const ordered = bases.flatMap((base) => [base, ...all.filter((asset) => asset.base_id === base.id).sort(byImportance)])
  return ordered.map((asset) => {
    const version = latestVersionOf(db, asset.id)
    const baseVersion = asset.base_id === null ? null : latestVersionOf(db, asset.base_id)
    return {
      id: asset.id,
      name: asset.name,
      state: asset.state,
      // data 的形状由 category 决定，类型上表达不了。
      data: dataOf(asset) as AssetDataOf<C>,
      files: listAssetFiles(db, asset.id).length,
      version_id: version?.id ?? null,
      base_id: asset.base_id,
      base_newer: version !== null && baseVersion !== null && baseVersion.locked_at > version.locked_at ? 'yes' : 'no',
    }
  })
}

/** 人工排过的在前，其余按重要性排。 */
function byImportance(a: AssetRow, b: AssetRow): number {
  const manual = (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
  if (manual) return manual
  const tier = (asset: AssetRow) => (asset.category === 'character' && characterOf(asset).tier === 'lead' ? 0 : 1)
  return tier(a) - tier(b) || dataOf(b).appearances - dataOf(a).appearances || a.name.localeCompare(b.name, 'zh')
}

/** 作品体量取各份原文之和。 */
function volumeView(sources: readonly SourceRow[], project: ProjectRow): Volume | null {
  if (sources.length === 0) return null
  const text = sources.map((source) => source.text).join('\n')
  const verdict = assessVolume(text, project.speech_rate, project.target_seconds)
  return {
    char_count: verdict.charCount,
    narrated_seconds: verdict.narratedSeconds,
    target_seconds: verdict.targetSeconds,
    message: verdict.message,
  }
}

export function bindingViews(db: Database, projectId: string | null): Binding[] {
  const endpoints = new Map(listEndpoints(db).map((e) => [e.id, e.name]))
  const credentials = new Map(listCredentials(db).map((c) => [c.id, c.name]))
  return listBindings(db, projectId).map((binding) => ({
    role: binding.role,
    endpoint_id: binding.endpointId,
    endpoint_name: endpoints.get(binding.endpointId) ?? '（调用方式已删除）',
    credential_id: binding.credentialId,
    credential_name: credentials.get(binding.credentialId) ?? '（凭证已删除）',
    params: binding.params,
    inherited: binding.inherited,
  }))
}

export function episodeView(db: Database, episodeId: string): EpisodeView {
  const episode = getEpisode(db, episodeId)
  const project = getProject(db, episode.project_id)
  const audioMode = effectiveAudioMode(db, project.id, project.audio_mode)
  const progress = episodeProgress(shotViews(db, episodeId), audioMode)
  const byShot = new Map(progress.shots.map((s) => [s.shotId, s]))

  const source = getSource(db, episode.source_id)

  return {
    episode: { ...episode, source_name: source.name, beats: parseBeats(episode.beats), review: episode.review ? (JSON.parse(episode.review) as Review) : null },
    source: source.text.slice(episode.source_start, episode.source_end),
    target_seconds: project.target_seconds,
    speech_rate: project.speech_rate,
    /** 已按视频端点能力折算的音轨模式。 */
    audio_mode: audioMode,
    continuity_mode: project.continuity_mode,
    shots: listShots(db, episodeId).map((shot) => ({
      ...shot,
      utterances: utterancesOf(shot),
      cast: castOf(shot),
      scene_ref: sceneRefOf(shot),
      props: propsOf(shot),
      artifacts: currentArtifacts(db, { kind: 'shot', id: shot.id }),
      slots: byShot.get(shot.id)?.slots ?? null,
      status: byShot.get(shot.id)?.status ?? 'missing',
    })),
    progress: summarize(progress),
    film: currentArtifacts(db, { kind: 'episode', id: episodeId }).find((a) => a.kind === 'film') ?? null,
  }
}

function summarize(progress: EpisodeProgress | undefined): Progress | null {
  if (!progress) return null
  return {
    percent: progress.percent,
    counts: progress.counts,
    assemblable: progress.assemblable,
    total_seconds: progress.totalSeconds,
  }
}

export function assetView(db: Database, assetId: string): AssetView {
  const asset = getAsset(db, assetId)
  const base = { ...asset, files: listAssetFiles(db, assetId), locked_paths: lockedPaths(db, assetId) }
  // 逐类取 data：联合类型要求 category 与 data 对应，用 dataOf 只能靠断言。
  if (asset.category === 'scene') return { ...base, category: 'scene', data: sceneOf(asset) }
  if (asset.category === 'prop') return { ...base, category: 'prop', data: propOf(asset) }
  return { ...base, category: 'character', data: characterOf(asset) }
}

export function libraryItems(db: Database): LibraryItem[] {
  return listLibraryAssets(db).map((asset) => ({ ...assetView(db, asset.id), tags: parseJson<string[]>(asset.tags, []), created_at: asset.created_at }))
}

/** 最近一次锁定时每个图位用的那张。解锁后镜头仍引用它，照样返回。 */
function lockedPaths(db: Database, assetId: string): string[] {
  const latest = latestVersionOf(db, assetId)
  if (latest === null) return []
  const files = parseJson<{ role: string; path: string }[]>(latest.files, [])
  return files.filter((f, i) => files.findIndex((g) => g.role === f.role) === i).map((f) => f.path)
}

/** 这件资产按这套参数会发出的提示词，与发起共用 `planLooks`。不校验锁定。 */
export function assetPreview(db: Database, assetId: string, input: PreviewInput = {}): AssetPreview {
  const asset = getAsset(db, assetId)
  const project = asset.project_id === null ? null : findProject(db, asset.project_id)
  const looks = planLooks(asset, asset.base_id === null ? null : getAsset(db, asset.base_id), project?.style ?? '', input.promptArgs?.look)

  return {
    asset_id: asset.id,
    looks: looks.map((look) => ({ ...look, prompt: input.promptText?.[`look_${look.role}`] ?? look.prompt })),
    // 素材库里的资产不属于任何作品，没有绑定可查。
    unbound: project !== null && boundCapabilities(db, project.id, 'image', input.overrides?.image) === null
      ? ['image']
      : [],
  }
}

export function runView(db: Database, run: RunRow): Run {
  return { ...run, location: runLocation(db, run) }
}

export function runViews(db: Database, runs: readonly RunRow[]): Run[] {
  return runs.map((run) => runView(db, run))
}

/** 任务在界面上的位置。归属只有 id，这里换算成 1 起的集号镜号。 */
function runLocation(db: Database, run: RunRow): RunLocation | null {
  const at = ownerPlace(db, run)
  if (at === null) return null
  const project = findProject(db, at.project_id)
  if (project === null) return null
  return { episode_no: null, shot_no: null, asset_id: null, asset_name: null, ...at, project_name: project.name }
}

type OwnerPlace = Partial<RunLocation> & { project_id: string }

function ownerPlace(db: Database, run: RunRow): OwnerPlace | null {
  if (run.owner_kind === 'project') return { project_id: run.owner_id }

  if (run.owner_kind === 'episode') {
    const episode = findEpisode(db, run.owner_id)
    return episode === null ? null : { project_id: episode.project_id, episode_no: episode.idx + 1 }
  }

  if (run.owner_kind === 'shot') {
    const shot = findShot(db, run.owner_id)
    const episode = shot === null ? null : findEpisode(db, shot.episode_id)
    if (shot === null || episode === null) return null
    return { project_id: episode.project_id, episode_no: episode.idx + 1, shot_no: shot.idx + 1 }
  }

  const asset = findAsset(db, run.owner_id)
  // 素材库里的资产不属于任何作品，界面上没有对应位置。
  if (asset === null || asset.project_id === null) return null
  return { project_id: asset.project_id, asset_id: asset.id, asset_name: asset.name }
}

/** 发起时临时改的参数，缺省按作品设置与空模板参数算。 */
export interface PreviewInput {
  readonly audio?: AudioMode | undefined
  readonly continuity?: ContinuityMode | undefined
  readonly promptArgs?: Partial<Record<PromptId, PromptArgs>> | undefined
  /** 换型号会连带换掉时长档位与参考图上限，预览也要按它算。 */
  readonly overrides?: Partial<Record<BindingRole, Record<string, unknown>>> | undefined
  /** 手写的提示词，按 purpose 分。 */
  readonly promptText?: Record<string, string> | undefined
}

/** 这一镜按这套参数会发出的内容，与发起共用同一套规划。不校验锁定。 */
export function shotPreview(db: Database, shot: ShotRow, input: PreviewInput = {}): ShotPreview {
  const episode = getEpisode(db, shot.episode_id)
  const project = getProject(db, episode.project_id)

  const caps = {
    image: boundCapabilities(db, project.id, 'image', input.overrides?.image),
    video: boundCapabilities(db, project.id, 'video', input.overrides?.video),
  }

  const tail = tailFor(db, chainsFrom(db, shot, input.continuity ?? project.continuity_mode))
  const first = planFirstFrame(db, shot, {
    style: project.style,
    tail,
    maxRefs: caps.image?.max_reference_images,
    args: input.promptArgs?.first_frame,
  })

  const byReference = shot.clip_source === 'reference'
  const plan = planClip(db, shot, {
    audio: resolveAudioMode(input.audio ?? project.audio_mode, caps.video?.audio === 'native'),
    capabilities: caps.video,
    args: input.promptArgs?.clip,
    reference: byReference ? { style: project.style, tail, maxRefs: caps.video?.max_reference_images } : undefined,
  })
  // 参考图模式下挂图的是视频请求。
  const slots = byReference ? plan : first

  return {
    shot_id: shot.id,
    first_frame: input.promptText?.first_frame ?? first.prompt,
    clip: input.promptText?.clip ?? plan.prompt,
    refs: [...slots.kept.map((slot) => refView(slot, 'yes')), ...slots.dropped.map((slot) => refView(slot, 'no'))],
    voices: [
      ...plan.voices.map((v) => ({ name: v.name, attached: 'yes' as const, detail: v.trimmed ? `截取前 ${v.seconds.toFixed(1)} 秒` : `${v.seconds.toFixed(1)} 秒` })),
      ...plan.voiceMisses.map((m) => ({ name: m.name, attached: 'no' as const, detail: m.reason })),
    ],
    off_frame: offFrameCast(db, shot),
    max_refs: slots.limit,
    duration: plan.duration ?? null,
    unbound: (['image', 'video'] as const).filter((role) => caps[role] === null),
  }
}

/** 上一镜视频文件还在才取得到末帧；不在时实发少一张参考图，预览同样少。 */
function tailFor(db: Database, previous: ShotRow | null): string | null {
  const clip = previous === null ? null : clipOf(db, previous.id)
  if (clip === null || !existsSync(clip)) return null
  return tailPath(clip)
}

/** 未绑定模型时上限与档位按不限算，缺的环节由 `unbound` 报出。 */
function boundCapabilities(db: Database, projectId: string, role: BindingRole, override: Record<string, unknown> | undefined): EndpointCapabilities | null {
  try {
    return endpointCapabilities(db, projectId, role, override)
  } catch (error) {
    if (error instanceof Conflict) return null
    throw error
  }
}

function refView(slot: RefSlot, attached: 'yes' | 'no'): ShotPreviewRef {
  return { kind: slot.note.kind, name: slot.note.name, anchor: slot.note.anchor, path: slot.image, attached }
}

export function jobView(db: Database, jobId: string): JobView {
  const loaded = loadJob(db, jobId)
  if (!loaded) throw new NotFound(`调用记录 ${jobId}`)
  const apiKey = findApiKey(db, loaded.job.credential_id)
  return {
    job: jobOf(loaded.job),
    calls: loaded.calls.map((call) => ({ ...call, curl: curlForCall(call, apiKey) })),
  }
}

export function jobOf(row: JobRow): Job {
  const usage = parseUsage(row)
  return { ...row, usage, cost: usage ? priceUsage(usage) : null }
}
