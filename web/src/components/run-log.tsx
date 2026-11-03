import { useEffect, useState } from 'react'
import { RUN_STATUS_LABEL, type RunStatus } from '@vesper/shared'
import { Check, ChevronDown, ChevronRight, CircleSlash, Loader2, X } from 'lucide-react'
import { useRunCenter, type RunState } from '@/lib/run-center'
import { RUN_TONE, TONE_TEXT } from '@/lib/status'
import { cn } from '@/lib/utils'

const RUN_ICON: Record<RunStatus, typeof Check> = {
  running: Loader2,
  succeeded: Check,
  failed: X,
  cancelled: CircleSlash,
  interrupted: CircleSlash,
}

export function RunLog({ runId }: { runId: string | null }) {
  const { runs } = useRunCenter()
  const run = runId ? runs[runId] : undefined
  if (!run) return null
  return <Panel key={run.id} run={run} />
}

function Panel({ run }: { run: RunState }) {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const [done, setDone] = useState(false)
  const open = toggled ?? run.status === 'failed'

  useEffect(() => {
    if (run.status !== 'succeeded') return
    const timer = setTimeout(() => setDone(true), 4000)
    return () => clearTimeout(timer)
  }, [run.status])

  if (done) return null

  const Icon = RUN_ICON[run.status]
  const Chevron = open ? ChevronDown : ChevronRight
  const last = run.lines[run.lines.length - 1]
  const summary = run.status === 'running' ? (last?.text.trim() ?? '正在启动…') : RUN_STATUS_LABEL[run.status]

  return (
    <div className='rounded-md border text-xs'>
      <button className='flex w-full items-center gap-2 px-2.5 py-1.5 text-left' onClick={() => setToggled(!open)}>
        <Icon className={cn('h-3.5 w-3.5 shrink-0', TONE_TEXT[RUN_TONE[run.status]], run.status === 'running' && 'animate-spin')} />
        <span className='truncate'>{summary}</span>
        <span className='ml-auto shrink-0 font-mono text-2xs text-ink3'>{run.id.slice(0, 8)}</span>
        <Chevron className='h-3.5 w-3.5 shrink-0 text-ink3' />
      </button>
      {open && run.lines.length > 0 && (
        <pre className='max-h-48 overflow-y-auto border-t px-2.5 py-1.5 font-mono text-2xs leading-5 whitespace-pre-wrap'>
          {run.lines.map((line) => (
            <div key={line.seq} className={line.level === 'error' ? 'text-fail' : line.level === 'warn' ? 'text-warn' : ''}>
              {line.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}
