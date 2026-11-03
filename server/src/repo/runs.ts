/** 任务与事件的读写。事件先落库再推送，重连重放才不会漏。 */

import type { Database } from 'bun:sqlite'

import type { RunEventPayload, RunFeedEvent, RunStatus } from '@vesper/shared'

import { NotFound, nowIso, parseJson } from './common'
import { newId } from '../db/id'
import type { OwnerRef } from '../db/records'

export interface RunRow {
  readonly id: string
  readonly owner_kind: OwnerRef['kind']
  readonly owner_id: string
  readonly kind: string
  readonly status: RunStatus
  readonly report: string | null
  readonly error: string | null
  readonly started_at: string
  readonly finished_at: string | null
}

export interface RunEventRow {
  readonly id: number
  readonly run_id: string
  readonly seq: number
  readonly payload: string
  readonly at: string
}

export interface RunEvent {
  readonly seq: number
  readonly at: string
  /** null 只出现在库里那行 JSON 坏掉的时候。 */
  readonly payload: RunEventPayload | null
}

type Listener = (event: RunEvent) => void

const listeners = new Map<string, Set<Listener>>()

export function subscribe(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(runId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(runId)
  }
}

const feedListeners = new Set<(event: RunFeedEvent) => void>()

/** 所有任务的开始与结束。 */
export function subscribeFeed(listener: (event: RunFeedEvent) => void): () => void {
  feedListeners.add(listener)
  return () => feedListeners.delete(listener)
}

function broadcast(event: RunFeedEvent): void {
  for (const listener of feedListeners) listener(event)
}

export function startRun(db: Database, owner: OwnerRef, kind: string): string {
  const id = newId('run')
  db.query(
    `INSERT INTO runs (id, owner_kind, owner_id, kind, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)`,
  ).run(id, owner.kind, owner.id, kind, nowIso())
  broadcast({ type: 'run_started', run_id: id })
  return id
}

export function appendEvent(db: Database, runId: string, payload: RunEventPayload): RunEvent {
  const event = db.transaction(() => {
    const previous = db.query('SELECT COALESCE(MAX(seq), 0) AS v FROM run_events WHERE run_id = ?').get(runId) as {
      v: number
    }
    const seq = previous.v + 1
    const at = nowIso()
    db.query('INSERT INTO run_events (run_id, seq, payload, at) VALUES (?, ?, ?, ?)').run(
      runId,
      seq,
      JSON.stringify(payload),
      at,
    )
    return { seq, at, payload }
  })()

  for (const listener of listeners.get(runId) ?? []) listener(event)
  return event
}

/** `note` 随完成提示显示给用户。 */
export function finishRun(db: Database, runId: string, status: Exclude<RunStatus, 'running'>, detail: { report?: unknown; error?: string | undefined; note?: string | undefined } = {}): void {
  db.query('UPDATE runs SET status = ?, report = ?, error = ?, finished_at = ? WHERE id = ?').run(
    status,
    detail.report === undefined ? null : JSON.stringify(detail.report),
    detail.error ?? null,
    nowIso(),
    runId,
  )
  appendEvent(db, runId, { type: 'finished', status, error: detail.error, note: detail.note })
  broadcast({ type: 'run_finished', run_id: runId, status })
}

export function getRun(db: Database, runId: string): RunRow {
  const row = findRun(db, runId)
  if (!row) throw new NotFound(`任务 ${runId}`)
  return row
}

export function findRun(db: Database, runId: string): RunRow | null {
  return db.query('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | null
}

export function eventsSince(db: Database, runId: string, afterSeq: number): RunEvent[] {
  const rows = db
    .query('SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq')
    .all(runId, afterSeq) as RunEventRow[]
  return rows.map((row) => ({ seq: row.seq, at: row.at, payload: parseJson<RunEventPayload | null>(row.payload, null) }))
}

export function activeRuns(db: Database): RunRow[] {
  return db.query(`SELECT * FROM runs WHERE status = 'running' ORDER BY started_at`).all() as RunRow[]
}

/** 供界面回看，含已结束的任务。 */
export function recentRuns(db: Database, limit = 20): RunRow[] {
  return db.query('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit) as RunRow[]
}

/** 启动时把上次未结束的任务标为 interrupted，与失败区分：中断的可以直接重跑。 */
export function markInterrupted(db: Database): number {
  return db
    .query(`UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'`)
    .run(nowIso()).changes
}
