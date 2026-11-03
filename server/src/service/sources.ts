/** 原文与分集：分集须盖满原文，定稿后不可改，定稿时结算过时。 */

import type { Database } from 'bun:sqlite'

import type { PlanState } from '@vesper/shared'

import { prepareSources, titleOf, type SourceFile } from '../domain/import'
import { checkFileSpans } from '../domain/spans'
import { Conflict } from '../domain/errors'
import {
  deleteEpisode,
  insertEpisodes,
  listEpisodesOf,
  renumberEpisodes,
  setBeatsState,
  touchProject,
  writeEpisodePlan,
  type EpisodeDraft,
  type EpisodeRow,
} from '../repo/projects'
import { listShots, markStale } from '../repo/shots'
import {
  appendSources,
  deleteSource,
  getSource,
  insertPlanVersion,
  latestPlanVersion,
  listSources,
  setPlanState,
  writeSource,
  writeSourceOrder,
  type SourceRow,
} from '../repo/sources'

/** 追加原文，每份默认整篇一集。 */
export function addSources(db: Database, projectId: string, files: readonly SourceFile[]): SourceRow[] {
  const prepared = prepareSources(files)
  if (prepared.length === 0) throw new Conflict('没有可导入的原文')

  return db.transaction(() => {
    const sources = appendSources(db, projectId, prepared)
    for (const source of sources) {
      insertEpisodes(db, projectId, source.id, [
        { title: titleOf(source), synopsis: '', sourceStart: 0, sourceEnd: source.text.length },
      ])
    }
    touchProject(db, projectId)
    return sources
  })()
}

/** 整批替换分集。按顺序复用已有的集，保留未改动集的节拍与镜头。 */
export function replaceSourceEpisodes(db: Database, sourceId: string, drafts: readonly EpisodeDraft[]): EpisodeCountResult {
  const source = getSource(db, sourceId)
  assertDraft(source)
  const ordered = [...drafts].sort((a, b) => a.sourceStart - b.sourceStart)
  assertSpans(source, ordered)

  return db.transaction(() => {
    const existing = listEpisodesOf(db, sourceId)
    const reused = existing.slice(0, ordered.length)
    reused.forEach((episode, nth) => writeEpisodePlan(db, episode.id, ordered[nth]!))
    for (const surplus of existing.slice(ordered.length)) deleteEpisode(db, surplus.id)
    // 新增的集在作品末尾取号，原文不在最后时需要重排集号。
    insertEpisodes(db, source.project_id, sourceId, ordered.slice(existing.length))

    const renumberedFrom = renumberEpisodes(db, source.project_id)
    touchProject(db, source.project_id)
    return { episodes: ordered.length, renumberedFrom }
  })()
}

export interface EpisodeCountResult {
  readonly episodes: number
  /** 从第几集起改了号（1 基）。null 表示集号一个没动。 */
  readonly renumberedFrom: number | null
}

export interface FreezeResult {
  readonly versionId: string
  readonly version: number
  readonly episodes: number
  readonly staleArtifacts: number
}

/** 定稿并结算过时。只有区间变了的集才标下游过时，追加原文不影响已有的集。 */
export function freezeSource(db: Database, sourceId: string): FreezeResult {
  const source = getSource(db, sourceId)
  if (source.plan_state === 'frozen') throw new Conflict('这份原文已经定稿')

  const episodes = listEpisodesOf(db, sourceId)
  if (episodes.length === 0) throw new Conflict('这份原文还没有分集可定稿')
  assertSpans(source, episodes)

  const before = new Map((latestPlanVersion(db, sourceId)?.plan ?? []).map((entry) => [entry.id, entry]))

  return db.transaction(() => {
    let staleArtifacts = 0
    for (const episode of episodes) {
      const previous = before.get(episode.id)
      if (previous?.source_start === episode.source_start && previous.source_end === episode.source_end) continue
      // 区间变了，节拍要重新确认。
      setBeatsState(db, episode.id, 'draft')
      staleArtifacts += staleEpisode(db, episode.id)
    }

    const { versionId, version } = insertPlanVersion(
      db,
      sourceId,
      episodes.map((e) => ({
        id: e.id,
        idx: e.idx,
        title: e.title,
        synopsis: e.synopsis,
        source_start: e.source_start,
        source_end: e.source_end,
      })),
    )
    setPlanState(db, sourceId, 'frozen')
    return { versionId, version, episodes: episodes.length, staleArtifacts }
  })()
}

/** 只改状态，不标过时；差异在再次定稿时结算。 */
export function unfreezeSource(db: Database, sourceId: string): void {
  const source = getSource(db, sourceId)
  if (source.plan_state === 'draft') throw new Conflict('这份原文尚未定稿')
  setPlanState(db, sourceId, 'draft')
}

export interface ReplaceTextResult {
  readonly staleArtifacts: number
}

/** 换正文后区间全部作废，下游一律标过时。 */
export function replaceSourceText(db: Database, sourceId: string, text: string): ReplaceTextResult {
  const source = getSource(db, sourceId)
  assertDraft(source)

  return db.transaction(() => {
    writeSource(db, sourceId, { text })
    let staleArtifacts = 0
    for (const episode of listEpisodesOf(db, sourceId)) staleArtifacts += staleEpisode(db, episode.id)
    touchProject(db, source.project_id)
    return { staleArtifacts }
  })()
}

export function renameSource(db: Database, sourceId: string, name: string): void {
  writeSource(db, sourceId, { name })
}

/** 删原文及其分集，后续集号前移。返回从第几集起改了号。 */
export function removeSource(db: Database, sourceId: string): number | null {
  const source = getSource(db, sourceId)
  return db.transaction(() => {
    deleteSource(db, sourceId)
    const renumberedFrom = renumberEpisodes(db, source.project_id)
    touchProject(db, source.project_id)
    return renumberedFrom
  })()
}

/** 调整原文顺序，区间不动、集号重编，已定稿的也可调。返回从第几集起改了号。 */
export function reorderSources(db: Database, projectId: string, ids: readonly string[]): number | null {
  const current = listSources(db, projectId).map((source) => source.id)
  if (ids.length !== current.length || !current.every((id) => ids.includes(id))) {
    throw new Conflict('原文列表已变，刷新后再排')
  }
  return db.transaction(() => {
    writeSourceOrder(db, projectId, ids)
    const renumberedFrom = renumberEpisodes(db, projectId)
    touchProject(db, projectId)
    return renumberedFrom
  })()
}

/** 每份原文都定稿了，作品才算定稿。 */
export function projectPlanState(db: Database, projectId: string): PlanState {
  const sources = listSources(db, projectId)
  if (sources.length === 0) return 'draft'
  return sources.every((source) => source.plan_state === 'frozen') ? 'frozen' : 'draft'
}

/** 把这一集的合成版与各镜产物都标过时，返回标了几件。 */
function staleEpisode(db: Database, episodeId: string): number {
  let count = markStale(db, { kind: 'episode', id: episodeId }, ['film'])
  for (const shot of listShots(db, episodeId)) {
    count += markStale(db, { kind: 'shot', id: shot.id }, ['first_frame', 'clip', 'voice'])
  }
  return count
}

function assertDraft(source: SourceRow): void {
  if (source.plan_state === 'frozen') throw new Conflict('这份原文已定稿，需先重新编辑')
}

function assertSpans(source: SourceRow, episodes: readonly (EpisodeDraft | EpisodeRow)[]): void {
  const problem = checkFileSpans(
    source.text.length,
    episodes.map((episode, nth) => ({
      label: 'idx' in episode ? `第 ${episode.idx + 1} 集` : `本原文第 ${nth + 1} 段`,
      start: 'sourceStart' in episode ? episode.sourceStart : episode.source_start,
      end: 'sourceStart' in episode ? episode.sourceEnd : episode.source_end,
    })),
  )
  if (problem) throw new Conflict(problem)
}
