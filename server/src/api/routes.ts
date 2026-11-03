/** 路由表的组装与分发。会产生费用的接口一律回 `{ run_id }`，其余同步返回。 */

import type { Database } from 'bun:sqlite'

import { fail, json, type Handler } from './http'
import { serveFile } from './files'
import { homeView } from './home'
import { registerProjects } from './routes/projects'
import { registerSources } from './routes/sources'
import { registerAssets } from './routes/assets'
import { registerLibrary } from './routes/library'
import { registerEpisodes } from './routes/episodes'
import { registerShots } from './routes/shots'
import { registerArtifacts } from './routes/artifacts'
import { registerRecords } from './routes/records'
import { registerCatalog } from './routes/catalog'
import { registerSystem } from './routes/system'

export function createRouter(db: Database) {
  const routes: [string, string, Handler][] = []
  const on = (method: string, pattern: string, handler: Handler) => routes.push([method, pattern, handler])

  on('GET', '/api/home', () => json(homeView(db)))
  on('GET', '/api/files', (request) => serveFile(request))

  registerProjects(on, db)
  registerSources(on, db)
  registerAssets(on, db)
  registerLibrary(on, db)
  registerEpisodes(on, db)
  registerShots(on, db)
  registerArtifacts(on, db)
  registerRecords(on, db)
  registerCatalog(on, db)
  registerSystem(on)

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return undefined

    // 路径存在、方法不对时回 405 并列出可用方法。
    const allowed: string[] = []
    for (const [method, pattern, handler] of routes) {
      const params = match(pattern, url.pathname)
      if (!params) continue
      if (method !== request.method) {
        allowed.push(method)
        continue
      }
      try {
        return await handler(request, params)
      } catch (error) {
        return fail(error)
      }
    }
    if (allowed.length > 0) {
      return json(
        { error: `这个接口不支持 ${request.method}，支持：${allowed.join('、')}`, code: 'method_not_allowed' },
        405,
        { Allow: allowed.join(', ') },
      )
    }
    return json({ error: `没有这个接口：${request.method} ${url.pathname}`, code: 'no_route' }, 404)
  }
}

function match(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/')
  const got = pathname.split('/')
  if (want.length !== got.length) return null

  const params: Record<string, string> = {}
  for (const [i, segment] of want.entries()) {
    const actual = got[i] ?? ''
    if (segment.startsWith(':')) {
      if (actual === '') return null
      params[segment.slice(1)] = decodeURIComponent(actual)
      continue
    }
    if (segment !== actual) return null
  }
  return params
}
