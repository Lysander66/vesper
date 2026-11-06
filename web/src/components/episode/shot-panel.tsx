import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  ARTIFACT_KIND_LABEL,
  CAMERA_MOVE_LABEL,
  CAMERA_MOVES,
  CLIP_SOURCE_LABEL,
  CLIP_SOURCES,
  SHOT_JOIN_LABEL,
  SHOT_JOINS,
  SHOT_SIZE_LABEL,
  SHOT_SIZES,
  type ArtifactKind,
  type AudioMode,
  type ContinuityMode,
  type Shot,
} from '@vesper/shared'
import { PencilLine, Plus, Sparkles, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { FLASH_RING, useFlash } from '@/lib/flash'
import { useLaunch } from '@/lib/run-center'
import { SLOT_LABEL, SLOT_TONE } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { StatusChip } from '@/components/ui/status-chip'
import { TextField } from '@/components/ui/text-field'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { ArtifactSlot, ArtifactThumb } from '@/components/artifact'
import { LaunchGroup, useLaunchParams, type LaunchParamsState } from '@/components/launch-params'
import { RunLog } from '@/components/run-log'
import { ShotPreview, ShotRefs } from '@/components/shot-preview'
import { UtteranceEditor } from './utterance-editor'

const route = getRouteApi('/projects/$projectId_/episodes/$episodeNo')

export type PanelPage = 'info' | 'prompt'
const PAGE_LABEL: Record<PanelPage, string> = { info: '信息', prompt: '提示词' }

export function ShotPanel({
  shot,
  total,
  projectId,
  audioMode,
  continuityMode,
  flash,
  page,
  onPage,
  clipSlot,
  className,
}: {
  shot: Shot
  total: number
  projectId: string
  audioMode: AudioMode
  continuityMode: ContinuityMode
  flash: boolean
  page: PanelPage
  onPage: (page: PanelPage) => void
  clipSlot: HTMLElement | null
  className?: string
}) {
  const flashRef = useFlash<HTMLDivElement>(flash)
  const [editing, setEditing] = useState(false)
  const insert = useInsertShot(shot.episode_id)
  const remove = useDeleteShot()
  const params = useLaunchParams({
    projectId,
    roles: ['image', 'video', 'tts'],
    prompts: ['shot_prompt', 'first_frame', 'clip'],
    audioMode,
    continuityMode,
  })
  // 生成哪几项在点击时才定，等不到 setState 生效，所以用 ref。
  const kinds = useRef<readonly ArtifactKind[] | undefined>(undefined)
  const produce = useLaunch(() => api.produceShot(shot.id, kinds.current, params.extra))
  const polish = useLaunch(() => api.polishShot(shot.id, params.extra))
  const launch = (pick?: readonly ArtifactKind[]) => {
    kinds.current = pick
    produce.trigger()
  }

  const hasFrameInput = shot.clip_source === 'reference' || shot.artifacts.some((artifact) => artifact.kind === 'first_frame')
  const slot = (kind: ArtifactKind) => <ShotSlot shot={shot} kind={kind} hasFrameInput={hasFrameInput} busy={produce.busy} onLaunch={launch} />

  return (
    <div ref={flashRef} className={cn('flex min-w-0 flex-1 flex-col gap-4 rounded-lg border bg-card p-4 shadow-xs', flash && FLASH_RING, className)}>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='flex items-baseline gap-1 text-sm leading-none font-semibold'>
          第 {shot.idx + 1} 镜<span className='font-mono text-2xs font-normal text-ink3'>/ {total}</span>
        </h3>
        <StatusChip tone={SLOT_TONE[shot.status]}>{SLOT_LABEL[shot.status]}</StatusChip>
        <span className='ml-1 flex items-center gap-1'>
          <Button variant='ghost' size='icon-sm' title='镜头设定' aria-label='镜头设定' className='text-muted-foreground' onClick={() => setEditing(true)}>
            <PencilLine className='h-3.5 w-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            title='在本镜后插入一镜'
            aria-label='在本镜后插入一镜'
            className='text-muted-foreground'
            disabled={insert.isPending}
            onClick={() => insert.mutate(shot.id)}
          >
            <Plus className='h-3.5 w-3.5' />
          </Button>
          <ConfirmDialog tooltip='删除本镜' question='删除本镜及其产物？' disabled={remove.isPending} onConfirm={() => remove.mutate(shot)}>
            <Trash2 className='h-3.5 w-3.5' />
          </ConfirmDialog>
        </span>
        <LaunchGroup state={params} onLaunch={() => launch()} label='全部生成' variant='default' className='ml-auto' busy={produce.busy} />
      </div>

      {produce.runId && <RunLog runId={produce.runId} />}
      {polish.runId && <RunLog runId={polish.runId} />}

      <Segmented value={page} options={['info', 'prompt'] as const} onChange={onPage} className='min-h-8 w-fit' render={(option) => PAGE_LABEL[option]} />

      <div className='-mr-2 min-h-0 flex-1 overflow-y-auto pr-2'>
        {page === 'info' ? (
          <ShotInfo shot={shot} state={params} frame={slot('first_frame')} voice={slot('voice')} />
        ) : (
          // 重写保存后两段值变化，整块重新挂载，本地草稿才会换成新稿。
          <ShotEditor key={`${shot.image_prompt}\0${shot.motion_prompt}`} shot={shot} state={params} polish={polish} />
        )}
      </div>

      {clipSlot && createPortal(slot('clip'), clipSlot)}
      <ShotSheet shot={shot} projectId={projectId} open={editing} onOpenChange={setEditing} />
    </div>
  )
}

function ShotSlot({ shot, kind, hasFrameInput, busy, onLaunch }: { shot: Shot; kind: ArtifactKind; hasFrameInput: boolean; busy: boolean; onLaunch: (kinds: readonly ArtifactKind[]) => void }) {
  const status = shot.slots?.[kind] ?? 'missing'
  const artifact = shot.artifacts.find((item) => item.kind === kind)
  if (status === 'skipped' && !artifact) return null
  return (
    <ArtifactSlot
      kind={kind}
      owner={{ kind: 'shot', id: shot.id }}
      status={status}
      artifact={artifact}
      onGenerate={() => onLaunch([kind])}
      busy={busy}
      blockedReason={kind === 'clip' && !hasFrameInput ? '需先生成首帧' : undefined}
    />
  )
}

function ShotInfo({ shot, state, frame, voice }: { shot: Shot; state: LaunchParamsState; frame: ReactNode; voice: ReactNode }) {
  const spoken = shot.utterances.filter((line) => line.text.trim() !== '')
  const framePath = shot.artifacts.find((artifact) => artifact.kind === 'first_frame')?.path ?? null

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-sm leading-relaxed'>{shot.summary}</p>
      {shot.clip_source === 'first_frame' && (
        <InfoGroup label={ARTIFACT_KIND_LABEL.first_frame}>
          <div className='flex items-start gap-3'>
            <div className={cn('aspect-video h-20 overflow-hidden rounded-md border bg-line2/40', !framePath && 'border-dashed')}>
              {framePath && <ArtifactThumb kind='first_frame' path={framePath} />}
            </div>
            {frame}
          </div>
        </InfoGroup>
      )}
      <ShotRefs shotId={shot.id} state={state} />

      {spoken.length > 0 && (
        <InfoGroup label='台词' extra={voice}>
          <div className='space-y-2'>
            {spoken.map((line, index) => (
              <div key={index} className='space-y-0.5'>
                <p className='text-sm'>
                  <span className='mr-1.5 text-2xs font-semibold text-ink3'>{line.speaker ?? '旁白'}</span>
                  {`「${line.text}」`}
                </p>
                {line.how && <p className='text-xs leading-relaxed text-muted-foreground'>{line.how}</p>}
              </div>
            ))}
          </div>
        </InfoGroup>
      )}

      {shot.sound && (
        <InfoGroup label='声音'>
          <p className='text-xs leading-relaxed text-muted-foreground'>{shot.sound}</p>
        </InfoGroup>
      )}
    </div>
  )
}

function InfoGroup({ label, extra, children }: { label: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className='space-y-1.5'>
      <div className='flex min-h-7 items-center gap-2'>
        <h4 className='text-2xs font-semibold text-ink3'>{label}</h4>
        {extra && <div className='ml-auto'>{extra}</div>}
      </div>
      {children}
    </section>
  )
}

function ShotEditor({ shot, state, polish }: { shot: Shot; state: LaunchParamsState; polish: { busy: boolean; trigger: () => void } }) {
  const [draft, setDraft] = useState({ image_prompt: shot.image_prompt, motion_prompt: shot.motion_prompt })
  const save = useSaveShot(shot.id)

  return (
    <div className='space-y-4'>
      <div className='space-y-2.5'>
        <TextField
          label={shot.clip_source === 'first_frame' ? '首帧提示词' : '取景提示词'}
          value={draft.image_prompt}
          onChange={(v) => setDraft({ ...draft, image_prompt: v })}
          rows={4}
          placeholder='未填写'
        />
        <ShotPreview shotId={shot.id} part='first_frame' state={state} />
      </div>
      <div className='space-y-2.5'>
        <TextField label='视频提示词' value={draft.motion_prompt} onChange={(v) => setDraft({ ...draft, motion_prompt: v })} rows={4} placeholder='未填写' />
        <ShotPreview shotId={shot.id} part='clip' state={state} />
      </div>
      <div className='flex items-center gap-2'>
        <Button size='sm' variant='outline' disabled={save.isPending} onClick={() => save.mutate(draft)}>
          保存
        </Button>
        <ConfirmDialog size='sm' variant='outline' question='覆盖这两段提示词并重新生成？' action='重写' disabled={polish.busy} onConfirm={polish.trigger}>
          <Sparkles className='h-3.5 w-3.5' />
          重写提示词
        </ConfirmDialog>
      </div>
    </div>
  )
}

function ShotSheet({ shot, projectId, open, onOpenChange }: { shot: Shot; projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) })
  const [cast, setCast] = useState(() => shot.cast.map((member) => member.asset_id))
  const [draft, setDraft] = useState({
    summary: shot.summary,
    scene: shot.scene,
    shot_size: shot.shot_size,
    camera: shot.camera,
    camera_move: shot.camera_move,
    mood: shot.mood,
    join_mode: shot.join_mode,
    clip_source: shot.clip_source,
    utterances: shot.utterances,
    seconds: shot.seconds,
  })
  const save = useSaveShot(shot.id)
  // 出镜未改动就不发送：后端会把引用重新指向最新锁定版，原样发回也可能换掉版本、把画面标为过时。
  const castChanged = cast.length !== shot.cast.length || shot.cast.some((member) => !cast.includes(member.asset_id))
  const castOptions = (project.data?.cast ?? []).filter((member) => member.state === 'locked' || cast.includes(member.id))
  const toggleCast = (id: string) => setCast(cast.includes(id) ? cast.filter((item) => item !== id) : [...cast, id])

  // TODO(Lysander): 只有单独配音限一镜一个说话人，这条提示还没按声音来源区分，视频自带声音时会误报。
  const speakers = new Set(draft.utterances.map((line) => line.speaker).filter((name) => name !== null))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className='flex items-center gap-2 border-b px-4 py-3'>
          <SheetTitle>第 {shot.idx + 1} 镜 · 设定</SheetTitle>
        </div>
        <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-4'>
          <TextField label='概要' value={draft.summary} onChange={(v) => setDraft({ ...draft, summary: v })} />
          <TextField label='场景' value={draft.scene} onChange={(v) => setDraft({ ...draft, scene: v })} />
          <div className='space-y-1.5'>
            <Label className='text-xs'>景别</Label>
            <Segmented value={draft.shot_size} options={SHOT_SIZES} onChange={(shot_size) => setDraft({ ...draft, shot_size })} render={(option) => SHOT_SIZE_LABEL[option]} />
          </div>
          <TextField label='机位' value={draft.camera} onChange={(v) => setDraft({ ...draft, camera: v })} />
          <div className='space-y-1.5'>
            <Label className='text-xs'>运镜</Label>
            <Segmented value={draft.camera_move} options={CAMERA_MOVES} onChange={(camera_move) => setDraft({ ...draft, camera_move })} render={(option) => CAMERA_MOVE_LABEL[option]} />
          </div>
          <TextField label='情绪' value={draft.mood} onChange={(v) => setDraft({ ...draft, mood: v })} />
          <div className='space-y-1.5'>
            <Label className='text-xs'>衔接</Label>
            <Segmented value={draft.join_mode} options={SHOT_JOINS} onChange={(join_mode) => setDraft({ ...draft, join_mode })} render={(option) => SHOT_JOIN_LABEL[option]} />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>画面来源</Label>
            <Segmented value={draft.clip_source} options={CLIP_SOURCES} onChange={(clip_source) => setDraft({ ...draft, clip_source })} render={(option) => CLIP_SOURCE_LABEL[option]} />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>出镜</Label>
            <div className='flex flex-wrap gap-1'>
              {castOptions.map((member) => (
                <ToggleChip key={member.id} size='xs' on={cast.includes(member.id)} onClick={() => toggleCast(member.id)}>
                  {member.name}
                </ToggleChip>
              ))}
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>时长（秒）</Label>
            <Input type='number' className='w-24' value={draft.seconds} onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })} />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>台词</Label>
            <UtteranceEditor utterances={draft.utterances} onChange={(utterances) => setDraft({ ...draft, utterances })} />
            {speakers.size > 1 && (
              <p className='text-xs text-fail'>
                每镜仅限一名说话人，当前 {speakers.size} 名（{[...speakers].join('、')}）
              </p>
            )}
          </div>
          <Button className='w-full' disabled={save.isPending} onClick={() => save.mutate(castChanged ? { ...draft, cast } : draft)}>
            保存设定
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function useInsertShot(episodeId: string) {
  const queryClient = useQueryClient()
  const navigate = route.useNavigate()
  return useMutation({
    mutationFn: (afterShotId: string | null) => api.insertShot(episodeId, afterShotId),
    onSuccess: async (view) => {
      await queryClient.invalidateQueries()
      const added = view.shots.find((shot) => shot.id === view.shot_id)
      if (added) void navigate({ search: (prev) => ({ ...prev, shot: added.idx + 1 }), resetScroll: false })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

function useDeleteShot() {
  const queryClient = useQueryClient()
  const navigate = route.useNavigate()
  return useMutation({
    mutationFn: (shot: Shot) => api.deleteShot(shot.id),
    onSuccess: async (view, shot) => {
      await queryClient.invalidateQueries()
      const next = Math.min(shot.idx + 1, view.shots.length)
      void navigate({ search: (prev) => ({ ...prev, shot: Math.max(next, 1) }), resetScroll: false })
      toast.success('已删除')
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

// 主面板与抽屉各自保存不同字段，所以只发 patch：整条发回会互相覆盖。
function useSaveShot(shotId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.patchShot>[1]) => api.patchShot(shotId, patch),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      toast.success(result.stale_kinds.length > 0 ? `已保存，${result.stale_kinds.length} 件产物标为过时` : '已保存')
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
