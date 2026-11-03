/** 一条流承载多个 run（浏览器同 host 只给 6 条连接）。每个 run 先补历史再挂监听，保证 seq 有序。 */

import type { Database } from 'bun:sqlite'

import { eventsSince, findRun, subscribe, subscribeFeed, type RunEvent } from '../repo/runs'

const HEARTBEAT_MS = 15_000

/** `cursors` 是 run id → 已收到的最后一个 seq。全部 run 结束后关流。 */
export function eventStream(db: Database, cursors: ReadonlyMap<string, number>): Response {
  const encoder = new TextEncoder()
  const unsubscribes: (() => void)[] = []
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const pending = new Set<string>()
      // 补历史时一个 run 先结束了，pending 会暂时变空，这时关流后面的 run 就挂不上了。
      let replaying = true
      const close = () => {
        if (closed) return
        closed = true
        unsubscribes.forEach((unsubscribe) => unsubscribe())
        if (heartbeat) clearInterval(heartbeat)
        controller.close()
      }
      const send = (runId: string, event: RunEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ run_id: runId, ...event })}\n\n`))
        if (!isFinished(event)) return
        pending.delete(runId)
        if (!replaying && pending.size === 0) close()
      }

      for (const [runId, after] of cursors) {
        // 已删或 id 有误的跳过，不影响其他 run。
        if (!findRun(db, runId)) continue
        pending.add(runId)
        for (const event of eventsSince(db, runId, after)) send(runId, event)
        // 补完历史时已结束的 run 不挂监听。
        if (findRun(db, runId)?.status !== 'running') {
          pending.delete(runId)
          continue
        }
        if (pending.has(runId)) unsubscribes.push(subscribe(runId, (event) => send(runId, event)))
      }
      replaying = false
      if (pending.size === 0) {
        close()
        return
      }

      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': ping\n\n'))
      }, HEARTBEAT_MS)
    },
    cancel() {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return sseResponse(stream)
}

/** 任务开始与结束的常驻流，不补历史；断线期间错过的由前端重连后查询在跑的任务补上。 */
export function feedStream(): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = subscribeFeed((event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)))
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), HEARTBEAT_MS)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })
  return sseResponse(stream)
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** `run-a:3,run-b:0`，没写游标按 0。 */
export function parseCursors(raw: string | undefined): Map<string, number> {
  const cursors = new Map<string, number>()
  for (const item of (raw ?? '').split(',')) {
    const [id, seq] = item.split(':')
    if (id) cursors.set(id, Number(seq) || 0)
  }
  return cursors
}

function isFinished(event: RunEvent): boolean {
  return typeof event.payload === 'object' && event.payload !== null && (event.payload as { type?: string }).type === 'finished'
}
