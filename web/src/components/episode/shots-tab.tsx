import { useEffect, useState, type ReactNode } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import type { Artifact, EpisodeView, Shot } from '@vesper/shared'
import { Plus, SkipBack, SkipForward } from 'lucide-react'
import { fileUrl, videoUrl } from '@/lib/api'
import { FLASH_RING, useFlash } from '@/lib/flash'
import { SLOT_LABEL } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Segmented } from '@/components/ui/segmented'
import { ArtifactVersions } from '@/components/artifact'
import { ShotPanel, useInsertShot, type PanelPage } from './shot-panel'

const route = getRouteApi('/projects/$projectId_/episodes/$episodeNo')

const clipOf = (shot: Shot) => shot.artifacts.find((artifact) => artifact.kind === 'clip' && artifact.path)

const VIDEO_FRAME = 'w-full max-h-[62vh] rounded-lg'

type Mode = 'shots' | 'film'
const MODE_LABEL: Record<Mode, string> = { shots: '逐镜', film: '合成版' }

export function ShotsTab({ view }: { view: EpisodeView }) {
  const { shot: shotNo, flash: flashOf } = route.useSearch()
  const navigate = route.useNavigate()
  const shots = view.shots
  const flash = flashOf === 'film'
  const insert = useInsertShot(view.episode.id)
  const [page, setPage] = useState<PanelPage>('info')
  const [playing, setPlaying] = useState(false)
  // 每次合成任务跳过来都要切回合成版，所以跟着 flash 的变化走，不只看初值。
  const [mode, setMode] = useState<Mode>(flash ? 'film' : 'shots')
  const [lastFlash, setLastFlash] = useState(flash)
  if (flash !== lastFlash) {
    setLastFlash(flash)
    if (flash) setMode('film')
  }
  const flashRef = useFlash<HTMLDivElement>(flash)
  const [clipSlot, setClipSlot] = useState<HTMLElement | null>(null)

  const current = shots.find((item) => item.idx === (shotNo ?? 1) - 1) ?? shots[0]
  const select = (shot: Shot, play: boolean) => {
    setMode('shots')
    setPlaying(play)
    void navigate({ search: (prev) => ({ ...prev, shot: shot.idx + 1 }), resetScroll: false })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || current === undefined) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
      if (document.querySelector('[role="dialog"]')) return
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      const next = shots[shots.indexOf(current) + delta]
      if (delta === 0 || !next) return
      event.preventDefault()
      select(next, playing)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 故意不给依赖数组：`select` 闭包里是当前镜号，只绑一次就永远从第一镜往下走。
  })

  if (current === undefined) {
    return (
      <NoShots>
        <Button size='sm' variant='outline' disabled={insert.isPending} onClick={() => insert.mutate(null)}>
          <Plus className='h-3.5 w-3.5' />
          添加镜头
        </Button>
      </NoShots>
    )
  }
  const nextWithClip = (from: number) => shots.slice(from + 1).find((shot) => clipOf(shot) !== undefined)
  const film = view.film?.path ? view.film : null
  const modeSwitch = film && (
    <Segmented
      value={mode}
      options={['shots', 'film'] as const}
      onChange={setMode}
      className='min-h-8'
      render={(option) => (
        <span className='flex items-center gap-1'>
          {MODE_LABEL[option]}
          {option === 'film' && film.state === 'stale' && <i className='h-1.5 w-1.5 rounded-full bg-stale' title='合成后镜头有改动' />}
        </span>
      )}
    />
  )

  return (
    <div className='flex flex-col gap-4 lg:flex-row lg:items-start'>
      <div className='min-w-0 space-y-4 lg:w-1/2 lg:shrink-0'>
        <div ref={flashRef} className={cn(flash && FLASH_RING)}>
          {mode === 'film' && film ? (
            <FilmPlayer episodeId={view.episode.id} film={film} modeSwitch={modeSwitch} />
          ) : (
            <Player
              shots={shots}
              current={current}
              autoPlay={playing}
              modeSwitch={modeSwitch}
              onPlaying={setPlaying}
              onClipSlot={setClipSlot}
              onEnded={() => {
                const next = nextWithClip(current.idx)
                if (next) select(next, true)
                else setPlaying(false)
              }}
              onStep={(shot) => select(shot, playing)}
            />
          )}
        </div>
        <BeatGroups view={view} currentId={mode === 'film' ? '' : current.id} onPick={(shot) => select(shot, playing)} />
      </div>
      <div className='min-w-0 flex-1 lg:sticky lg:top-17 lg:h-[calc(100vh-84px)]'>
        {mode === 'film' && film ? (
          <FilmPanel view={view} />
        ) : (
          <ShotPanel
            key={current.id}
            shot={current}
            total={shots.length}
            projectId={view.episode.project_id}
            audioMode={view.audio_mode}
            continuityMode={view.continuity_mode}
            flash={flashOf === 'artifacts'}
            page={page}
            onPage={setPage}
            clipSlot={clipSlot}
            className='h-full'
          />
        )}
      </div>
    </div>
  )
}

function VideoStage({
  path,
  autoPlay,
  onTime,
  onPlaying,
  onEnded,
  empty,
}: {
  path: string | null
  autoPlay?: boolean
  onTime?: (at: number) => void
  onPlaying?: (playing: boolean) => void
  onEnded?: () => void
  empty: string
}) {
  if (!path) {
    return <div className={cn('flex aspect-video items-center justify-center bg-line2 text-sm text-ink3', VIDEO_FRAME)}>{empty}</div>
  }
  return (
    <video
      key={path}
      src={fileUrl(path)}
      controls
      autoPlay={autoPlay}
      className={cn('bg-black object-contain', VIDEO_FRAME)}
      onTimeUpdate={(event) => onTime?.(event.currentTarget.currentTime)}
      onPlay={() => onPlaying?.(true)}
      onPause={() => onPlaying?.(false)}
      onEnded={onEnded}
    />
  )
}

function Player({
  shots,
  current,
  autoPlay,
  modeSwitch,
  onPlaying,
  onClipSlot,
  onEnded,
  onStep,
}: {
  shots: readonly Shot[]
  current: Shot
  autoPlay: boolean
  modeSwitch: React.ReactNode
  onPlaying: (playing: boolean) => void
  onClipSlot: (node: HTMLElement | null) => void
  onEnded: () => void
  onStep: (shot: Shot) => void
}) {
  const clip = clipOf(current)
  const [progress, setProgress] = useState({ id: '', at: 0 })
  const time = progress.id === current.id ? progress.at : 0
  // 按计划秒数累加，不逐个读视频时长：差零点几秒不影响看出播到哪。
  const before = shots.slice(0, current.idx).reduce((sum, shot) => sum + shot.seconds, 0)
  const total = shots.reduce((sum, shot) => sum + shot.seconds, 0)

  return (
    <div className='space-y-2'>
      <VideoStage
        path={clip?.path ?? null}
        autoPlay={autoPlay}
        onTime={(at) => setProgress({ id: current.id, at })}
        onPlaying={onPlaying}
        onEnded={onEnded}
        empty={`第 ${current.idx + 1} 镜${SLOT_LABEL[current.status]}`}
      />
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {modeSwitch}
        <Button variant='ghost' size='icon-sm' title='上一镜' aria-label='上一镜' disabled={current.idx === 0} onClick={() => onStep(shots[current.idx - 1])}>
          <SkipBack className='h-3.5 w-3.5' />
        </Button>
        <Button variant='ghost' size='icon-sm' title='下一镜' aria-label='下一镜' disabled={current.idx === shots.length - 1} onClick={() => onStep(shots[current.idx + 1])}>
          <SkipForward className='h-3.5 w-3.5' />
        </Button>
        <span className='font-medium text-foreground'>
          第 {current.idx + 1} 镜 / 共 {shots.length} 镜
        </span>
        <span className='font-mono'>
          {clock(before + time)} / {clock(total)}
        </span>
        <span ref={onClipSlot} className='ml-auto' />
      </div>
    </div>
  )
}

function FilmPlayer({ episodeId, film, modeSwitch }: { episodeId: string; film: Artifact; modeSwitch: React.ReactNode }) {
  return (
    <div className='space-y-2'>
      <VideoStage path={film.path} autoPlay empty='' />
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {modeSwitch}
        <span className='ml-auto'>
          <ArtifactVersions owner={{ kind: 'episode', id: episodeId }} kind='film' version={film.version} />
        </span>
      </div>
    </div>
  )
}

function FilmPanel({ view }: { view: EpisodeView }) {
  const film = view.film
  const total = view.shots.reduce((sum, shot) => sum + shot.seconds, 0)

  return (
    <div className='flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs'>
      <div className='flex items-center gap-2'>
        <h3 className='text-sm font-semibold'>合成版</h3>
        <span className='font-mono text-2xs text-ink3'>
          {view.shots.length} 镜 · {clock(total)}
        </span>
      </div>
      {film?.state === 'stale' && <p className='text-xs text-stale'>合成后镜头有改动，需重新合成</p>}
      {film?.path && (
        <div className='flex items-center gap-1 rounded-md border px-2 py-1'>
          <span className='flex-1 truncate font-mono text-2xs' title={film.path}>
            {film.path}
          </span>
          <CopyButton text={film.path} />
        </div>
      )}
    </div>
  )
}

function BeatGroups({ view, currentId, onPick }: { view: EpisodeView; currentId: string; onPick: (shot: Shot) => void }) {
  const groups = new Map<number, Shot[]>()
  for (const shot of view.shots) groups.set(shot.beat_index, [...(groups.get(shot.beat_index) ?? []), shot])

  return (
    <div className='space-y-3'>
      {[...groups].map(([beat, shots]) => (
        <section key={beat} className='space-y-1.5'>
          <h3 className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='shrink-0 font-semibold'>{beat < 0 ? '手动添加' : `第 ${beat + 1} 拍`}</span>
            <span className='shrink-0 font-mono text-2xs text-ink3'>
              {shots.length} 镜 · {Math.round(shots.reduce((sum, shot) => sum + shot.seconds, 0))}s
            </span>
            {beat >= 0 && <span className='min-w-0 truncate text-muted-foreground'>{view.episode.beats[beat]?.summary ?? ''}</span>}
          </h3>
          <div className='grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2'>
            {shots.map((shot) => (
              <Thumb key={shot.id} shot={shot} current={shot.id === currentId} onPick={() => onPick(shot)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Thumb({ shot, current, onPick }: { shot: Shot; current: boolean; onPick: () => void }) {
  const frame = shot.artifacts.find((artifact) => artifact.kind === 'first_frame' && artifact.path)
  const clip = clipOf(shot)

  return (
    <button
      title={shot.summary}
      className={cn('relative aspect-video w-full overflow-hidden rounded-md bg-line2 ring-offset-2 ring-offset-background', current ? 'ring-2 ring-brand' : 'hover:ring-1 hover:ring-border')}
      onClick={onPick}
    >
      {frame?.path ? (
        <img src={fileUrl(frame.path)} alt={`第 ${shot.idx + 1} 镜`} className='h-full w-full object-cover' />
      ) : clip?.path ? (
        <video src={videoUrl(clip.path)} preload='metadata' muted className='pointer-events-none h-full w-full object-cover' />
      ) : (
        <span className='text-2xs text-ink3'>{SLOT_LABEL[shot.status]}</span>
      )}
      <span className='absolute top-1 left-1 rounded-sm bg-black/60 px-1 font-mono text-2xs text-white'>{shot.idx + 1}</span>
      <span className='absolute right-1 bottom-1 rounded-sm bg-black/60 px-1 font-mono text-2xs text-white'>{shot.seconds}s</span>
    </button>
  )
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function NoShots({ children }: { children?: ReactNode }) {
  return (
    <div className='space-y-3 py-8 text-center'>
      <p className='text-sm text-muted-foreground'>暂无分镜</p>
      {children}
    </div>
  )
}
