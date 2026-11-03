import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CALL_SECTION_LABEL, type CallSection, type Run, type RunEventPayload, type RunFeedEvent, type RunStatus } from '@vesper/shared'
import { toast } from 'sonner'
import { api } from './api'
import { purposeLabel, taskLabel } from './records'

interface RunLine {
  seq: number
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface RunState {
  id: string
  status: RunStatus
  lines: RunLine[]
}

interface RunCenter {
  runs: Record<string, RunState>
  watch: (runId: string) => void
}

const Context = createContext<RunCenter | null>(null)

export function RunCenterProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const cursors = useRef(new Map<string, number>())
  const source = useRef<EventSource | null>(null)
  const reopenQueued = useRef(false)
  const reconcile = useRef(async () => {})
  const queryClient = useQueryClient()

  const reopen = useCallback(() => {
    source.current?.close()
    source.current = null
    if (cursors.current.size === 0) return
    const query = [...cursors.current].map(([id, seq]) => `${id}:${seq}`).join(',')
    const next = new EventSource(`/api/runs/events?runs=${encodeURIComponent(query)}`)
    source.current = next

    next.onmessage = (message) => {
      const event = JSON.parse(message.data) as { run_id: string; seq: number; payload: RunEventPayload | null }
      const runId = event.run_id
      if (!cursors.current.has(runId)) return
      cursors.current.set(runId, event.seq)
      const line = formatEvent(event.payload)
      const finished = finishedStatus(event.payload)
      setRuns((prev) => {
        const current = prev[runId] ?? { id: runId, status: 'running' as RunStatus, lines: [] }
        return {
          ...prev,
          [runId]: {
            ...current,
            status: finished ?? current.status,
            lines: line ? [...current.lines, { seq: event.seq, ...line }] : current.lines,
          },
        }
      })

      // 没有「job 完成」事件：下一个 job 开始即说明上一个已写进数据库，照这个节奏刷新页面。
      if (isProgressEvent(event.payload)) refreshGenerated(queryClient)
      if (!finished) return
      cursors.current.delete(runId)
      if (cursors.current.size === 0) {
        next.close()
        source.current = null
      }
      refreshGenerated(queryClient)
      if (finished === 'succeeded') toast.success('任务完成', { description: noteOf(event.payload) })
      else {
        const title = `任务${finished === 'cancelled' ? '已取消' : '失败'}`
        const reason = errorOf(event.payload)
        toast.error(reason ? `${title}：${reason}` : title)
      }
    }

    // 不用浏览器的自动重连：它会把已结束的 run 反复拉起。断线后隔一会儿按服务端状态对账。
    next.onerror = () => {
      next.close()
      if (source.current !== next) return
      source.current = null
      setTimeout(() => void reconcile.current(), 2000)
    }
  }, [queryClient])

  useEffect(() => {
    reconcile.current = async () => {
      const ids = [...cursors.current.keys()]
      if (ids.length === 0) return
      let latest: Run[]
      try {
        latest = await Promise.all(ids.map((id) => api.run(id)))
      } catch {
        setTimeout(() => void reconcile.current(), 5000)
        return
      }
      const ended = latest.filter((run) => ENDED.includes(run.status))
      for (const run of ended) cursors.current.delete(run.id)
      if (ended.length > 0) {
        setRuns((prev) => {
          const next = { ...prev }
          for (const run of ended) next[run.id] = { ...(prev[run.id] ?? { id: run.id, lines: [] }), status: run.status }
          return next
        })
        refreshGenerated(queryClient)
      }
      reopen()
    }
  }, [queryClient, reopen])

  const watch = useCallback(
    (runId: string) => {
      if (cursors.current.has(runId)) return
      cursors.current.set(runId, 0)
      setRuns((prev) => ({ ...prev, [runId]: prev[runId] ?? { id: runId, status: 'running', lines: [] } }))
      if (reopenQueued.current) return
      reopenQueued.current = true
      queueMicrotask(() => {
        reopenQueued.current = false
        reopen()
      })
    },
    [reopen]
  )

  useEffect(() => {
    const feed = new EventSource('/api/runs/feed')
    let opened = false
    // 每次连上（含断线重连）都查一遍进行中的任务，刷新页面或断线期间开始的任务靠这一步接回。
    feed.onopen = () => {
      api
        .activeRuns()
        .then((active) => active.forEach((run) => watch(run.id)))
        .catch(() => toast.error('连不上服务端'))
      if (opened) refreshGenerated(queryClient)
      opened = true
    }
    feed.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunFeedEvent
      if (event.type === 'run_started') watch(event.run_id)
      else refreshGenerated(queryClient)
    }
    return () => feed.close()
  }, [watch, queryClient])

  useEffect(() => {
    const open = source
    return () => open.current?.close()
  }, [])

  const value = useMemo(() => ({ runs, watch }), [runs, watch])
  return <Context value={value}>{children}</Context>
}

export function useRunCenter(): RunCenter {
  const value = use(Context)
  if (!value) throw new Error('useRunCenter 必须在 RunCenterProvider 内使用')
  return value
}

/** `busy` 覆盖请求与 run 两段，只看前者的话按钮会在任务刚开始时重新可点。 */
export function useLaunch(start: () => Promise<{ run_id: string }>) {
  const { watch, runs } = useRunCenter()
  const [runId, setRunId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const trigger = useCallback(async () => {
    setSending(true)
    try {
      const { run_id } = await start()
      setRunId(run_id)
      watch(run_id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }, [start, watch])

  const running = runId ? runs[runId]?.status === 'running' : false
  return { trigger: () => void trigger(), runId, busy: sending || running }
}

export function useBusyRuns(): RunState[] {
  const { runs } = useRunCenter()
  return Object.values(runs).filter((run) => run.status === 'running')
}

/** 生成过程不改设置类数据；整集几十个 job_started，每次全量失效等于把整个界面重取一遍。 */
const STATIC_KEYS = new Set(['endpoints', 'credentials', 'bindings', 'prompts', 'storage'])

function refreshGenerated(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ predicate: (query) => !STATIC_KEYS.has(String(query.queryKey[0])) })
}

const ENDED: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled', 'interrupted']

function finishedStatus(payload: RunEventPayload | null): RunStatus | null {
  return payload?.type === 'finished' ? payload.status : null
}

function isProgressEvent(payload: RunEventPayload | null): boolean {
  return payload?.type === 'job_started' || payload?.type === 'command_finished' || payload?.type === 'skipped'
}

function errorOf(payload: RunEventPayload | null): string | null {
  return payload?.type === 'finished' ? (payload.error ?? null) : null
}

function noteOf(payload: RunEventPayload | null): string | undefined {
  return payload?.type === 'finished' ? payload.note : undefined
}

function phaseLabel(phase: string): string {
  if (phase === 'finished') return '结束'
  return CALL_SECTION_LABEL[phase as CallSection] ?? phase
}

function formatEvent(payload: RunEventPayload | null): Omit<RunLine, 'seq'> | null {
  if (!payload) return null

  switch (payload.type) {
    case 'job_started':
      return { level: 'info', text: `开始：${payload.label || purposeLabel(payload.purpose)}` }
    case 'job_progress': {
      const status = payload.provider_status ?? payload.status ?? ''
      const message = payload.message ? ` ${payload.message}` : ''
      return { level: 'info', text: `  ${phaseLabel(payload.phase)} ${status}${message}`.trimEnd() }
    }
    case 'skipped':
      return { level: 'warn', text: payload.message }
    case 'note':
      return { level: payload.level, text: payload.message }
    case 'command_started':
      return { level: 'info', text: `开始：${taskLabel(payload.kind)}` }
    case 'command_finished':
      return {
        level: payload.error ? 'error' : 'info',
        text: payload.error ? `失败：${payload.error}` : '完成',
      }
    case 'finished':
      return { level: payload.error ? 'error' : 'info', text: payload.error ? `结束：${payload.error}` : '结束' }
  }
}
