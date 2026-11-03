/** 任务流与记录：run 的订阅与取消，以及调用记录、本地命令的查询。 */

import type { OwnerKind } from '@vesper/shared'

import type { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { json, query, type Register } from '../http'
import { eventStream, feedStream, parseCursors } from '../sse'
import { cancel } from '../tasks'
import { jobOf, jobView, runView, runViews } from '../views'
import { listCommands } from '../../local/command'
import { jobsCost, listJobs, loadCall, requestJsonForCall } from '../../db/records'
import { NotFound } from '../../domain/errors'
import { activeRuns, getRun, recentRuns } from '../../repo/runs'
import { requestDir } from '../../store/paths'

export function registerRecords(on: Register, db: Database): void {
  // 得排在 /api/runs/:id 前面，否则 events、feed 会被当成 run id。
  on('GET', '/api/runs/events', (request) => eventStream(db, parseCursors(query(request, 'runs'))))
  on('GET', '/api/runs/feed', () => feedStream())
  on('GET', '/api/runs/:id', (_request, params) => json(runView(db, getRun(db, params.id ?? ''))))
  on('GET', '/api/runs', (request) => {
    // 默认只返回在跑的：前端据此重新订阅事件流。
    if (query(request, 'scope') === 'recent') return json(runViews(db, recentRuns(db)))
    return json(runViews(db, activeRuns(db)))
  })
  on('POST', '/api/runs/:id/cancel', (_request, params) => json({ cancelled: cancel(params.id ?? '') ? 'yes' : 'no' }))

  const ownerOf = (request: Request) => ({
    ownerKind: query(request, 'owner_kind') as OwnerKind | undefined,
    ownerId: query(request, 'owner_id'),
  })
  on('GET', '/api/jobs', (request) => json(listJobs(db, ownerOf(request)).map(jobOf)))
  // 得排在 /api/jobs/:id 前面。
  on('GET', '/api/jobs/cost', (request) => json(jobsCost(db, ownerOf(request))))

  on('GET', '/api/jobs/:id', (_request, params) => json(jobView(db, params.id ?? '')))

  // 内嵌图片的 cURL 无法直接运行，由 tools/send.ts 按这份 JSON 发送。
  on('POST', '/api/calls/:id/request-json', async (_request, params) => {
    const call = loadCall(db, Number(params.id))
    if (!call) throw new NotFound(`请求 ${params.id}`)
    const path = join(requestDir(), `call-${call.id}.json`)
    await mkdir(requestDir(), { recursive: true })
    await Bun.write(path, requestJsonForCall(call))
    return json({ path })
  })

  on('GET', '/api/commands', (request) =>
    json(
      listCommands(db, {
        ownerKind: query(request, 'owner_kind') as OwnerKind | undefined,
        ownerId: query(request, 'owner_id'),
      }),
    ),
  )
}
