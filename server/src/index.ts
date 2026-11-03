/** 进程入口：开库、按文件载入端点定义、清理过期往返明细、启动 HTTP，上次未完成的 job 在后台续跑。 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRouter } from './api/routes'
import { config } from './config'
import { sweepCalls } from './db/retention'
import { openDatabase } from './db/schema'
import { recover } from './pipeline/recover'
import { pruneEndpoints, upsertEndpoint } from './repo/catalog'
import { dbFile, ensureDataRoot } from './store/paths'

import type { Database } from 'bun:sqlite'

const ENDPOINT_DIR = join(import.meta.dir, '..', 'endpoints')

ensureDataRoot()
const db = openDatabase(dbFile())
seedEndpoints(db, ENDPOINT_DIR)

const swept = sweepCalls(db, config.callsDays)
if (swept > 0) console.info('清理过期往返明细 条数=%d 保留天数=%d', swept, config.callsDays)

// 不 await：续轮询可能要等几分钟。recover 的同步收尾在它首个 await 之前已完成。
const recovering = recover(db)

const route = createRouter(db)

Bun.serve({
  port: config.port,
  idleTimeout: 0,
  async fetch(request) {
    const response = await route(request)
    return response ?? new Response('Vesper server', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  },
})

console.info('Vesper 服务已启动 http://localhost:%d 数据库=%s', config.port, dbFile())

recovering.then(
  (report) => {
    if (report.interruptedRuns || report.resumed.length || report.abandoned.length) {
      console.info('恢复上次未完成的任务 中断任务=%d 续跑=%d 放弃=%d', report.interruptedRuns, report.resumed.length, report.abandoned.length)
    }
  },
  (error: unknown) => console.error('恢复上次未完成的任务失败', error),
)

/** 定义有误就不启动，免得错误拖到第一次调用才暴露。 */
function seedEndpoints(db: Database, dir: string): void {
  const names: string[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown
    const name = file.replace(/\.json$/, '')
    upsertEndpoint(db, name, raw)
    names.push(name)
  }
  const dropped = pruneEndpoints(db, names)
  if (dropped.length > 0) console.info('清理已下线端点 %s', dropped.join(' '))
}
