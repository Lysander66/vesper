import type { Database } from 'bun:sqlite'

/** 清掉超过保留天数的 `http_calls`，jobs 永久保留。未结束的 job 按创建时间算；`days <= 0` 不清理。 */
export function sweepCalls(db: Database, days: number): number {
  if (days <= 0) return 0
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  return db.query('DELETE FROM http_calls WHERE job_id IN (SELECT id FROM jobs WHERE COALESCE(finished_at, created_at) < ?)').run(cutoff).changes
}
