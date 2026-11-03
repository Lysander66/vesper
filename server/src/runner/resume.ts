/** 重启后接上没跑完的 job：queued 重跑，有 task_id 的只续轮询不重发提交，没有 task_id 的无法判断供应商是否收到，标记失败。 */

import type { JobRow } from '../db/records'

import type { Database } from 'bun:sqlite'

export const AMBIGUOUS_SUBMIT_ERROR =
  '提交结果未知：进程在发出提交与记录响应之间退出，无法判断供应商是否已受理。' +
  '未自动重发以免重复计费。请查该 job 的 submit 记录后手动重建。'

export interface PendingJobs {
  readonly resumable: JobRow[]
  readonly fresh: JobRow[]
  readonly ambiguous: JobRow[]
}

export function classifyPendingJobs(db: Database): PendingJobs {
  const rows = db
    .query("SELECT * FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at")
    .all() as JobRow[]

  const resumable: JobRow[] = []
  const fresh: JobRow[] = []
  const ambiguous: JobRow[] = []

  for (const row of rows) {
    if (row.provider_task_id) resumable.push(row)
    else if (row.status === 'queued' && !hasCalls(db, row.id)) fresh.push(row)
    else ambiguous.push(row)
  }
  return { resumable, fresh, ambiguous }
}

/** queued 但已有往返记录，说明请求发出去过，同样无法判断供应商是否收到。 */
function hasCalls(db: Database, jobId: string): boolean {
  const row = db.query('SELECT COUNT(*) AS n FROM http_calls WHERE job_id = ?').get(jobId) as { n: number }
  return row.n > 0
}
