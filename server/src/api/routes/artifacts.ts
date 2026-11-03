/** 产物的历史版本与换回。镜头与整集的路由形状相同，只是归属不同。 */

import type { Database } from 'bun:sqlite'

import { body, json, z, type Register } from '../http'
import { artifactKind } from './params'
import { getEpisode } from '../../repo/projects'
import { artifactHistory, getShot } from '../../repo/shots'
import { restoreArtifact } from '../../service/shots'

export function registerArtifacts(on: Register, db: Database): void {
  /** 一个产物位的全部版本，新的在前。 */
  on('GET', '/api/shots/:id/artifacts/:kind/history', (_request, params) => {
    const shot = getShot(db, params.id ?? '')
    return json(artifactHistory(db, { kind: 'shot', id: shot.id }, artifactKind(params.kind)))
  })

  on('GET', '/api/episodes/:id/artifacts/:kind/history', (_request, params) => {
    const episode = getEpisode(db, params.id ?? '')
    return json(artifactHistory(db, { kind: 'episode', id: episode.id }, artifactKind(params.kind)))
  })

  /** 换回旧版本，不发请求。 */
  on('POST', '/api/shots/:id/artifacts/:kind/restore', async (request, params) => {
    const input = await body(request, VERSION_SCHEMA)
    const shot = getShot(db, params.id ?? '')
    return json(restoreArtifact(db, { kind: 'shot', id: shot.id }, artifactKind(params.kind), input.version))
  })

  on('POST', '/api/episodes/:id/artifacts/:kind/restore', async (request, params) => {
    const input = await body(request, VERSION_SCHEMA)
    const episode = getEpisode(db, params.id ?? '')
    return json(restoreArtifact(db, { kind: 'episode', id: episode.id }, artifactKind(params.kind), input.version))
  })
}

const VERSION_SCHEMA = z.object({ version: z.number().int().positive() })
