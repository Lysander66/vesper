import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { type HomeView } from '@vesper/shared'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { randomVerse, type Verse } from '@/lib/verses'
import { FilmCard } from '@/components/home/film-card'
import { PulseStrip } from '@/components/home/pulse-strip'
import { NewProjectDialog } from '@/components/new-project-dialog'

export const Route = createFileRoute('/')({ component: HomePage })

type Filter = 'all' | 'draft' | 'making' | 'done'

function HomePage() {
  const home = useQuery({ queryKey: ['home'], queryFn: api.home })
  const [filter, setFilter] = useState<Filter>('all')
  if (!home.data) return null

  const projects = home.data.projects.filter((project) => filter === 'all' || phaseOf(project) === filter)

  return (
    <div className='mx-auto w-full max-w-[1280px]'>
      <div className='grid items-end gap-12 pt-14 pb-5.5 md:grid-cols-[1fr_auto]'>
        <VerseHead />
        <Resume home={home.data} />
      </div>

      <StateLine home={home.data} />
      <PulseStrip home={home.data} />

      <div className='mb-6 flex items-baseline gap-3 border-b pb-4'>
        <h2 className='text-base font-semibold'>作品</h2>
        <div className='ml-auto flex gap-px'>
          {FILTERS.map(([key, label]) => {
            const n = home.data.projects.filter((p) => key === 'all' || phaseOf(p) === key).length
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn('h-6.5 rounded-md px-2.5 text-xs text-ink3 hover:bg-line2', filter === key && 'bg-accent font-semibold text-accent-foreground')}
              >
                {label} {n}
              </button>
            )
          })}
        </div>
      </div>

      <div className='grid [grid-template-columns:repeat(auto-fill,minmax(292px,1fr))] gap-5.5 pb-20'>
        {projects.map((project) => (
          <FilmCard key={project.id} project={project} />
        ))}
        <NewProjectDialog
          trigger={
            <button className='grid place-content-center justify-items-center gap-2 rounded-xl border border-dashed p-6 text-center text-ink3 transition-colors hover:border-ink3 hover:bg-line2 hover:text-foreground'>
              <span className='text-2xl leading-none font-light'>＋</span>
              <span className='text-xs leading-relaxed'>
                粘贴一段原文
                <br />
                先看时长预估
              </span>
            </button>
          }
        />
      </div>
    </div>
  )
}

const FILTERS: readonly [Filter, string][] = [
  ['all', '全部'],
  ['draft', '草稿'],
  ['making', '制作中'],
  ['done', '已合成'],
]

function phaseOf(project: HomeView['projects'][number]): Exclude<Filter, 'all'> {
  if (project.episodes > 0 && project.films === project.episodes) return 'done'
  return project.plan_state === 'frozen' ? 'making' : 'draft'
}

function VerseHead() {
  const [verse, setVerse] = useState<Verse>(() => randomVerse())

  return (
    <button className='group text-left' title='换一句' onClick={() => setVerse(randomVerse(verse))}>
      <div className='font-serif text-[40px] leading-[1.24] font-medium tracking-[.04em]'>
        {verse.head}
        <b className='font-medium text-brand'>{verse.lead}</b>
      </div>
      <div className='mt-2.5 text-xs tracking-wide text-ink3 group-hover:text-brand'>{verse.from}</div>
    </button>
  )
}

function Resume({ home }: { home: HomeView }) {
  if (!home.resume) return null
  const where = `第 ${home.resume.episode_idx + 1} 集 · 第 ${home.resume.shot_idx + 1} 镜`

  return (
    <div className='flex flex-col items-start gap-2.5 md:items-end'>
      <div className='text-2xs text-ink3'>
        上次停在 {home.resume.project_name} · {where} · {ago(home.resume.at)}
      </div>
      <Link
        to='/projects/$projectId/episodes/$episodeNo'
        params={{ projectId: home.resume.project_id, episodeNo: String(home.resume.episode_idx + 1) }}
        search={{ shot: home.resume.shot_idx + 1 }}
        className='flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold tracking-tight text-brand-foreground shadow-[0_2px_10px_color-mix(in_srgb,var(--brand)_22%,transparent)] hover:brightness-110'
      >
        继续制作 <small className='font-mono text-2xs font-normal opacity-80'>{where}</small> →
      </Link>
    </div>
  )
}

function StateLine({ home }: { home: HomeView }) {
  const making = home.projects.filter((project) => phaseOf(project) === 'making').length

  return (
    <div className='flex flex-wrap items-center gap-2.5 pb-6.5 text-sm text-muted-foreground'>
      {home.stale > 0 && (
        <>
          <span>
            <b className='font-semibold text-stale'>{home.stale}</b> 件产物过时
          </span>
          <Divider />
        </>
      )}
      {home.running > 0 && (
        <>
          <span className='flex items-center gap-1.5'>
            <i className='h-1.5 w-1.5 animate-pulse rounded-full bg-busy shadow-[0_0_0_3px_var(--busy-bg)]' />
            <b className='font-semibold text-foreground'>{home.running}</b> 个任务进行中
          </span>
          <Divider />
        </>
      )}
      {home.unlocked > 0 && (
        <>
          <span>
            <b className='font-semibold text-foreground'>{home.unlocked}</b> 件资产未锁定
          </span>
          <Divider />
        </>
      )}
      <span>
        {home.projects.length} 部作品 · <b className='font-semibold text-foreground'>{making}</b> 部在制作
      </span>
    </div>
  )
}

function Divider() {
  return <i className='h-2.5 w-px bg-border' />
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`
  return `${Math.round(minutes / 1440)} 天前`
}
