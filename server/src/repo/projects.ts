/** projects、episodes 两张表的读写。 */

import type { Database } from 'bun:sqlite'

import type { Aspect, AudioMode, Beat, BeatsState, ContinuityMode, Review } from '@vesper/shared'

import { NotFound, nowIso } from './common'
import { newId } from '../db/id'

export interface ProjectRow {
  readonly id: string
  readonly name: string
  /** 0 表示不限，合成版长度由节拍数决定。 */
  readonly target_seconds: number
  readonly speech_rate: number
  /** 单镜时长的目标区间。台词念不完时可以超过上界。 */
  readonly shot_min_seconds: number
  readonly shot_max_seconds: number
  readonly style: string
  readonly aspect: Aspect
  readonly audio_mode: AudioMode
  readonly continuity_mode: ContinuityMode
  readonly created_at: string
  readonly updated_at: string
}

export interface EpisodeRow {
  readonly id: string
  readonly project_id: string
  /** 区间是这份原文里的下标。 */
  readonly source_id: string
  readonly idx: number
  readonly title: string
  readonly synopsis: string
  readonly source_start: number
  readonly source_end: number
  /** Beat[] 的 JSON。 */
  readonly beats: string
  readonly beats_state: BeatsState
  /** Review 的 JSON。空串表示没审过，或节拍、分镜改过后已作废。 */
  readonly review: string
  readonly created_at: string
  readonly updated_at: string
}

export interface CreateProjectInput {
  readonly name: string
  readonly targetSeconds?: number
  readonly speechRate?: number
  readonly shotSeconds?: ShotSeconds
  readonly style?: string
  readonly aspect?: Aspect
  readonly audioMode?: AudioMode
  readonly continuityMode?: ContinuityMode
}

export interface ShotSeconds {
  readonly min: number
  readonly max: number
}

export const DEFAULT_SHOT_SECONDS: ShotSeconds = { min: 5, max: 10 }

export function shotSecondsOf(project: ProjectRow): ShotSeconds {
  return { min: project.shot_min_seconds, max: project.shot_max_seconds }
}

export function createProject(db: Database, input: CreateProjectInput): string {
  const id = newId('proj')
  const at = nowIso()
  db.query(
    `INSERT INTO projects
       (id, name, target_seconds, speech_rate,
        shot_min_seconds, shot_max_seconds, style, aspect, audio_mode, continuity_mode,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    // 默认不限时长，由节拍数决定；给定数字模型会去凑它。
    input.targetSeconds ?? 0,
    input.speechRate ?? 5.0,
    input.shotSeconds?.min ?? DEFAULT_SHOT_SECONDS.min,
    input.shotSeconds?.max ?? DEFAULT_SHOT_SECONDS.max,
    input.style ?? '',
    input.aspect ?? '16:9',
    // 视频端点不出声时会自动改为单独配音。
    input.audioMode ?? 'native',
    input.continuityMode ?? 'chain',
    at,
    at,
  )
  return id
}

export function getProject(db: Database, id: string): ProjectRow {
  const row = findProject(db, id)
  if (!row) throw new NotFound(`项目 ${id}`)
  return row
}

export function findProject(db: Database, id: string): ProjectRow | null {
  return db.query('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | null
}

export function listProjects(db: Database): ProjectRow[] {
  return db.query('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[]
}

export interface ProjectPatch {
  readonly name?: string | undefined
  readonly targetSeconds?: number | undefined
  readonly speechRate?: number | undefined
  readonly shotSeconds?: ShotSeconds | undefined
  readonly style?: string | undefined
  readonly aspect?: Aspect | undefined
  readonly audioMode?: AudioMode | undefined
  readonly continuityMode?: ContinuityMode | undefined
}

/** 只改 patch 里给出的字段。 */
export function writeProject(db: Database, id: string, patch: ProjectPatch): void {
  db.query(
    `UPDATE projects SET
       name           = COALESCE(?, name),
       target_seconds = COALESCE(?, target_seconds),
       speech_rate    = COALESCE(?, speech_rate),
       shot_min_seconds = COALESCE(?, shot_min_seconds),
       shot_max_seconds = COALESCE(?, shot_max_seconds),
       style          = COALESCE(?, style),
       aspect         = COALESCE(?, aspect),
       audio_mode     = COALESCE(?, audio_mode),
       continuity_mode = COALESCE(?, continuity_mode),
       updated_at     = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? null,
    patch.targetSeconds ?? null,
    patch.speechRate ?? null,
    patch.shotSeconds?.min ?? null,
    patch.shotSeconds?.max ?? null,
    patch.style ?? null,
    patch.aspect ?? null,
    patch.audioMode ?? null,
    patch.continuityMode ?? null,
    nowIso(),
    id,
  )
}

export interface EpisodeDraft {
  readonly title: string
  readonly synopsis: string
  readonly sourceStart: number
  readonly sourceEnd: number
}

/** 改一集的分集字段，保留 id，节拍与镜头随之保留。 */
export function writeEpisodePlan(db: Database, id: string, draft: EpisodeDraft): void {
  db.query(
    'UPDATE episodes SET title = ?, synopsis = ?, source_start = ?, source_end = ?, updated_at = ? WHERE id = ?',
  ).run(draft.title, draft.synopsis, draft.sourceStart, draft.sourceEnd, nowIso(), id)
}

export function deleteEpisode(db: Database, id: string): void {
  db.query('DELETE FROM episodes WHERE id = ?').run(id)
}

/** 写入一份原文的分集，集号接在作品现有最大集号之后。 */
export function insertEpisodes(db: Database, projectId: string, sourceId: string, drafts: readonly EpisodeDraft[]): string[] {
  const at = nowIso()
  const base = (db.query('SELECT COALESCE(MAX(idx) + 1, 0) AS n FROM episodes WHERE project_id = ?').get(projectId) as {
    n: number
  }).n
  return drafts.map((draft, offset) => {
    const id = newId('ep')
    db.query(
      `INSERT INTO episodes
         (id, project_id, source_id, idx, title, synopsis, source_start, source_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, sourceId, base + offset, draft.title, draft.synopsis, draft.sourceStart, draft.sourceEnd, at, at)
    return id
  })
}

/** 重排全局集号，返回从第几集起变了号（1 起），没变回 null。先整体取负再赋值，避免逐行校验撞唯一约束。 */
export function renumberEpisodes(db: Database, projectId: string): number | null {
  const ordered = db
    .query(
      `SELECT e.idx AS idx FROM episodes e JOIN project_sources s ON s.id = e.source_id
       WHERE e.project_id = ? ORDER BY s.idx, e.source_start`,
    )
    .all(projectId) as { idx: number }[]

  const from = ordered.findIndex((row, n) => row.idx !== n)
  if (from === -1) return null

  db.query('UPDATE episodes SET idx = -1 - idx WHERE project_id = ?').run(projectId)
  db.query(
    `WITH ordered AS (
       SELECT e.id AS id, ROW_NUMBER() OVER (ORDER BY s.idx, e.source_start) - 1 AS n
       FROM episodes e JOIN project_sources s ON s.id = e.source_id
       WHERE e.project_id = ?
     )
     UPDATE episodes SET idx = (SELECT n FROM ordered WHERE ordered.id = episodes.id)
     WHERE project_id = ?`,
  ).run(projectId, projectId)
  return from + 1
}

export function touchProject(db: Database, projectId: string): void {
  db.query('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId)
}

export function listEpisodes(db: Database, projectId: string): EpisodeRow[] {
  return db.query('SELECT * FROM episodes WHERE project_id = ? ORDER BY idx').all(projectId) as EpisodeRow[]
}

export function listEpisodesOf(db: Database, sourceId: string): EpisodeRow[] {
  return db.query('SELECT * FROM episodes WHERE source_id = ? ORDER BY source_start').all(sourceId) as EpisodeRow[]
}

export function getEpisode(db: Database, id: string): EpisodeRow {
  const row = findEpisode(db, id)
  if (!row) throw new NotFound(`分集 ${id}`)
  return row
}

/** 没起标题的集按集号称呼。 */
export function episodeTitle(episode: EpisodeRow): string {
  return episode.title || `第 ${episode.idx + 1} 集`
}

export function findEpisode(db: Database, id: string): EpisodeRow | null {
  return db.query('SELECT * FROM episodes WHERE id = ?').get(id) as EpisodeRow | null
}

/** 重写节拍，确认状态回到 draft，审查作废。 */
export function setEpisodeBeats(db: Database, id: string, beats: readonly Beat[]): void {
  db.query(`UPDATE episodes SET beats = ?, beats_state = 'draft', review = '', updated_at = ? WHERE id = ?`).run(
    JSON.stringify(beats),
    nowIso(),
    id,
  )
}

export function setEpisodeReview(db: Database, id: string, review: Review | null): void {
  db.query('UPDATE episodes SET review = ?, updated_at = ? WHERE id = ?').run(review ? JSON.stringify(review) : '', nowIso(), id)
}

export function setBeatsState(db: Database, id: string, state: BeatsState): void {
  db.query('UPDATE episodes SET beats_state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), id)
}

