/** 素材库：从作品存入、复制到作品、删除。 */

import type { Database } from 'bun:sqlite'

import { body, json, optionalBody, z, type Register } from '../http'
import { assetView, libraryItems } from '../views'
import { copyFromLibrary, removeLibraryAsset, saveToLibrary } from '../../service/library'

export function registerLibrary(on: Register, db: Database): void {
  on('GET', '/api/library', () => json(libraryItems(db)))

  on('POST', '/api/assets/:id/library', async (request, params) => {
    const input = await optionalBody(request, z.object({ replace: z.enum(['yes', 'no']).default('no') }))
    return json(assetView(db, saveToLibrary(db, params.id ?? '', input.replace)), 201)
  })

  on('POST', '/api/library/:id/copy', async (request, params) => {
    const input = await body(request, z.object({ project_id: z.string().min(1), name: z.string().trim().min(1) }))
    return json(assetView(db, copyFromLibrary(db, params.id ?? '', input.project_id, input.name)), 201)
  })

  on('DELETE', '/api/library/:id', (_request, params) => {
    removeLibraryAsset(db, params.id ?? '')
    return json({ id: params.id ?? '' })
  })
}
