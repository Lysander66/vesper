/** 工作台统计的查询，每项一条 SQL。 */

import type { JobStatus, OwnerKind } from '@vesper/shared'

import type { Database } from 'bun:sqlite'

import { PROJECT_OF_OWNER, type OwnerRef } from '../db/records'

export function countJobs(db: Database): number {
  return count(db, 'SELECT COUNT(*) AS n FROM jobs')
}

export function countDraftAssets(db: Database): number {
  return count(db, `SELECT COUNT(*) AS n FROM assets WHERE state = 'draft' AND scope = 'project'`)
}

export function countRunningRuns(db: Database): number {
  return count(db, `SELECT COUNT(*) AS n FROM runs WHERE status = 'running'`)
}

/** 有合成版的集数，同一集合成多次只算一集。 */
export function countEpisodesWithFilm(db: Database, projectId: string): number {
  return count(
    db,
    `SELECT COUNT(DISTINCT owner_id) AS n FROM artifacts
      WHERE owner_kind = 'episode' AND kind = 'film' AND owner_id IN (SELECT id FROM episodes WHERE project_id = ?)`,
    projectId,
  )
}

export interface AssetStateCounts {
  readonly locked: number
  readonly drafts: number
}

export function assetStateCounts(db: Database, projectId: string): AssetStateCounts {
  const rows = db
    .query(`SELECT state, COUNT(*) AS n FROM assets WHERE project_id = ? GROUP BY state`)
    .all(projectId) as { state: string; n: number }[]
  return {
    locked: rows.find((row) => row.state === 'locked')?.n ?? 0,
    drafts: rows.find((row) => row.state === 'draft')?.n ?? 0,
  }
}

/** 按集序、镜序取第一张首帧，作封面。 */
export function coverPath(db: Database, projectId: string): string | null {
  const row = db
    .query(
      `SELECT a.path AS path FROM artifacts a
         JOIN shots s ON s.id = a.owner_id
         JOIN episodes e ON e.id = s.episode_id
        WHERE a.owner_kind = 'shot' AND a.kind = 'first_frame' AND a.path IS NOT NULL
          AND e.project_id = ?
        ORDER BY e.idx, s.idx, a.version DESC
        LIMIT 1`,
    )
    .get(projectId) as { path: string } | null
  return row?.path ?? null
}

export function jobStatusCountsSince(db: Database, since: string): { status: JobStatus; n: number }[] {
  return db.query(`SELECT status, COUNT(*) AS n FROM jobs WHERE created_at >= ? GROUP BY status`).all(since) as {
    status: JobStatus
    n: number
  }[]
}

export function callTotalsSince(db: Database, since: string): { n: number; ms: number } {
  return db
    .query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(c.duration_ms), 0) AS ms FROM http_calls c
         JOIN jobs j ON j.id = c.job_id WHERE j.created_at >= ?`,
    )
    .get(since) as { n: number; ms: number }
}

export interface PulseRow {
  readonly id: string
  readonly purpose: string | null
  readonly status: JobStatus
  readonly owner_kind: OwnerKind | null
  readonly owner_id: string | null
  readonly created_at: string
  readonly finished_at: string | null
  readonly calls: number
  readonly ms: number
}

export function jobPulseSince(db: Database, since: string): PulseRow[] {
  return db
    .query(
      `SELECT j.id, j.purpose, j.status, j.owner_kind, j.owner_id, j.created_at, j.finished_at,
              COUNT(c.id) AS calls, COALESCE(SUM(c.duration_ms), 0) AS ms
         FROM jobs j LEFT JOIN http_calls c ON c.job_id = j.id
        WHERE j.created_at >= ?
        GROUP BY j.id ORDER BY j.created_at`,
    )
    .all(since) as PulseRow[]
}

/** 镜头所在的集序与镜序，均从 0 起。 */
export function shotPosition(db: Database, shotId: string): { ep: number; shot: number } | null {
  return db
    .query(`SELECT e.idx AS ep, s.idx AS shot FROM shots s JOIN episodes e ON e.id = s.episode_id WHERE s.id = ?`)
    .get(shotId) as { ep: number; shot: number } | null
}

export function episodeIdx(db: Database, episodeId: string): number | null {
  const row = db.query('SELECT idx FROM episodes WHERE id = ?').get(episodeId) as { idx: number } | null
  return row?.idx ?? null
}

export function assetName(db: Database, assetId: string): string | null {
  const row = db.query('SELECT name FROM assets WHERE id = ?').get(assetId) as { name: string } | null
  return row?.name ?? null
}

export function projectName(db: Database, projectId: string): string | null {
  const row = db.query('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | null
  return row?.name ?? null
}

/** 由归属推出作品。 */
export function ownerProjectId(db: Database, owner: OwnerRef): string | null {
  const row = db.query(`SELECT ${PROJECT_OF_OWNER} AS v FROM (SELECT ? AS owner_kind, ? AS owner_id)`).get(owner.kind, owner.id) as { v: string | null } | null
  return row?.v ?? null
}

export interface LastShotRow {
  readonly project_id: string
  readonly project_name: string
  readonly episode_id: string
  readonly episode_idx: number
  readonly shot_idx: number
  readonly at: string
}

/** 最近一次挂在镜头上的调用，用于「接着做」。 */
export function lastShotJob(db: Database): LastShotRow | null {
  return db
    .query(
      `SELECT p.id AS project_id, p.name AS project_name, e.id AS episode_id, e.idx AS episode_idx,
              s.idx AS shot_idx, j.created_at AS at
         FROM jobs j
         JOIN shots s ON s.id = j.owner_id
         JOIN episodes e ON e.id = s.episode_id
         JOIN projects p ON p.id = e.project_id
        WHERE j.owner_kind = 'shot'
        ORDER BY j.created_at DESC LIMIT 1`,
    )
    .get() as LastShotRow | null
}

function count(db: Database, sql: string, ...params: string[]): number {
  return (db.query(sql).get(...params) as { n: number }).n
}
