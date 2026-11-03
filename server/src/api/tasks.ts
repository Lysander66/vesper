/** 长任务托管：建 run 放到后台执行，立即返回 runId，进度走事件流。 */

import type { Database } from 'bun:sqlite'

import type { OwnerRef } from '../db/records'
import { Conflict } from '../domain/errors'
import { appendEvent, finishRun, startRun } from '../repo/runs'
import { getShot } from '../repo/shots'
import { artifactDir } from '../store/paths'
import type { GenContext } from '../pipeline/gen'

interface Inflight {
  readonly controller: AbortController
  readonly owner: OwnerRef
  readonly episodeId: string | null
}

const inflight = new Map<string, Inflight>()

export interface LaunchInput {
  readonly db: Database
  readonly projectId: string
  readonly owner: OwnerRef
  readonly kind: string
  readonly overrides?: GenContext['overrides']
  readonly promptArgs?: GenContext['promptArgs']
  readonly promptText?: GenContext['promptText']
}

export function launch(input: LaunchInput, work: (ctx: GenContext) => Promise<unknown>): string {
  const { runId, done } = start(input, work)
  // 失败已写入 run 与事件流，这里只防止 unhandled rejection。
  void done.catch(() => undefined)
  return runId
}

/** 同样建 run、落记录，但等跑完直接返回结果。 */
export function runSync<T>(input: LaunchInput, work: (ctx: GenContext) => Promise<T>): Promise<T> {
  return start(input, work).done
}

/** 同一归属（含一集与其下的镜头）同时只跑一个任务：重复发起会重复计费，产物也会互相覆盖。 */
export function assertIdle(db: Database, owner: OwnerRef): void {
  const episodeId = episodeOf(db, owner)
  for (const running of inflight.values()) {
    const sameOwner = running.owner.kind === owner.kind && running.owner.id === owner.id
    const nested = episodeId !== null && running.episodeId === episodeId && (owner.kind === 'episode' || running.owner.kind === 'episode')
    if (sameOwner || nested) throw new Conflict('已有任务在跑，等它结束或取消后再来')
  }
}

function episodeOf(db: Database, owner: OwnerRef): string | null {
  if (owner.kind === 'episode') return owner.id
  if (owner.kind === 'shot') return getShot(db, owner.id).episode_id
  return null
}

function start<T>(input: LaunchInput, work: (ctx: GenContext) => Promise<T>): { runId: string; done: Promise<T> } {
  assertIdle(input.db, input.owner)
  const controller = new AbortController()
  const signal = controller.signal
  const runId = startRun(input.db, input.owner, input.kind)
  inflight.set(runId, { controller, owner: input.owner, episodeId: episodeOf(input.db, input.owner) })
  const ctx: GenContext = {
    db: input.db,
    projectId: input.projectId,
    runId,
    artifactDir: artifactDir(input.projectId),
    signal,
    overrides: input.overrides,
    promptArgs: input.promptArgs,
    promptText: input.promptText,
  }

  const done = (async () => {
    try {
      const report = await work(ctx)
      finishRun(input.db, runId, 'succeeded', { report, note: noteOf(report) })
      return report
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      appendEvent(input.db, runId, { type: 'note', level: 'error', message })
      finishRun(input.db, runId, signal.aborted ? 'cancelled' : 'failed', { error: message })
      throw cause
    } finally {
      inflight.delete(runId)
    }
  })()

  return { runId, done }
}

/** 报告里的 `note` 转给完成提示，没有就只报「任务完成」。 */
function noteOf(report: unknown): string | undefined {
  const note = (report as { note?: unknown } | null)?.note
  return typeof note === 'string' && note !== '' ? note : undefined
}

export function cancel(runId: string): boolean {
  const running = inflight.get(runId)
  if (!running) return false
  running.controller.abort(new Error('用户取消'))
  return true
}
