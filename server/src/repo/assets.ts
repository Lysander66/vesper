import type { Database } from 'bun:sqlite'

import {
  type AssetCategory,
  type AssetData,
  type AssetFileRole,
  type AssetState,
  type CharacterData,
  type PropData,
  type SceneData,
} from '@vesper/shared'

import { NotFound, nowIso, parseJson } from './common'
import { newId } from '../db/id'

export type AssetScope = 'project' | 'global'

const EMPTY_CHARACTER: CharacterData = {
  aliases: [],
  appearances: 0,
  tier: 'support',
  form: 'human',
  identity: '',
  traits: '',
  outfit: '',
  voice: '',
}

const EMPTY_SCENE: SceneData = { aliases: [], appearances: 0, description: '', lighting: '' }
const EMPTY_PROP: PropData = { aliases: [], appearances: 0, description: '', holder: '' }

const EMPTY: Readonly<Record<AssetCategory, AssetData>> = {
  character: EMPTY_CHARACTER,
  scene: EMPTY_SCENE,
  prop: EMPTY_PROP,
}

export interface AssetRow {
  readonly id: string
  readonly scope: AssetScope
  readonly project_id: string | null
  readonly category: AssetCategory
  readonly name: string
  readonly data: string
  readonly tags: string
  readonly state: AssetState
  readonly sort_order: number | null
  readonly base_id: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface AssetFileRow {
  readonly id: number
  readonly asset_id: string
  readonly role: AssetFileRole
  readonly label: string
  readonly path: string
  readonly job_id: string | null
  readonly created_at: string
}

export interface AssetVersionRow {
  readonly id: string
  readonly asset_id: string
  readonly version: number
  readonly data: string
  readonly files: string
  readonly locked_at: string
}

export interface CreateAssetInput {
  readonly projectId: string | null
  readonly category: AssetCategory
  readonly name: string
  readonly data?: Partial<AssetData> | undefined
  readonly tags?: readonly string[] | undefined
  readonly baseId?: string | undefined
}

export function createAsset(db: Database, input: CreateAssetInput): string {
  const id = newId('asset')
  const at = nowIso()
  db.query(
    `INSERT INTO assets (id, scope, project_id, category, name, data, tags, base_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId === null ? 'global' : 'project',
    input.projectId,
    input.category,
    input.name,
    JSON.stringify({ ...EMPTY[input.category], ...input.data }),
    JSON.stringify(input.tags ?? []),
    input.baseId ?? null,
    at,
    at,
  )
  return id
}

export function deleteAsset(db: Database, id: string): void {
  db.query('DELETE FROM assets WHERE id = ?').run(id)
}

export function listLibraryAssets(db: Database): AssetRow[] {
  return db.query("SELECT * FROM assets WHERE scope = 'global' ORDER BY created_at DESC").all() as AssetRow[]
}

export function findLibraryAsset(db: Database, category: AssetCategory, name: string): AssetRow | null {
  return db.query("SELECT * FROM assets WHERE scope = 'global' AND category = ? AND name = ?").get(category, name) as AssetRow | null
}

export function findProjectAsset(db: Database, projectId: string, category: AssetCategory, name: string): AssetRow | null {
  return db.query('SELECT * FROM assets WHERE project_id = ? AND category = ? AND name = ?').get(projectId, category, name) as AssetRow | null
}

/** 每种设定图类型当前在用的那张，即该类型最新的一行。 */
export function currentAssetFiles(db: Database, assetId: string): AssetFileRow[] {
  const files = listAssetFiles(db, assetId)
  return files.filter((f, i) => files.findIndex((g) => g.role === f.role) === i)
}

export function getAsset(db: Database, id: string): AssetRow {
  const row = findAsset(db, id)
  if (!row) throw new NotFound(`资产 ${id}`)
  return row
}

export function findAsset(db: Database, id: string): AssetRow | null {
  return db.query('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | null
}

/** 只列这部作品自己的，不含素材库。 */
export function listAssets(db: Database, projectId: string, category?: AssetCategory): AssetRow[] {
  const sql = `SELECT * FROM assets WHERE project_id = ? ${category ? 'AND category = ?' : ''} ORDER BY name`
  return (category ? db.query(sql).all(projectId, category) : db.query(sql).all(projectId)) as AssetRow[]
}

/** ids 之外的同类资产清空顺序；传空数组即恢复默认顺序。 */
export function reorderAssets(db: Database, projectId: string, category: AssetCategory, ids: readonly string[]): void {
  db.transaction(() => {
    db.query('UPDATE assets SET sort_order = NULL WHERE project_id = ? AND category = ?').run(projectId, category)
    const set = db.query('UPDATE assets SET sort_order = ? WHERE id = ? AND project_id = ? AND category = ?')
    ids.forEach((id, index) => set.run(index, id, projectId, category))
  })()
}

/** 按类别把缺的字段补齐：存进去的 JSON 无类型，当成另一类读会静默拿到 undefined。 */
function filled<D extends AssetData>(empty: D, json: string): D {
  return { ...empty, ...parseJson<Partial<D>>(json, {}) }
}

export function dataOf(asset: AssetRow): AssetData {
  return filled(EMPTY[asset.category], asset.data)
}

export function characterOf(asset: AssetRow): CharacterData {
  return filled(EMPTY_CHARACTER, asset.data)
}

export function sceneOf(asset: AssetRow): SceneData {
  return filled(EMPTY_SCENE, asset.data)
}

export function propOf(asset: AssetRow): PropData {
  return filled(EMPTY_PROP, asset.data)
}

/** 整份覆盖。合并当前值与拦截已锁定资产由调用方负责。 */
export function writeAssetData(db: Database, id: string, data: AssetData): void {
  db.query('UPDATE assets SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), nowIso(), id)
}

export function setAssetState(db: Database, assetId: string, state: AssetState): void {
  db.query('UPDATE assets SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), assetId)
}

export function insertAssetFile(db: Database, assetId: string, file: { role: AssetFileRole; label?: string | undefined; path: string; jobId?: string | undefined }): void {
  db.query(
    `INSERT INTO asset_files (asset_id, role, label, path, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(assetId, file.role, file.label ?? '', file.path, file.jobId ?? null, nowIso())
}

/** 新的在前。 */
export function listAssetFiles(db: Database, assetId: string): AssetFileRow[] {
  return db.query('SELECT * FROM asset_files WHERE asset_id = ? ORDER BY id DESC').all(assetId) as AssetFileRow[]
}

export function getAssetFile(db: Database, assetId: string, fileId: number): AssetFileRow {
  const row = db.query('SELECT * FROM asset_files WHERE id = ? AND asset_id = ?').get(fileId, assetId) as AssetFileRow | null
  if (!row) throw new NotFound(`资产图 ${fileId}`)
  return row
}

/** 参考图的优先顺序。参考图名额有限，多数情况下每样资产只取第一张。 */
export const REFERENCE_ROLES: readonly AssetFileRole[] = [
  'full_body',
  'establishing',
  'object',
  'portrait',
  'turnaround',
  'outfit',
]

export interface LockedVersion {
  readonly versionId: string
  readonly version: number
  readonly category: AssetCategory
  readonly name: string
  /** 画面与台词里的称呼。换装取本体的名字。 */
  readonly person: string
  /** 锁定时的设定，形状由 category 决定。 */
  readonly data: AssetData
  readonly files: readonly { role: AssetFileRole; label: string; path: string }[]
}

/** 锁定版里的角色设定。镜头引用的是版本，文本锚点从版本取。 */
export function characterIn(version: LockedVersion): CharacterData {
  return { ...EMPTY_CHARACTER, ...(version.data as Partial<CharacterData>) }
}

/** 文本锚点，逐字拼进首帧提示词。只含可画的外观描述，不含名字。 */
export function anchorText(version: LockedVersion): string {
  const data = version.data
  if (version.category === 'scene') {
    const scene = data as SceneData
    return [scene.description, scene.lighting].map(trimTail).filter((s) => s !== '').join('，')
  }
  if (version.category === 'prop') return trimTail((data as PropData).description)
  return trimTail(characterIn(version).traits)
}

/** 去掉句末标点，拼接时才不会出现「。，」。 */
function trimTail(text: string): string {
  return text.trim().replace(/[，。；、]+$/, '')
}

/** 版本号取最大值 +1，取号与写入在同一事务里。 */
export function insertAssetVersion(db: Database, assetId: string, data: AssetData, files: LockedVersion['files']): { versionId: string; version: number } {
  return db.transaction(() => {
    const previous = db
      .query('SELECT COALESCE(MAX(version), 0) AS v FROM asset_versions WHERE asset_id = ?')
      .get(assetId) as { v: number }
    const version = previous.v + 1
    const versionId = newId('av')
    db.query(`INSERT INTO asset_versions (id, asset_id, version, data, files, locked_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      versionId,
      assetId,
      version,
      JSON.stringify(data),
      JSON.stringify(files),
      nowIso(),
    )
    return { versionId, version }
  })()
}

export function hasAssetVersion(db: Database, versionId: string, assetId: string): boolean {
  return db.query('SELECT id FROM asset_versions WHERE id = ? AND asset_id = ?').get(versionId, assetId) !== null
}

export function getAssetVersion(db: Database, versionId: string): LockedVersion {
  const row = db
    .query(
      `SELECT v.*, a.category, a.name, b.name AS base_name FROM asset_versions v JOIN assets a ON a.id = v.asset_id
       LEFT JOIN assets b ON b.id = a.base_id WHERE v.id = ?`,
    )
    .get(versionId) as (AssetVersionRow & { category: AssetCategory; name: string; base_name: string | null }) | null
  if (!row) throw new NotFound(`资产版本 ${versionId}`)
  return {
    versionId: row.id,
    version: row.version,
    category: row.category,
    name: row.name,
    person: row.base_name ?? row.name,
    data: filled(EMPTY[row.category], row.data),
    files: parseJson<LockedVersion['files']>(row.files, []),
  }
}

export function latestVersionOf(db: Database, assetId: string): AssetVersionRow | null {
  return db
    .query('SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version DESC LIMIT 1')
    .get(assetId) as AssetVersionRow | null
}

/** 参考图路径。指定 look 时先取那一张，缺了按固定顺序取。默认只取一张，避免一镜引用多样资产时超出端点的参考图上限。 */
export function referenceImages(version: LockedVersion, limit = 1, look?: AssetFileRole): string[] {
  const roles = look !== undefined && REFERENCE_ROLES.includes(look) ? [look, ...REFERENCE_ROLES.filter((r) => r !== look)] : REFERENCE_ROLES
  return roles.flatMap((role) => version.files.filter((f) => f.role === role).map((f) => f.path)).slice(0, limit)
}

export function roleOfImage(version: LockedVersion, path: string): AssetFileRole | undefined {
  return version.files.find((f) => f.path === path)?.role
}
