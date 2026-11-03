import { Link } from '@tanstack/react-router'
import { HOME_STAGES, type HomeProject } from '@vesper/shared'
import { fileUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export function FilmCard({ project }: { project: HomeProject }) {
  const done = project.total > 0 ? (project.ready / project.total) * 100 : 0
  const stale = project.total > 0 ? (project.stale / project.total) * 100 : 0

  return (
    <Link
      to='/projects/$projectId'
      params={{ projectId: project.id }}
      className='overflow-hidden rounded-xl border bg-card transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-[3px] hover:border-ink3/40 hover:shadow-lg'
    >
      <Cover project={project} />
      <div className='px-4 pt-3.5 pb-4'>
        <div className='flex items-baseline gap-2'>
          <h3 className='truncate text-base font-semibold'>{project.name}</h3>
          <span className='ml-auto shrink-0 text-2xs text-ink3'>{project.style || '画风待定'}</span>
        </div>
        <p className='mt-0.5 truncate text-2xs text-ink3'>
          {project.source_name || '未命名原文'} · {formatChars(project.char_count).join(' ')}
        </p>

        <StageTrack stage={project.stage} />

        <div className='flex h-1 gap-px overflow-hidden rounded-sm bg-line2'>
          <i className='block h-full bg-ok' style={{ width: `${done}%` }} />
          <i className='block h-full bg-stale' style={{ width: `${stale}%` }} />
        </div>
        <div className='mt-2.5 flex items-center gap-1.5 text-2xs text-ink3'>
          <span>{sizeLabel(project)}</span>
          {project.stale > 0 && (
            <em className='inline-flex items-center gap-1 text-stale not-italic before:h-1.5 before:w-1.5 before:rounded-sm before:bg-current before:content-[""]'>过时 {project.stale}</em>
          )}
          <span className='ml-auto font-medium text-muted-foreground'>{project.total > 0 ? `${project.percent}%` : '—'}</span>
        </div>
      </div>
    </Link>
  )
}

function Cover({ project }: { project: HomeProject }) {
  if (project.cover === null) {
    const [value, unit] = formatChars(project.char_count)
    return (
      <div className='relative grid aspect-video place-content-center gap-1.5 bg-gradient-to-br from-line2 to-border p-4 text-center'>
        <div className='font-mono text-xl font-medium tracking-tight text-muted-foreground'>{value}</div>
        <div className='text-xs text-ink3'>
          {unit} · {project.plan_state === 'frozen' ? '待拆分镜' : '待分集定稿'}
        </div>
      </div>
    )
  }

  const flag = flagOf(project)
  return (
    <div className='relative aspect-video overflow-hidden bg-foreground after:absolute after:inset-0 after:shadow-[inset_0_0_50px_rgba(0,0,0,.4)] after:content-[""]'>
      <img src={fileUrl(project.cover)} alt='' className='absolute inset-0 h-full w-full object-contain' />
      {flag && (
        <span className={cn('absolute top-2 left-2 z-2 rounded-md px-2 py-0.5 text-2xs font-semibold', flag.tone === 'stale' ? 'bg-stale-bg text-stale' : 'bg-white/95 text-foreground')}>
          {flag.text}
        </span>
      )}
      <span className='absolute right-2 bottom-2 z-2 font-mono text-2xs tracking-[.1em] text-white/50'>{project.aspect}</span>
    </div>
  )
}

function StageTrack({ stage }: { stage: number }) {
  return (
    <div className='my-3.5 flex items-center'>
      {HOME_STAGES.map((label, i) => {
        const state = i + 1 < stage ? 'done' : i + 1 === stage ? 'now' : 'idle'
        return (
          <div key={label} className='contents'>
            {i > 0 && <div className={cn('mx-px mb-4 h-[1.5px] flex-1', i < stage - 1 ? 'bg-brand' : 'bg-border')} />}
            <div className='flex w-[15px] flex-none flex-col items-center gap-1.5'>
              <i
                className={cn(
                  'h-[9px] w-[9px] rounded-full border-[1.5px] border-border bg-card',
                  state === 'done' && 'border-brand bg-brand',
                  state === 'now' && 'border-brand bg-[linear-gradient(90deg,var(--brand)_0_50%,var(--card)_50%_100%)]'
                )}
              />
              <em className={cn('text-2xs whitespace-nowrap text-ink3 not-italic', state === 'done' && 'text-muted-foreground', state === 'now' && 'font-semibold text-brand')}>{label}</em>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function flagOf(project: HomeProject): { text: string; tone: 'stale' | 'plain' } | null {
  if (project.stale > 0) return { text: `${project.stale} 件过时`, tone: 'stale' }
  if (project.films > 0 && project.films === project.episodes) return { text: '已合成', tone: 'plain' }
  return null
}

function sizeLabel(project: HomeProject): string {
  if (project.episodes === 0) return '待分集'
  if (project.shots === 0) return `${project.episodes} 集 · 未拆分镜`
  return `${project.episodes} 集 · ${project.shots} 镜`
}

function formatChars(n: number): [string, string] {
  return n >= 10000 ? [(n / 10000).toFixed(1), '万字'] : [String(n), '字']
}
