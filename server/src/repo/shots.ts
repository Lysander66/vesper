import type { Database } from 'bun:sqlite'

import { NotFound, nowIso, parseJson } from './common'
import { newId } from '../db/id'
import { parseUtterances } from '../domain/beats'
import type { ShotView } from '../domain/progress'
import type { OwnerRef } from '../db/records'
import type { ArtifactKind, ArtifactOwner, ArtifactState, CameraMove, ClipSource, JobStatus, ShotJoin, ShotRef, ShotSize, Utterance } from '@vesper/shared'

export interface ShotRow {
  readonly id: string
  readonly episode_id: string
  readonly idx: number
  readonly summary: string
  readonly scene: string
  readonly camera: string
  readonly shot_size: ShotSize
  readonly camera_move: CameraMove
  readonly mood: string
  readonly join_mode: ShotJoin
  readonly clip_source: ClipSource
  readonly image_prompt: string
  readonly motion_prompt: string
  readonly sound: string
  /** Utterance[] 的 JSON。 */
  readonly utterances: string
  readonly seconds: number
  readonly cast: string
  /** ShotRef 的 JSON，空串表示不需要场景参考图。 */
  readonly scene_ref: string
  readonly props: string
  readonly beat_index: number
  readonly created_at: string
  readonly updated_at: string
}

export interface ArtifactRow {
  readonly id: string
  readonly owner_kind: 'shot' | 'episode'
  readonly owner_id: string
  readonly kind: ArtifactKind
  readonly version: number
  readonly state: ArtifactState
  readonly path: string | null
  readonly job_id: string | null
  readonly command_id: string | null
  readonly created_at: string
}

export interface ShotDraft {
  readonly summary: string
  readonly scene: string
  readonly camera: string
  readonly shotSize: ShotSize
  readonly cameraMove: CameraMove
  readonly mood: string
  readonly joinMode: ShotJoin
  readonly clipSource: ClipSource
  readonly imagePrompt: string
  readonly motionPrompt: string
  readonly utterances: readonly Utterance[]
  readonly seconds: number
  readonly cast: readonly ShotRef[]
  /** null 表示不需要场景参考图。 */
  readonly sceneRef: ShotRef | null
  readonly props: readonly ShotRef[]
  readonly beatIndex: number
}

export function replaceShots(db: Database, episodeId: string, drafts: readonly ShotDraft[]): string[] {
  return db.transaction(() => {
    dropShotArtifacts(db, listShots(db, episodeId).map((shot) => shot.id))
    db.query('DELETE FROM shots WHERE episode_id = ?').run(episodeId)
    const at = nowIso()
    const ids: string[] = []
    drafts.forEach((draft, idx) => {
      const id = newId('shot')
      db.query(
        `INSERT INTO shots
           (id, episode_id, idx, summary, scene, camera, shot_size, camera_move, mood, join_mode, clip_source,
            image_prompt, motion_prompt,
            utterances, seconds, cast, scene_ref, props, beat_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        episodeId,
        idx,
        draft.summary,
        draft.scene,
        draft.camera,
        draft.shotSize,
        draft.cameraMove,
        draft.mood,
        draft.joinMode,
        draft.clipSource,
        draft.imagePrompt,
        draft.motionPrompt,
        JSON.stringify(draft.utterances),
        draft.seconds,
        JSON.stringify(draft.cast),
        draft.sceneRef === null ? '' : JSON.stringify(draft.sceneRef),
        JSON.stringify(draft.props),
        draft.beatIndex,
        at,
        at,
      )
      ids.push(id)
    })
    return ids
  })()
}

export function listShots(db: Database, episodeId: string): ShotRow[] {
  return db.query('SELECT * FROM shots WHERE episode_id = ? ORDER BY idx').all(episodeId) as ShotRow[]
}

/** artifacts 没有指向 shots 的外键，删镜头时一并删产物记录，文件保留。 */
function dropShotArtifacts(db: Database, shotIds: readonly string[]): void {
  for (const id of shotIds) {
    db.query("DELETE FROM artifacts WHERE owner_kind = 'shot' AND owner_id = ?").run(id)
  }
}

/** 先整体取负再写回，避免逐行改时撞唯一约束。 */
function reindex(db: Database, episodeId: string, orderedIds: readonly string[]): void {
  db.query('UPDATE shots SET idx = -1 - idx WHERE episode_id = ?').run(episodeId)
  orderedIds.forEach((id, idx) => db.query('UPDATE shots SET idx = ? WHERE id = ?').run(idx, id))
}

/** `afterShotId` 为 null 即插在最前面。时长取相邻镜头的，这一集没有镜头时用 `fallbackSeconds`。 */
export function insertShotAfter(db: Database, episodeId: string, afterShotId: string | null, fallbackSeconds: number): string {
  return db.transaction(() => {
    const shots = listShots(db, episodeId)
    const at = afterShotId === null ? -1 : shots.findIndex((shot) => shot.id === afterShotId)
    if (at < 0 && afterShotId !== null) throw new NotFound(`分镜 ${afterShotId}`)

    const now = nowIso()
    const id = newId('shot')
    db.query(
      `INSERT INTO shots
         (id, episode_id, idx, summary, scene, camera, image_prompt, motion_prompt,
          utterances, seconds, cast, scene_ref, props, beat_index, created_at, updated_at)
       VALUES (?, ?, ?, '', '', '', '', '', '[]', ?, '[]', '', '[]', -1, ?, ?)`,
    ).run(id, episodeId, shots.length, shots[at]?.seconds ?? shots[0]?.seconds ?? fallbackSeconds, now, now)

    const ids = shots.map((shot) => shot.id)
    ids.splice(at + 1, 0, id)
    reindex(db, episodeId, ids)
    return id
  })()
}

export function deleteShot(db: Database, shot: ShotRow): void {
  db.transaction(() => {
    dropShotArtifacts(db, [shot.id])
    db.query('DELETE FROM shots WHERE id = ?').run(shot.id)
    reindex(
      db,
      shot.episode_id,
      listShots(db, shot.episode_id).map((row) => row.id),
    )
  })()
}

export function getShot(db: Database, id: string): ShotRow {
  const row = findShot(db, id)
  if (!row) throw new NotFound(`分镜 ${id}`)
  return row
}

export function findShot(db: Database, id: string): ShotRow | null {
  return db.query('SELECT * FROM shots WHERE id = ?').get(id) as ShotRow | null
}

/** 同一集里的上一镜，第一镜回 null。 */
export function previousShot(db: Database, shot: ShotRow): ShotRow | null {
  return db
    .query('SELECT * FROM shots WHERE episode_id = ? AND idx < ? ORDER BY idx DESC LIMIT 1')
    .get(shot.episode_id, shot.idx) as ShotRow | null
}

export function castOf(shot: ShotRow): ShotRef[] {
  return parseJson<ShotRef[]>(shot.cast, [])
}

export function sceneRefOf(shot: ShotRow): ShotRef | null {
  return shot.scene_ref === '' ? null : parseJson<ShotRef | null>(shot.scene_ref, null)
}

export function propsOf(shot: ShotRow): ShotRef[] {
  return parseJson<ShotRef[]>(shot.props, [])
}

/** 这一镜引用的全部资产，顺序即参考图顺序：场景、人物、道具。 */
export function refsOf(shot: ShotRow): ShotRef[] {
  const scene = sceneRefOf(shot)
  return [...(scene ? [scene] : []), ...castOf(shot), ...propsOf(shot)]
}

export function utterancesOf(shot: ShotRow): Utterance[] {
  return parseUtterances(shot.utterances)
}

export interface ShotPatch {
  readonly summary?: string | undefined
  readonly scene?: string | undefined
  readonly camera?: string | undefined
  readonly shotSize?: ShotSize | undefined
  readonly cameraMove?: CameraMove | undefined
  readonly mood?: string | undefined
  readonly joinMode?: ShotJoin | undefined
  readonly clipSource?: ClipSource | undefined
  readonly imagePrompt?: string | undefined
  readonly motionPrompt?: string | undefined
  readonly sound?: string | undefined
  readonly utterances?: readonly Utterance[] | undefined
  readonly seconds?: number | undefined
  readonly cast?: readonly ShotRef[] | undefined
  /** null 表示去掉场景参考图。 */
  readonly sceneRef?: ShotRef | null | undefined
  readonly props?: readonly ShotRef[] | undefined
}

const PATCH_TO_COLUMN: Readonly<Record<keyof ShotPatch, string>> = {
  summary: 'summary',
  scene: 'scene',
  camera: 'camera',
  shotSize: 'shot_size',
  cameraMove: 'camera_move',
  mood: 'mood',
  joinMode: 'join_mode',
  clipSource: 'clip_source',
  imagePrompt: 'image_prompt',
  motionPrompt: 'motion_prompt',
  sound: 'sound',
  utterances: 'utterances',
  seconds: 'seconds',
  cast: 'cast',
  sceneRef: 'scene_ref',
  props: 'props',
}

/** 只写值有变化的列，返回变了的列名。 */
export function writeShot(db: Database, id: string, patch: ShotPatch): string[] {
  const shot = getShot(db, id)

  const changed: string[] = []
  const sets: string[] = []
  const values: (string | number)[] = []
  for (const [key, column] of Object.entries(PATCH_TO_COLUMN) as [keyof ShotPatch, string][]) {
    const value = patch[key]
    if (value === undefined) continue
    // 只有 sceneRef 会传 null，落库为空串。
    const next =
      value === null
        ? ''
        : typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? value
            : JSON.stringify(value)
    if (next === shot[column as keyof ShotRow]) continue
    sets.push(`${column} = ?`)
    values.push(next)
    changed.push(column)
  }
  if (sets.length === 0) return []

  db.query(`UPDATE shots SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id)
  return changed
}

/** 追加新版本，旧版保留。版本号取最大值 +1，取号与写入在同一事务里。 */
export function insertArtifact(db: Database, owner: ArtifactOwner, kind: ArtifactKind, row: { state: ArtifactState; path: string | null; jobId?: string | null | undefined; commandId?: string | null | undefined }): ArtifactRow {
  return db.transaction(() => {
    const previous = db
      .query('SELECT COALESCE(MAX(version), 0) AS v FROM artifacts WHERE owner_kind = ? AND owner_id = ? AND kind = ?')
      .get(owner.kind, owner.id, kind) as { v: number }
    const id = newId('art')
    db.query(
      `INSERT INTO artifacts (id, owner_kind, owner_id, kind, version, state, path, job_id, command_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      owner.kind,
      owner.id,
      kind,
      previous.v + 1,
      row.state,
      row.path,
      row.jobId ?? null,
      row.commandId ?? null,
      nowIso(),
    )
    return db.query('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow
  })()
}

export function recordArtifact(db: Database, owner: ArtifactOwner, kind: ArtifactKind, source: { path: string; jobId?: string | undefined; commandId?: string | undefined }): ArtifactRow {
  return insertArtifact(db, owner, kind, { state: 'fresh', ...source })
}

export function markStale(db: Database, owner: ArtifactOwner, kinds: readonly ArtifactKind[]): number {
  if (kinds.length === 0) return 0
  const holes = kinds.map(() => '?').join(', ')
  const result = db
    .query(
      `UPDATE artifacts SET state = 'stale'
       WHERE owner_kind = ? AND owner_id = ? AND kind IN (${holes}) AND state = 'fresh'`,
    )
    .run(owner.kind, owner.id, ...kinds)
  return result.changes
}

/** 每个产物位的当前版本。 */
export function currentArtifacts(db: Database, owner: ArtifactOwner): ArtifactRow[] {
  return db
    .query(
      `SELECT a.* FROM artifacts a
       JOIN (SELECT kind, MAX(version) AS v FROM artifacts
             WHERE owner_kind = ? AND owner_id = ? GROUP BY kind) latest
         ON a.kind = latest.kind AND a.version = latest.v
       WHERE a.owner_kind = ? AND a.owner_id = ?`,
    )
    .all(owner.kind, owner.id, owner.kind, owner.id) as ArtifactRow[]
}

export function artifactHistory(db: Database, owner: ArtifactOwner, kind: ArtifactKind): ArtifactRow[] {
  return db
    .query('SELECT * FROM artifacts WHERE owner_kind = ? AND owner_id = ? AND kind = ? ORDER BY version DESC')
    .all(owner.kind, owner.id, kind) as ArtifactRow[]
}

/** 各产物位最近一次生成的状态。 */
function latestJobStatuses(db: Database, owner: OwnerRef): Partial<Record<ArtifactKind, JobStatus>> {
  const rows = db
    .query(
      `SELECT purpose, status FROM jobs
       WHERE owner_kind = ? AND owner_id = ? AND purpose IS NOT NULL
       ORDER BY created_at`,
    )
    .all(owner.kind, owner.id) as { purpose: string; status: JobStatus }[]
  const out: Partial<Record<ArtifactKind, JobStatus>> = {}
  for (const row of rows) out[row.purpose as ArtifactKind] = row.status
  return out
}

/** 组装进度计算需要的镜头视图。 */
export function shotViews(db: Database, episodeId: string): ShotView[] {
  return listShots(db, episodeId).map((shot) => ({
    id: shot.id,
    utterances: utterancesOf(shot),
    seconds: shot.seconds,
    clipSource: shot.clip_source,
    artifacts: currentArtifacts(db, { kind: 'shot', id: shot.id }).map((a) => ({ kind: a.kind, state: a.state })),
    jobs: latestJobStatuses(db, { kind: 'shot', id: shot.id }),
  }))
}
