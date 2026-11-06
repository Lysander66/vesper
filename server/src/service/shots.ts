/** 增删改分镜、换回旧版本产物。改动与标过时在同一事务里。 */

import type { ArtifactKind, ArtifactOwner, AudioMode, ShotRef } from '@vesper/shared'

import type { Database } from 'bun:sqlite'

import { downstreamOf, impactOfShotFields, impactOfVersionSwap } from '../domain/stale'
import { Conflict, NotFound } from '../domain/errors'
import {
  artifactHistory,
  deleteShot,
  castOf,
  getShot,
  insertArtifact,
  listShots,
  propsOf,
  sceneRefOf,
  insertShotAfter,
  markStale,
  writeShot,
  type ArtifactRow,
  type ShotPatch,
} from '../repo/shots'
import { getAsset, getAssetVersion, latestVersionOf } from '../repo/assets'
import { getProject, listEpisodes } from '../repo/projects'

/** 改分镜并在同一事务里标过时，返回真被标为过时的产物种类（没生成过的不算）。 */
export function updateShot(db: Database, id: string, patch: ShotPatch, audio: AudioMode): ArtifactKind[] {
  const shot = getShot(db, id)
  return db.transaction(() => {
    const changed = writeShot(db, id, patch)
    if (changed.length === 0) return []

    return impactOfShotFields(changed, audio).filter((kind) => {
      const owner: ArtifactOwner = kind === 'film' ? { kind: 'episode', id: shot.episode_id } : { kind: 'shot', id }
      return markStale(db, owner, [kind]) > 0
    })
  })()
}

/** 资产重新锁定后，把引用它的镜头换到最新版本，按两版差异标过时。返回换了几镜。 */
export function followLatestVersion(db: Database, assetId: string): number {
  const asset = getAsset(db, assetId)
  if (asset.state !== 'locked') throw new Conflict('先锁定再更新到分镜')
  if (asset.project_id === null) throw new Conflict('素材库里的资产不随作品分镜更新')
  const latest = latestVersionOf(db, assetId)
  if (latest === null) throw new Conflict('还没有锁定过的版本')

  const outdated = (ref: ShotRef | null): ref is ShotRef => ref !== null && ref.asset_id === assetId && ref.version_id !== latest.id
  const swap = (ref: ShotRef): ShotRef => (outdated(ref) ? { ...ref, version_id: latest.id } : ref)
  const target = getAssetVersion(db, latest.id)
  const audio = getProject(db, asset.project_id).audio_mode
  let count = 0
  for (const episode of listEpisodes(db, asset.project_id)) {
    for (const shot of listShots(db, episode.id)) {
      const scene = sceneRefOf(shot)
      const stale = [...castOf(shot), ...propsOf(shot), scene].filter(outdated)
      if (stale.length === 0) continue
      const kinds = new Set<ArtifactKind>()
      for (const ref of stale) {
        const kind = impactOfVersionSwap(getAssetVersion(db, ref.version_id), target, audio, shot.clip_source)
        if (kind !== null) [kind, ...downstreamOf(kind)].forEach((k) => kinds.add(k))
      }
      db.transaction(() => {
        writeShot(db, shot.id, { cast: castOf(shot).map(swap), sceneRef: scene === null ? null : swap(scene), props: propsOf(shot).map(swap) })
        for (const kind of kinds) markStale(db, kind === 'film' ? { kind: 'episode', id: shot.episode_id } : { kind: 'shot', id: shot.id }, [kind])
      })()
      count++
    }
  }
  return count
}

/** 人工挑出镜角色：只接受已锁定的资产，引用落到各自最新的锁定版本。 */
export function castRefs(db: Database, assetIds: readonly string[]): ShotRef[] {
  return assetIds.map((id) => {
    const asset = getAsset(db, id)
    const latest = asset.state === 'locked' ? latestVersionOf(db, id) : null
    if (latest === null) throw new Conflict(`「${asset.name}」还没锁定`)
    return { asset_id: id, version_id: latest.id, name: asset.name }
  })
}

/** 增删镜头改变的是整集的拼接，所以标本集合成版过时。 */
export function addShot(db: Database, episodeId: string, afterShotId: string | null, fallbackSeconds: number): string {
  return db.transaction(() => {
    const id = insertShotAfter(db, episodeId, afterShotId, fallbackSeconds)
    markStale(db, { kind: 'episode', id: episodeId }, ['film'])
    return id
  })()
}

export function removeShot(db: Database, id: string): void {
  const shot = getShot(db, id)
  db.transaction(() => {
    deleteShot(db, shot)
    markStale(db, { kind: 'episode', id: shot.episode_id }, ['film'])
  })()
}

/** 复制那一行成为新版本、指向同一文件，不重新生成。当前版本始终是最大版本号。 */
export function restoreArtifact(db: Database, owner: ArtifactOwner, kind: ArtifactKind, version: number): ArtifactRow {
  return db.transaction(() => {
    const rows = artifactHistory(db, owner, kind)
    const source = rows.find((row) => row.version === version)
    if (!source) throw new NotFound(`${kind} v${version}`)
    if (source.path === null) throw new Conflict(`${kind} v${version} 的文件已不在，没法用这一版`)
    if (source.version === rows[0]?.version) throw new Conflict(`${kind} v${version} 已经是当前版本`)

    const restored = insertArtifact(db, owner, kind, {
      state: source.state,
      path: source.path,
      jobId: source.job_id,
      commandId: source.command_id,
    })

    const downstream = downstreamOf(kind)
    const ownKinds = downstream.filter((k) => k !== 'film')
    if (ownKinds.length > 0) markStale(db, owner, ownKinds)
    if (downstream.includes('film') && owner.kind === 'shot') {
      markStale(db, { kind: 'episode', id: getShot(db, owner.id).episode_id }, ['film'])
    }
    return restored
  })()
}
