import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { allEpisodes, type Progress, type SlotStatus } from '@vesper/shared'
import { ChevronDown, ChevronRight, Clapperboard, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { useFlashClear } from '@/lib/flash'
import { SLOT_LABEL, SLOT_TONE } from '@/lib/status'
import { cn } from '@/lib/utils'
import { EmptyState, LoadingState, PageHeader } from '@/components/layout/page'
import { StatusChip } from '@/components/ui/status-chip'
import { EpisodeActions } from '@/components/episode/episode-actions'
import { ScriptTab } from '@/components/episode/script-tab'
import { ShotsTab } from '@/components/episode/shots-tab'

const TABS = [
  { key: 'script', label: '脚本', icon: FileText },
  { key: 'shots', label: '分镜', icon: Clapperboard },
] as const

type Tab = (typeof TABS)[number]['key']

interface EpisodeSearch {
  tab?: Tab
  shot?: number
  beat?: number
  flash?: Flash
}

const FLASHES = ['artifacts', 'film'] as const

type Flash = (typeof FLASHES)[number]

const TAB_KEY = 'vesper.episode-tab'

function rememberedTab(): Tab {
  const saved = localStorage.getItem(TAB_KEY)
  return TABS.some((item) => item.key === saved) ? (saved as Tab) : 'script'
}

// 文件名里 `$projectId_` 的下划线让本路由不嵌进 projects.$projectId（那个路由没有 Outlet），URL 里不带。
export const Route = createFileRoute('/projects/$projectId_/episodes/$episodeNo')({
  component: EpisodePage,
  validateSearch: (search: Record<string, unknown>): EpisodeSearch => {
    const shot = Number(search.shot)
    const beat = Number(search.beat)
    return {
      tab: TABS.some((item) => item.key === search.tab) ? (search.tab as Tab) : undefined,
      shot: Number.isInteger(shot) && shot > 0 ? shot : undefined,
      beat: Number.isInteger(beat) && beat > 0 ? beat : undefined,
      flash: FLASHES.includes(search.flash as Flash) ? (search.flash as Flash) : undefined,
    }
  },
})

function EpisodePage() {
  const { projectId, episodeNo } = Route.useParams()
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) })

  if (project.isError) return <p className='text-sm text-fail'>{project.error.message}</p>
  if (!project.data) return <LoadingState />
  const summary = allEpisodes(project.data).find((item) => item.idx === Number(episodeNo) - 1)
  if (!summary) return <EmptyState>暂无第 {episodeNo} 集</EmptyState>
  return <EpisodeBody key={summary.id} episodeId={summary.id} projectId={projectId} projectName={project.data.project.name} />
}

function EpisodeBody({ episodeId, projectId, projectName }: { episodeId: string; projectId: string; projectName: string }) {
  const view = useQuery({ queryKey: ['episode', episodeId], queryFn: () => api.episode(episodeId) })
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const tab = search.tab ?? rememberedTab()

  useEffect(() => localStorage.setItem(TAB_KEY, tab), [tab])

  useFlashClear(search.flash !== undefined, () => navigate({ search: (prev) => ({ ...prev, flash: undefined }), replace: true, resetScroll: false }))

  if (view.isError) return <p className='text-sm text-fail'>{view.error.message}</p>
  if (!view.data) return <LoadingState />
  const { episode } = view.data

  return (
    <div className='space-y-3'>
      <PageHeader
        title={episode.title}
        lead={
          <>
            <Link to='/projects/$projectId' params={{ projectId }} className='hover:text-foreground'>
              {projectName}
            </Link>
            <ChevronRight className='mx-0.5 inline h-3.5 w-3.5 align-[-2px]' />
            <span className='text-secondary-foreground'>第 {episode.idx + 1} 集</span>
          </>
        }
        meta={<p className='truncate'>{episode.synopsis}</p>}
        actions={<EpisodeActions view={view.data} />}
      />

      <StatusBar progress={view.data.progress} targetSeconds={view.data.target_seconds} />

      <nav className='flex items-center gap-1 border-b'>
        {TABS.map((item) => (
          <button
            key={item.key}
            className={cn(
              'flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
              tab === item.key && 'border-b-brand font-semibold text-foreground'
            )}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, tab: item.key }) })}
          >
            <item.icon className='h-3.5 w-3.5' />
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'script' && <ScriptTab view={view.data} />}
      {tab === 'shots' && <ShotsTab view={view.data} />}
    </div>
  )
}

function StatusBar({ progress, targetSeconds }: { progress: Progress | null; targetSeconds: number }) {
  const [open, setOpen] = useState(false)
  if (!progress) return null

  const capped = targetSeconds > 0
  const delta = progress.total_seconds - targetSeconds
  const verdict = {
    ready: { tone: 'ok' as const, text: '可以合成' },
    needs_confirm: { tone: 'stale' as const, text: '有产物已过时' },
    blocked: { tone: 'warn' as const, text: '仍有镜头未完成' },
  }[progress.assemblable]

  return (
    <div className='rounded-lg border bg-card'>
      <button className='flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-line2' onClick={() => setOpen(!open)}>
        <div className='h-1.5 w-30 flex-none overflow-hidden rounded-full bg-line2'>
          <div className='h-full bg-ok transition-all' style={{ width: `${progress.percent}%` }} />
        </div>
        <span className='font-mono text-xs'>{progress.percent}%</span>
        <StatusChip tone={verdict.tone}>{verdict.text}</StatusChip>
        <span className='font-mono text-2xs text-muted-foreground'>
          {progress.total_seconds.toFixed(1)}s
          {capped && (
            <>
              {' / '}
              {targetSeconds}s
              <span className={cn('ml-1', Math.abs(delta) > 10 && 'text-stale')}>
                ({delta >= 0 ? '+' : ''}
                {delta.toFixed(1)})
              </span>
            </>
          )}
        </span>
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className='flex flex-wrap gap-1.5 border-t px-3 py-2.5'>
          {(Object.keys(progress.counts) as SlotStatus[]).map((status) => (
            <StatusChip key={status} tone={SLOT_TONE[status]} className='font-mono font-normal'>
              {SLOT_LABEL[status]} {progress.counts[status]}
            </StatusChip>
          ))}
        </div>
      )}
    </div>
  )
}
