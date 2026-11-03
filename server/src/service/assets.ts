/** 资产锁定的规则：锁定前要有图、锁定后不许改、镜头引用的资产必须已锁定。 */

import type { Database } from 'bun:sqlite'

import type { AssetCategory, AssetData, AssetFileRole, CharacterData, LockBatch, ShotRef } from '@vesper/shared'

import { Conflict } from '../domain/errors'
import { characterIn, characterOf, createAsset, dataOf, deleteAsset, findProjectAsset, getAssetVersion, latestVersionOf, findAsset, getAsset, hasAssetVersion, getAssetFile, insertAssetFile, insertAssetVersion, listAssetFiles, listAssets, setAssetState, writeAssetData, REFERENCE_ROLES, type AssetRow, type LockedVersion } from '../repo/assets'
import { getProject } from '../repo/projects'

/** 生成设定图要用作品的绑定与产物目录，素材库里的资产需先复制进作品。 */
export function projectOf(db: Database, assetId: string): string {
  const asset = getAsset(db, assetId)
  if (asset.project_id === null) throw new Conflict(`「${asset.name}」在素材库里，先复制到作品再生成`)
  return asset.project_id
}

/** 新建作品自己的资产。同一类别下名字不能重。 */
export function createProjectAsset(db: Database, projectId: string, input: { category: AssetCategory; name: string; data?: Record<string, unknown> | undefined }): string {
  getProject(db, projectId)
  if (findProjectAsset(db, projectId, input.category, input.name) !== null) throw new Conflict(`已有「${input.name}」`)
  return createAsset(db, { projectId, category: input.category, name: input.name, ...(input.data ? { data: input.data } : {}) })
}

function assertEditable(asset: AssetRow): void {
  if (asset.state === 'locked') throw new Conflict('已锁定，请先解锁')
}

export function updateAssetData(db: Database, id: string, patch: Partial<AssetData>): void {
  const asset = getAsset(db, id)
  assertEditable(asset)
  writeAssetData(db, id, { ...dataOf(asset), ...patch })
}

export function removeAsset(db: Database, id: string): void {
  assertEditable(getAsset(db, id))
  deleteAsset(db, id)
}

export function addAssetFile(db: Database, assetId: string, file: { role: AssetFileRole; label?: string | undefined; path: string; jobId?: string | undefined }): void {
  assertEditable(getAsset(db, assetId))
  insertAssetFile(db, assetId, file)
}

/** 旧图按原路径再插一行成为当前，不覆盖。 */
export function restoreAssetFile(db: Database, assetId: string, fileId: number): void {
  assertEditable(getAsset(db, assetId))
  const file = getAssetFile(db, assetId, fileId)
  if (listAssetFiles(db, assetId).find((f) => f.role === file.role)?.id === file.id) throw new Conflict('已经是当前这张')
  insertAssetFile(db, assetId, { role: file.role, label: file.label, path: file.path, jobId: file.job_id ?? undefined })
}

/** 锁定即保存一份快照。至少要有一张参考图，只靠文字描述各镜画出的脸会不一致。 */
export function lockAsset(db: Database, assetId: string): LockedVersion {
  const asset = getAsset(db, assetId)
  if (asset.state === 'locked') throw new Conflict('已经锁定了')

  const files = listAssetFiles(db, assetId)
  if (!files.some((f) => REFERENCE_ROLES.includes(f.role))) {
    throw new Conflict('锁定前至少要有一张设定图，先生成再锁定')
  }

  const own = { data: dataOf(asset), files: files.map((f) => ({ role: f.role, label: f.label, path: f.path })) }
  const { data, files: snapshot } = asset.base_id === null ? own : withBase(db, asset.base_id, own)
  return db.transaction(() => {
    const { versionId, version } = insertAssetVersion(db, assetId, data, snapshot)
    setAssetState(db, assetId, 'locked')
    const person = asset.base_id === null ? asset.name : getAsset(db, asset.base_id).name
    return { versionId, version, category: asset.category, name: asset.name, person, data, files: snapshot }
  })()
}

/** 换装的快照带上本体锁定版的外貌、身份、声音与试音：镜头只引用换装这一版。 */
function withBase(db: Database, baseId: string, own: { data: AssetData; files: LockedVersion['files'] }): { data: AssetData; files: LockedVersion['files'] } {
  const base = getAsset(db, baseId)
  const locked = base.state === 'locked' ? latestVersionOf(db, baseId) : null
  if (locked === null) throw new Conflict(`先锁定「${base.name}」：换装的外貌与声音取自它的锁定版`)
  const from = getAssetVersion(db, locked.id)
  const person = characterIn(from)
  const sample = from.files.find((f) => f.role === 'voice_sample')
  return {
    data: { ...(own.data as CharacterData), tier: person.tier, identity: person.identity, traits: person.traits, voice: person.voice },
    files: [...own.files.filter((f) => f.role !== 'voice_sample'), ...(sample ? [sample] : [])],
  }
}

/** 换装是挂在本体下的另一件角色资产，名为「本体·装扮」，自己只存服装。 */
export function createCostume(db: Database, baseId: string, label: string, outfit: string): string {
  const base = getAsset(db, baseId)
  if (base.category !== 'character' || base.base_id !== null) throw new Conflict('只有角色本体能加换装')
  if (base.project_id === null) throw new Conflict(`「${base.name}」在素材库里，先复制到作品再加换装`)
  const name = `${base.name}·${label.trim()}`
  if (findProjectAsset(db, base.project_id, 'character', name) !== null) throw new Conflict(`已有「${name}」`)
  return createAsset(db, { projectId: base.project_id, category: 'character', name, data: { tier: characterOf(base).tier, outfit }, baseId })
}

/** 按类别批量锁定，没图的跳过。 */
export function lockAssets(db: Database, projectId: string, category?: AssetCategory): LockBatch {
  // 本体在前：换装要抄本体的锁定版。
  const todo = listAssets(db, projectId, category)
    .filter((asset) => asset.state !== 'locked')
    .sort((a, b) => Number(a.base_id !== null) - Number(b.base_id !== null))
  const names: string[] = []
  for (const asset of todo) {
    if (!listAssetFiles(db, asset.id).some((f) => REFERENCE_ROLES.includes(f.role))) continue
    if (asset.base_id !== null && getAsset(db, asset.base_id).state !== 'locked') continue
    lockAsset(db, asset.id)
    names.push(asset.name)
  }
  return { locked: names, skipped: todo.length - names.length }
}

/** 只改资产状态，已有版本仍被镜头引用。 */
export function unlockAsset(db: Database, assetId: string): void {
  const asset = getAsset(db, assetId)
  if (asset.state === 'draft') throw new Conflict('当前未锁定')
  setAssetState(db, assetId, 'draft')
}

/** 镜头引用的资产必须存在、已锁定且版本有效，否则报错。 */
export function assertRefsLocked(db: Database, refs: readonly ShotRef[]): void {
  const problems: string[] = []
  for (const ref of refs) {
    const asset = findAsset(db, ref.asset_id)
    if (!asset) {
      problems.push(`${ref.name}（资产已不存在）`)
      continue
    }
    if (asset.state !== 'locked') {
      problems.push(`${asset.name}（未锁定）`)
      continue
    }
    if (!hasAssetVersion(db, ref.version_id, ref.asset_id)) problems.push(`${asset.name}（引用的版本不存在）`)
  }
  if (problems.length > 0) {
    throw new Conflict(`以下资产无法引用：${problems.join('、')}`)
  }
}
