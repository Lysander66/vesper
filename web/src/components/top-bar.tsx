import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { allEpisodes, RUN_STATUS_LABEL, type ProjectView, type Run } from '@vesper/shared'
import { Activity, Check, Library, Loader2, Settings, Terminal, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { usePopover } from '@/lib/popover'
import { jobSeconds, ownerLine, taskLabel, type RecordsOwner } from '@/lib/records'
import { useBusyRuns, type RunState } from '@/lib/run-center'
import { runTarget, type RunTarget } from '@/lib/run-target'
import { RUN_TONE, TONE_DOT, TONE_TEXT } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/logo-mark'

export function TopBar() {
  const { projectId } = useParams({ strict: false })

  return (
    <header className='sticky top-0 z-40 flex h-13 items-center gap-3.5 border-b bg-card px-3.5'>
      <Link to='/' className='flex items-center gap-2 transition-opacity hover:opacity-75'>
        <LogoMark size={22} />
        <span className='relative top-[.5px] font-cormorant text-[15px] leading-none font-medium tracking-[.03em] italic'>Vesper</span>
      </Link>

      {projectId && <StageBar projectId={projectId} />}

      <div className='ml-auto flex items-center gap-1'>
        <RunsMenu />
        <Link
          to='/library'
          className='flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-line2 hover:text-foreground'
          activeProps={{ className: 'bg-line2 text-foreground' }}
        >
          <Library className='h-3.5 w-3.5' />
          素材库
        </Link>
        <Link
          to='/settings'
          className='flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-line2 hover:text-foreground'
          activeProps={{ className: 'bg-line2 text-foreground' }}
        >
          <Settings className='h-3.5 w-3.5' />
          设置
        </Link>
      </div>
    </header>
  )
}

function StageBar({ projectId }: { projectId: string }) {
  const view = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) })
  if (!view.data) return null

  const list = stages(view.data)
  const current = list.findIndex((stage) => !stage.done)

  return (
    <div className='absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 lg:flex'>
      {list.map((stage, index) => (
        <div key={stage.label} className='flex items-center gap-0.5'>
          {index > 0 && <span className='text-2xs text-border'>›</span>}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground',
              stage.done && 'text-ok',
              index === current && 'bg-accent font-semibold text-accent-foreground'
            )}
          >
            {stage.done && <Check className='h-3.5 w-3.5' strokeWidth={3} />}
            {stage.label}
            {stage.detail && <span className='font-mono text-2xs font-normal opacity-70'>{stage.detail}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

interface Stage {
  label: string
  done: boolean
  detail: string
}

function stages(view: ProjectView): Stage[] {
  const episodes = allEpisodes(view)
  const total = episodes.length
  const frozen = view.project.plan_state === 'frozen'
  const locked = view.cast.filter((member) => member.state === 'locked').length
  const withShots = episodes.filter((episode) => episode.shots > 0).length
  const withFilm = episodes.filter((episode) => episode.film !== null).length

  return [
    { label: '分集', done: frozen, detail: '' },
    { label: '角色', done: locked > 0 && locked === view.cast.length, detail: `${locked}/${view.cast.length}` },
    { label: '分镜', done: withShots > 0 && withShots === total, detail: `${withShots}/${total}` },
    { label: '合成', done: withFilm > 0 && withFilm === total, detail: `${withFilm}/${total}` },
  ]
}

function RunsMenu() {
  const busy = useBusyRuns()
  const { open, setOpen, ref } = usePopover<HTMLDivElement>()
  const recent = useQuery({ queryKey: ['runs', 'recent'], queryFn: api.recentRuns, enabled: open })
  const active = useQuery({ queryKey: ['runs', 'active'], queryFn: api.activeRuns, enabled: open })
  const done = (recent.data ?? []).filter((run) => run.status !== 'running')
  const activeOf = (runId: string) => active.data?.find((run) => run.id === runId)

  return (
    <div className='relative' ref={ref}>
      <button
        className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-line2 hover:text-foreground', open && 'bg-line2 text-foreground')}
        onClick={() => setOpen(!open)}
      >
        {busy.length > 0 ? <Loader2 className='h-3.5 w-3.5 animate-spin text-busy' /> : <Activity className='h-3.5 w-3.5' />}
        任务
        {busy.length > 0 && <span className='rounded-full bg-busy px-1.5 font-mono text-2xs font-semibold text-busy-bg'>{busy.length}</span>}
      </button>

      {open && (
        <div className='absolute top-[calc(100%+6px)] right-0 max-h-[70vh] w-96 overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-lg'>
          <MenuHeading label='进行中' />
          {busy.length === 0 ? (
            <p className='px-2.5 pb-2 text-xs text-muted-foreground'>暂无进行中任务</p>
          ) : (
            busy.map((run) => {
              const row = activeOf(run.id)
              return <ActiveRunRow key={run.id} run={run} active={row} kind={row === undefined ? '任务' : taskLabel(row.kind)} onGo={() => setOpen(false)} />
            })
          )}

          <MenuHeading label='最近完成' />
          {done.length === 0 ? <p className='px-2.5 pb-2 text-xs text-muted-foreground'>暂无已完成任务</p> : done.map((run) => <DoneRow key={run.id} run={run} onGo={() => setOpen(false)} />)}
        </div>
      )}
    </div>
  )
}

function MenuHeading({ label }: { label: string }) {
  return <p className='px-2.5 pt-2 pb-1 text-2xs font-semibold text-ink3'>{label}</p>
}

function DoneRow({ run, onGo }: { run: Run; onGo: () => void }) {
  const seconds = jobSeconds(run.started_at, run.finished_at)
  const tone = RUN_TONE[run.status]
  const target = runTarget(run)

  return (
    <div className='flex items-start gap-1 rounded-lg pr-1 hover:bg-line2'>
      <RunLink target={target} run={run} onGo={onGo} className='flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2'>
        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
        <div className='min-w-0 flex-1'>
          <p className='flex items-center gap-1.5 text-xs'>
            <span className='font-medium'>{taskLabel(run.kind)}</span>
            <span className={TONE_TEXT[tone]}>{RUN_STATUS_LABEL[run.status]}</span>
            <span className='ml-auto shrink-0 font-mono text-2xs text-ink3'>{seconds === null ? '' : `${seconds.toFixed(0)}s`}</span>
          </p>
          <p className={cn('truncate text-2xs text-muted-foreground', run.error !== null && 'font-mono')} title={run.error ?? undefined}>
            {run.error ?? target?.label ?? ownerLine(run.owner_kind, run.owner_id)}
          </p>
        </div>
      </RunLink>
      {target && <RecordsIcon run={run} onGo={onGo} />}
    </div>
  )
}

function RunLink({ target, run, onGo, className, children }: { target: RunTarget | null; run: Run | undefined; onGo: () => void; className: string; children: React.ReactNode }) {
  if (target === null) {
    return (
      <Link to='/records' search={run ? recordsSearch(run) : {}} onClick={onGo} className={className}>
        {children}
      </Link>
    )
  }

  if (target.page === 'project') {
    return (
      <Link to='/projects/$projectId' params={{ projectId: target.projectId }} search={{ asset: target.assetId }} hash={target.hash} onClick={onGo} className={className}>
        {children}
      </Link>
    )
  }

  return (
    <Link
      to='/projects/$projectId/episodes/$episodeNo'
      params={{ projectId: target.projectId, episodeNo: String(target.episodeNo) }}
      search={{ tab: target.tab, shot: target.shotNo, flash: target.flash }}
      onClick={onGo}
      className={className}
    >
      {children}
    </Link>
  )
}

function RecordsIcon({ run, onGo }: { run: Run; onGo: () => void }) {
  return (
    <Link to='/records' search={recordsSearch(run)} onClick={onGo} title='调用记录' className='mt-1.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-line2 hover:text-foreground'>
      <Terminal className='h-3.5 w-3.5' />
    </Link>
  )
}

function recordsSearch(run: Run) {
  return { owner_kind: run.owner_kind as RecordsOwner['kind'], owner_id: run.owner_id }
}

function ActiveRunRow({ run, active, kind, onGo }: { run: RunState; active: Run | undefined; kind: string; onGo: () => void }) {
  const [cancelling, setCancelling] = useState(false)
  const last = run.lines[run.lines.length - 1]

  const cancel = () => {
    setCancelling(true)
    api
      .cancelRun(run.id)
      .then((result) => {
        if (result.cancelled === 'no') toast.info('任务已结束')
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setCancelling(false))
  }

  return (
    <div className='flex items-start gap-1 rounded-lg pr-1 hover:bg-line2'>
      <RunLink target={active === undefined ? null : runTarget(active)} run={active} onGo={onGo} className='flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2'>
        <Loader2 className='mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-busy' />
        <div className='min-w-0 flex-1'>
          <p className='text-xs font-medium'>{kind}</p>
          <p className='truncate text-xs text-muted-foreground' title={last?.text}>
            {last?.text ?? '正在启动…'}
          </p>
          <p className='font-mono text-2xs text-ink3'>{run.id}</p>
        </div>
      </RunLink>
      <Button variant='ghost' size='icon-sm' className='shrink-0 text-muted-foreground hover:bg-fail-bg hover:text-fail' title='取消' disabled={cancelling} onClick={cancel}>
        <X className='h-3.5 w-3.5' />
      </Button>
    </div>
  )
}
