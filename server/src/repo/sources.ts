/** project_sources 表的读写。 */

import type { Database } from 'bun:sqlite'

import type { PlanState } from '@vesper/shared'

import { NotFound, nowIso } from './common'
import { newId } from '../db/id'

export interface SourceRow {
  readonly id: string
  readonly project_id: string
  /** 导入顺序，决定集号先后。 */
  readonly idx: number
  readonly name: string
  /** 归一化后的原文，集的区间是其中的下标。 */
  readonly text: string
  readonly plan_state: PlanState
  readonly frozen_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface SourceDraft {
  readonly name: string
  readonly text: string
}

/** 追加到末尾，已有原文的区间不变。 */
export function appendSources(db: Database, projectId: string, drafts: readonly SourceDraft[]): SourceRow[] {
  const at = nowIso()
  const next = db
    .query('SELECT COALESCE(MAX(idx) + 1, 0) AS n FROM project_sources WHERE project_id = ?')
    .get(projectId) as { n: number }
  return drafts.map((draft, offset) => {
    const id = newId('src')
    db.query(
      `INSERT INTO project_sources (id, project_id, idx, name, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, next.n + offset, draft.name, draft.text, at, at)
    return getSource(db, id)
  })
}

/** 先整体取负再写，避免撞唯一约束。ids 须是这部作品的全部原文。 */
export function writeSourceOrder(db: Database, projectId: string, ids: readonly string[]): void {
  db.query('UPDATE project_sources SET idx = -1 - idx WHERE project_id = ?').run(projectId)
  const set = db.query('UPDATE project_sources SET idx = ? WHERE id = ? AND project_id = ?')
  ids.forEach((id, index) => set.run(index, id, projectId))
}

export function listSources(db: Database, projectId: string): SourceRow[] {
  return db.query('SELECT * FROM project_sources WHERE project_id = ? ORDER BY idx').all(projectId) as SourceRow[]
}

export function getSource(db: Database, id: string): SourceRow {
  const row = db.query('SELECT * FROM project_sources WHERE id = ?').get(id) as SourceRow | null
  if (!row) throw new NotFound(`原文 ${id}`)
  return row
}

export function episodeText(db: Database, episode: { source_id: string; source_start: number; source_end: number }): string {
  return getSource(db, episode.source_id).text.slice(episode.source_start, episode.source_end)
}

/** 换正文会使这份原文的所有区间作废，由调用方处理。 */
export function writeSource(db: Database, id: string, patch: { name?: string; text?: string }): void {
  db.query(
    `UPDATE project_sources SET
       name       = COALESCE(?, name),
       text       = COALESCE(?, text),
       updated_at = ?
     WHERE id = ?`,
  ).run(patch.name ?? null, patch.text ?? null, nowIso(), id)
}

export function deleteSource(db: Database, id: string): void {
  db.query('DELETE FROM project_sources WHERE id = ?').run(id)
}

/** 回到草稿时保留 `frozen_at`，它记录上一次定稿的时间。 */
export function setPlanState(db: Database, id: string, state: PlanState): void {
  const at = nowIso()
  if (state === 'frozen') {
    db.query('UPDATE project_sources SET plan_state = ?, frozen_at = ?, updated_at = ? WHERE id = ?').run(
      state,
      at,
      at,
      id,
    )
    return
  }
  db.query('UPDATE project_sources SET plan_state = ?, updated_at = ? WHERE id = ?').run(state, at, id)
}

export interface EpisodePlanEntry {
  readonly id: string
  readonly idx: number
  readonly title: string
  readonly synopsis: string
  readonly source_start: number
  readonly source_end: number
}

/** 版本号取最大值 +1，取号与写入在同一事务里。 */
export function insertPlanVersion(db: Database, sourceId: string, plan: readonly EpisodePlanEntry[]): { versionId: string; version: number } {
  return db.transaction(() => {
    const previous = db
      .query('SELECT COALESCE(MAX(version), 0) AS v FROM episode_plan_versions WHERE source_id = ?')
      .get(sourceId) as { v: number }
    const version = previous.v + 1
    const versionId = newId('epv')
    db.query('INSERT INTO episode_plan_versions (id, source_id, version, plan, frozen_at) VALUES (?, ?, ?, ?, ?)').run(
      versionId,
      sourceId,
      version,
      JSON.stringify(plan),
      nowIso(),
    )
    return { versionId, version }
  })()
}

export function latestPlanVersion(db: Database, sourceId: string): { id: string; version: number; plan: EpisodePlanEntry[] } | null {
  const row = db
    .query('SELECT id, version, plan FROM episode_plan_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1')
    .get(sourceId) as { id: string; version: number; plan: string } | null
  if (!row) return null
  return { id: row.id, version: row.version, plan: JSON.parse(row.plan) as EpisodePlanEntry[] }
}
