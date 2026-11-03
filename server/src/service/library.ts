/** 素材库：跨作品复用的角色、场景、道具。存入与取用都是复制一份，两边各改各的，互不牵连。 */

import type { AssetData } from '@vesper/shared'

import type { Database } from 'bun:sqlite'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Conflict } from '../domain/errors'
import { createAsset, currentAssetFiles, dataOf, deleteAsset, findLibraryAsset, findProjectAsset, getAsset, insertAssetFile } from '../repo/assets'
import { getProject } from '../repo/projects'
import { artifactDir, libraryDir } from '../store/paths'

/** 同类同名的已在库里时，replace 为 'yes' 才覆盖，否则报冲突。标签记来源作品名。 */
export function saveToLibrary(db: Database, assetId: string, replace: 'yes' | 'no'): string {
  const asset = getAsset(db, assetId)
  if (asset.project_id === null) throw new Conflict('已经在素材库里了')
  if (asset.base_id !== null) throw new Conflict('换装跟着本体走，不单独存入素材库')
  const files = currentAssetFiles(db, assetId)
  if (files.length === 0) throw new Conflict('还没有设定图，先生成再存入素材库')
  const project = getProject(db, asset.project_id)

  const existing = findLibraryAsset(db, asset.category, asset.name)
  if (existing !== null && replace !== 'yes') throw new Conflict(`素材库里已有「${asset.name}」`)

  return db.transaction(() => {
    if (existing !== null) removeLibraryAsset(db, existing.id)
    const id = createAsset(db, { projectId: null, category: asset.category, name: asset.name, data: dataOf(asset), tags: [project.name] })
    const dir = join(libraryDir(), id)
    mkdirSync(dir, { recursive: true })
    // 倒着插，库里的新到旧顺序与原资产一致。
    for (const file of [...files].reverse()) insertAssetFile(db, id, { role: file.role, label: file.label, path: copyInto(file.path, dir, `${file.role}-`) })
    return id
  })()
}

/** 复制成作品里的一件草稿。出场次数清零，改了名的不带别名。 */
export function copyFromLibrary(db: Database, libraryId: string, projectId: string, name: string): string {
  const source = getAsset(db, libraryId)
  if (source.project_id !== null) throw new Conflict(`「${source.name}」不在素材库里`)
  getProject(db, projectId)
  if (findProjectAsset(db, projectId, source.category, name) !== null) throw new Conflict(`这部作品里已有「${name}」，换个名字`)

  const data: AssetData = { ...dataOf(source), appearances: 0, ...(name === source.name ? {} : { aliases: [] }) }
  return db.transaction(() => {
    const id = createAsset(db, { projectId, category: source.category, name, data })
    const dir = artifactDir(projectId)
    mkdirSync(dir, { recursive: true })
    for (const file of currentAssetFiles(db, libraryId).reverse()) insertAssetFile(db, id, { role: file.role, label: file.label, path: copyInto(file.path, dir, `${id}-`) })
    return id
  })()
}

/** 库里的文件只有这一件资产在用，随它一起删。 */
export function removeLibraryAsset(db: Database, id: string): void {
  const asset = getAsset(db, id)
  if (asset.project_id !== null) throw new Conflict(`「${asset.name}」不在素材库里`)
  deleteAsset(db, id)
  rmSync(join(libraryDir(), id), { recursive: true, force: true })
}

function copyInto(path: string, dir: string, prefix: string): string {
  const target = join(dir, prefix + basename(path))
  copyFileSync(path, target)
  return target
}
