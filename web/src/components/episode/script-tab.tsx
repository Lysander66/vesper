import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { Beat, BeatMode, EpisodeView, Review } from '@vesper/shared'
import { Clapperboard, FileText, ScanEye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { FLASH_RING, useFlashClear } from '@/lib/flash'
import { useLaunch } from '@/lib/run-center'
import { cn } from '@/lib/utils'
import { EmptyState, Section } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm'
import { Textarea } from '@/components/ui/textarea'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { LaunchParams, useLaunchParams } from '@/components/launch-params'
import { RunLog } from '@/components/run-log'
import { UtteranceEditor } from './utterance-editor'

const route = getRouteApi('/projects/$projectId_/episodes/$episodeNo')

const BEAT_MODES: Record<BeatMode, string> = {
  scene: '演出',
  narration: '旁白',
}

export function ScriptTab({ view }: { view: EpisodeView }) {
  const { episode } = view
  const params = useLaunchParams({
    projectId: episode.project_id,
    prompts: ['beats', 'shots', 'shot_prompt', 'review'],
  })
  const write = useLaunch(() => api.writeBeats(episode.id, params.extra))
  const shots = useLaunch(() => api.splitShots(episode.id, params.extra))
  const review = useLaunch(() => api.review(episode.id, params.extra))
  const queryClient = useQueryClient()
  const { beat: beatNo } = route.useSearch()
  const navigate = route.useNavigate()

  const [draft, setDraft] = useState<Beat[] | null>(null)
  const beats = draft ?? episode.beats
  const confirmed = episode.beats_state === 'confirmed'

  const save = useMutation({
    mutationFn: (next: Beat[]) => api.putBeats(episode.id, next),
    onSuccess: async () => {
      setDraft(null)
      await queryClient.invalidateQueries()
      toast.success('节拍已保存，需重新确认')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const confirm = useMutation({
    mutationFn: () => api.confirmBeats(episode.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success('节拍已确认，可拆分镜')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const edit = (index: number, patch: Partial<Beat>) => setDraft(beats.map((beat, i) => (i === index ? { ...beat, ...patch } : beat)))

  const highlight = (beatNo ?? 0) - 1
  const cards = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => {
    if (highlight >= 0) cards.current[highlight]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight])
  useFlashClear(highlight >= 0, () => void navigate({ search: (prev) => ({ ...prev, beat: undefined }), replace: true, resetScroll: false }))

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
      <Panel title='原文' meta={`${view.source.length} 字符`} body={<p className='text-sm whitespace-pre-wrap text-muted-foreground'>{view.source}</p>} />
      <Panel
        title='叙事节拍'
        meta={beats.length > 0 ? `${beats.length} 拍 · ${confirmed ? '已确认' : '草稿'}` : undefined}
        actions={
          <>
            {beats.length > 0 ? (
              <ConfirmDialog
                size='sm'
                variant='outline'
                question={confirmed ? `覆盖已确认的 ${beats.length} 拍并重新生成？` : `覆盖已有的 ${beats.length} 拍并重新生成？`}
                action='重写'
                disabled={write.busy}
                onConfirm={write.trigger}
              >
                <FileText className='h-3.5 w-3.5' />
                重写
              </ConfirmDialog>
            ) : (
              <Button size='sm' variant='outline' disabled={write.busy} onClick={write.trigger}>
                <FileText className='h-3.5 w-3.5' />
                生成节拍
              </Button>
            )}
            {draft && (
              <Button size='sm' variant='outline' disabled={save.isPending} onClick={() => save.mutate(draft)}>
                保存
              </Button>
            )}
            {!confirmed && (
              <Button size='sm' disabled={beats.length === 0 || !!draft || confirm.isPending} onClick={() => confirm.mutate()}>
                确认
              </Button>
            )}
            {view.shots.length > 0 ? (
              <ConfirmDialog
                size='sm'
                variant='outline'
                question={`覆盖已有的 ${view.shots.length} 镜及其产物并重新拆分？`}
                action='重拆'
                disabled={!confirmed || shots.busy}
                onConfirm={shots.trigger}
              >
                <Clapperboard className='h-3.5 w-3.5' />
                重拆分镜
              </ConfirmDialog>
            ) : (
              <Button size='sm' disabled={!confirmed || shots.busy} onClick={shots.trigger}>
                <Clapperboard className='h-3.5 w-3.5' />
                拆分镜
              </Button>
            )}
            <Button size='sm' variant='outline' disabled={beats.length === 0 || review.busy} onClick={review.trigger}>
              <ScanEye className='h-3.5 w-3.5' />
              审查
            </Button>
            <LaunchParams state={params} />
          </>
        }
        body={
          <>
            {write.runId && <RunLog runId={write.runId} />}
            {shots.runId && <RunLog runId={shots.runId} />}
            {review.runId && <RunLog runId={review.runId} />}
            {episode.review && <ReviewCard review={episode.review} />}
            {draft && <p className='text-xs text-warn'>有未保存的改动，保存后需重新确认</p>}
            {beats.length === 0 ? (
              <EmptyState>暂无节拍</EmptyState>
            ) : (
              beats.map((beat, index) => (
                <BeatCard
                  key={index}
                  ref={(node) => void (cards.current[index] = node)}
                  index={index}
                  beat={beat}
                  speechRate={view.speech_rate}
                  readOnly={confirmed}
                  highlight={index === highlight}
                  shotCount={view.shots.filter((shot) => shot.beat_index === index).length}
                  onOpenShots={() => {
                    const first = view.shots.find((shot) => shot.beat_index === index)
                    if (first)
                      void navigate({
                        search: (prev) => ({ ...prev, tab: 'shots', beat: undefined, shot: first.idx + 1 }),
                        resetScroll: false,
                      })
                  }}
                  onChange={(patch) => edit(index, patch)}
                  onRemove={() => setDraft(beats.filter((_, i) => i !== index))}
                />
              ))
            )}
          </>
        }
      />
    </div>
  )
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <div className='space-y-2 rounded-md border bg-line2/40 p-2.5'>
      <div className='flex items-center gap-2'>
        <span className='text-sm font-semibold'>审查</span>
        <span className={cn('font-mono text-sm', review.score < 7 && 'text-warn')}>{review.score} 分</span>
        <span className='text-2xs text-ink3'>{review.basis === 'shots' ? '依据：分镜' : '依据：节拍'}</span>
      </div>
      <p className='text-sm whitespace-pre-wrap'>{review.retelling}</p>
      {review.gaps.length > 0 && (
        <ul className='space-y-1 text-sm'>
          {review.gaps.map((gap, i) => (
            <li key={i} className='flex gap-2'>
              <span className='shrink-0 font-mono text-2xs leading-5 text-ink3'>{gap.at}</span>
              <span>{gap.missing}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BeatCard({
  ref,
  index,
  beat,
  speechRate,
  readOnly,
  highlight,
  shotCount,
  onOpenShots,
  onChange,
  onRemove,
}: {
  ref: React.Ref<HTMLDivElement>
  index: number
  beat: Beat
  speechRate: number
  readOnly: boolean
  highlight: boolean
  shotCount: number
  onOpenShots: () => void
  onChange: (patch: Partial<Beat>) => void
  onRemove: () => void
}) {
  const chars = beat.utterances.reduce((sum, line) => sum + line.text.length, 0)

  return (
    <div ref={ref} className={cn('space-y-2 rounded-md border p-2.5', highlight && FLASH_RING)}>
      <div className='flex items-center gap-2'>
        <span className='font-mono text-2xs text-ink3'>#{index + 1}</span>
        {readOnly ? (
          <Badge variant='muted' className='px-1.5 text-2xs'>
            {BEAT_MODES[beat.mode]}
          </Badge>
        ) : (
          <div className='flex gap-1'>
            {(Object.keys(BEAT_MODES) as BeatMode[]).map((mode) => (
              <ToggleChip key={mode} size='xs' on={beat.mode === mode} onClick={() => onChange({ mode })}>
                {BEAT_MODES[mode]}
              </ToggleChip>
            ))}
          </div>
        )}
        {chars > 0 && (
          <span className='font-mono text-2xs text-ink3'>
            {beat.utterances.length} 句 · 朗读约 {Math.ceil(chars / speechRate)}s
          </span>
        )}
        <div className='flex flex-1 items-center justify-end gap-1'>
          {shotCount > 0 && (
            <button className='flex-1 self-stretch px-2 text-right font-mono text-2xs text-ink3 underline-offset-2 hover:text-foreground hover:underline' title='查看镜头' onClick={onOpenShots}>
              {shotCount} 镜
            </button>
          )}
          {!readOnly && (
            <Button variant='ghost' size='icon-sm' className='text-muted-foreground hover:bg-fail-bg hover:text-fail' onClick={onRemove} title='删除该节拍' aria-label='删除该节拍'>
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>
      </div>

      {readOnly ? <p className='text-sm'>{beat.summary}</p> : <Textarea value={beat.summary} rows={2} onChange={(event) => onChange({ summary: event.target.value })} />}

      <UtteranceEditor utterances={beat.utterances} readOnly={readOnly} onChange={(utterances) => onChange({ utterances })} />
    </div>
  )
}

function Panel({ title, meta, actions, body }: { title: string; meta?: string; actions?: React.ReactNode; body: React.ReactNode }) {
  return (
    <Section title={title} meta={meta} actions={actions} bodyClassName='p-0'>
      <div className='max-h-[calc(100vh-266px)] space-y-3 overflow-y-auto p-3'>{body}</div>
    </Section>
  )
}
