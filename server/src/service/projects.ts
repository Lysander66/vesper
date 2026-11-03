/** 作品设置的修改、整部删除与节拍确认。 */

import { rmSync } from 'node:fs'

import type { Database } from 'bun:sqlite'

import { PROJECT_OF_OWNER } from '../db/records'
import { parseBeats } from '../domain/beats'
import { Conflict } from '../domain/errors'
import { getEpisode, getProject, listEpisodes, setBeatsState, writeProject, type ProjectPatch } from '../repo/projects'
import { listShots, markStale } from '../repo/shots'
import { artifactDir, filmDir } from '../store/paths'

/** 画风与画幅进每一张首帧，换了就把整部作品从首帧起标过时。 */
export function updateProject(db: Database, id: string, patch: ProjectPatch): void {
  const before = getProject(db, id)
  const restyled = (patch.style !== undefined && patch.style !== before.style) || (patch.aspect !== undefined && patch.aspect !== before.aspect)
  db.transaction(() => {
    writeProject(db, id, patch)
    if (!restyled) return
    for (const episode of listEpisodes(db, id)) {
      for (const shot of listShots(db, episode.id)) markStale(db, { kind: 'shot', id: shot.id }, ['first_frame', 'clip'])
      markStale(db, { kind: 'episode', id: episode.id }, ['film'])
    }
  })()
}

/** 删作品连同库里的记录与磁盘上的产物。有任务在跑时拒绝，免得执行器写入已删的行。 */
export function deleteProject(db: Database, id: string): void {
  getProject(db, id)
  const running = db
    .query(`SELECT COUNT(*) AS n FROM runs WHERE status = 'running' AND (${PROJECT_OF_OWNER}) = ?1`)
    .get(id) as { n: number }
  if (running.n > 0) throw new Conflict('还有任务进行中，等它结束或取消后再删')

  db.transaction(() => {
    // 按外键依赖排序：归属推导要用 episodes / shots / assets，projects 放最后。
    db.query(
      `DELETE FROM artifacts WHERE
         (owner_kind = 'episode' AND owner_id IN (SELECT id FROM episodes WHERE project_id = ?1))
         OR (owner_kind = 'shot' AND owner_id IN
               (SELECT id FROM shots WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?1)))`,
    ).run(id)
    db.query('DELETE FROM asset_files WHERE asset_id IN (SELECT id FROM assets WHERE project_id = ?1)').run(id)
    db.query(`DELETE FROM jobs WHERE project_id = ?1 OR (${PROJECT_OF_OWNER}) = ?1`).run(id)
    db.query(`DELETE FROM commands WHERE (${PROJECT_OF_OWNER}) = ?1`).run(id)
    db.query(`DELETE FROM runs WHERE (${PROJECT_OF_OWNER}) = ?1`).run(id)
    db.query('DELETE FROM assets WHERE project_id = ?1').run(id)
    db.query('DELETE FROM projects WHERE id = ?1').run(id)
  })()

  rmSync(artifactDir(id), { recursive: true, force: true })
  rmSync(filmDir(id), { recursive: true, force: true })
}

export function confirmEpisodeBeats(db: Database, id: string): void {
  const episode = getEpisode(db, id)
  if (parseBeats(episode.beats).length === 0) throw new Conflict('本集还没有节拍可确认')
  setBeatsState(db, id, 'confirmed')
}
