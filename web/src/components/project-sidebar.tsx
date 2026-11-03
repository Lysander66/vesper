import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { allEpisodes, ASSET_CATEGORY_LABEL, type AssetCategory, type EpisodeSummary } from '@vesper/shared'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { usePopover } from '@/lib/popover'
import { episodeMeta, episodeTone, TONE_TEXT } from '@/lib/status'
import { cn } from '@/lib/utils'
import { CATEGORY_ICON } from '@/components/asset-card'

const COLLAPSE_KEY = 'vesper.sidebar'

export function ProjectSidebar() {
  const { projectId } = useParams({ strict: false })
  if (!projectId) return null
  return <Sidebar projectId={projectId} />
}

function Sidebar({ projectId }: { projectId: string }) {
  const view = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'collapsed')
  const episodes = view.data ? allEpisodes(view.data) : []

  const toggle = () => {
    setCollapsed(!collapsed)
    localStorage.setItem(COLLAPSE_KEY, collapsed ? 'open' : 'collapsed')
  }

  return (
    <aside className={cn('group sticky top-13 flex h-[calc(100vh-52px)] flex-none flex-col overflow-hidden border-r bg-card transition-[width] duration-150', collapsed ? 'w-14' : 'w-[236px]')}>
      {!collapsed && (
        <div className='relative z-20 flex items-center gap-1 border-b p-2'>
          <ProjectPicker projectId={projectId} name={view.data?.project.name ?? '…'} />
        </div>
      )}

      <div className='flex-1 overflow-y-auto px-2.5 pt-3 pb-20'>
        {!collapsed && <p className='px-2 pb-1.5 font-mono text-2xs tracking-[0.04em] text-ink3 uppercase'>分集</p>}
        {episodes.length === 0 && !collapsed && <p className='px-2 text-xs text-muted-foreground'>暂无分集</p>}
        {episodes.map((episode) => (
          <EpisodeLink key={episode.id} projectId={projectId} episode={episode} collapsed={collapsed} />
        ))}
      </div>

      <button
        className={cn(
          'absolute top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-brand/35 bg-card text-brand shadow-md transition-all hover:border-brand hover:bg-line2',
          collapsed ? 'left-1/2 -translate-x-1/2 opacity-100' : 'right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        )}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        onClick={toggle}
      >
        {collapsed ? <ChevronRight className='h-3.5 w-3.5' /> : <ChevronLeft className='h-3.5 w-3.5' />}
      </button>

      <div className={cn('absolute inset-x-2.5 bottom-2.5 z-10 flex gap-1 rounded-xl border bg-card p-1 shadow-lg', collapsed && 'flex-col')}>
        <DockButton projectId={projectId} hash='cast' category='character' count={view.data?.cast.length ?? 0} collapsed={collapsed} />
        <DockButton projectId={projectId} hash='scenes' category='scene' count={view.data?.scenes.length ?? 0} collapsed={collapsed} />
        <DockButton projectId={projectId} hash='props' category='prop' count={view.data?.props.length ?? 0} collapsed={collapsed} />
      </div>
    </aside>
  )
}

function EpisodeLink({ projectId, episode, collapsed }: { projectId: string; episode: EpisodeSummary; collapsed: boolean }) {
  const tone = TONE_TEXT[episodeTone(episode)]

  return (
    <Link
      to='/projects/$projectId/episodes/$episodeNo'
      params={{ projectId, episodeNo: String(episode.idx + 1) }}
      title={`第 ${episode.idx + 1} 集 · ${episode.title}`}
      className='block rounded-md border-l-2 border-transparent px-2 py-1.5 transition-colors hover:bg-line2'
      activeProps={{ className: 'border-l-brand bg-accent' }}
    >
      {collapsed ? (
        <span className={cn('block text-center font-mono text-2xs', tone)}>EP{episode.idx + 1}</span>
      ) : (
        <>
          <span className='block truncate text-sm font-semibold'>{episode.title}</span>
          <span className={cn('mt-0.5 block font-mono text-2xs tracking-[0.02em]', tone)}>
            EP{episode.idx + 1} · {episodeMeta(episode)}
          </span>
        </>
      )}
    </Link>
  )
}

function DockButton({ projectId, hash, category, count, collapsed }: { projectId: string; hash: string; category: AssetCategory; count: number; collapsed: boolean }) {
  const Icon = CATEGORY_ICON[category]
  const label = ASSET_CATEGORY_LABEL[category]

  return (
    <Link to='/projects/$projectId' params={{ projectId }} hash={hash} title={`${label} ${count}`} className='flex flex-1 flex-col items-center rounded-lg px-0 py-1 transition-colors hover:bg-line2'>
      <Icon className='h-3.5 w-3.5 text-muted-foreground' />
      <span className='font-mono text-2xs leading-3 text-ink3'>{collapsed ? count : `${label} ${count}`}</span>
    </Link>
  )
}

function ProjectPicker({ projectId, name }: { projectId: string; name: string }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: open })

  return (
    <div className='min-w-0 flex-1' ref={ref}>
      <button className='flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-semibold tracking-tight transition-colors hover:bg-line2' onClick={() => setOpen(!open)}>
        <span className='truncate'>{name}</span>
        <ChevronDown className='ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground' />
      </button>

      {open && (
        <div className='absolute inset-x-2 top-[calc(100%-4px)] rounded-xl border bg-popover p-1.5 shadow-md'>
          {projects.data?.map((project) => (
            <Link
              key={project.id}
              to='/projects/$projectId'
              params={{ projectId: project.id }}
              className={cn('block truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-line2', project.id === projectId && 'font-semibold text-accent-foreground')}
              onClick={() => setOpen(false)}
            >
              {project.name}
            </Link>
          ))}
          <div className='my-1.5 h-px bg-border' />
          <Link to='/' className='block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-line2' onClick={() => setOpen(false)}>
            全部作品…
          </Link>
        </div>
      )}
    </div>
  )
}
