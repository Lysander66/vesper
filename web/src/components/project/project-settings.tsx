import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ASPECT_LABEL,
  ASPECTS,
  AUDIO_MODE_LABEL,
  AUDIO_MODES,
  CONTINUITY_MODE_LABEL,
  CONTINUITY_MODES,
  STYLE_GROUPS,
  stylePresetOf,
  type Aspect,
  type AudioMode,
  type ContinuityMode,
  type ProjectView,
  type Volume,
} from '@vesper/shared'
import { Palette, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { usePopover } from '@/lib/popover'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { StatusChip } from '@/components/ui/status-chip'

export function VolumeBar({ volume }: { volume: Volume }) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <StatusChip tone='idle'>时长预估</StatusChip>
      <span className='text-sm'>{volume.message}</span>
      <span className='font-mono text-2xs text-ink3'>字数不计空白</span>
    </div>
  )
}

const FIELD = 'space-y-1.5'

export function ProjectSettings({ view }: { view: ProjectView }) {
  const { project } = view
  const queryClient = useQueryClient()
  const [target, setTarget] = useState(project.target_seconds)
  const [shotMin, setShotMin] = useState(project.shot_min_seconds)
  const [shotMax, setShotMax] = useState(project.shot_max_seconds)
  const [style, setStyle] = useState(project.style)
  const [aspect, setAspect] = useState<Aspect>(project.aspect)
  const [audio, setAudio] = useState<AudioMode>(project.audio_mode)
  const [continuity, setContinuity] = useState<ContinuityMode>(project.continuity_mode)

  const patch = useMutation({
    mutationFn: () =>
      api.patchProject(project.id, {
        target_seconds: target,
        shot_min_seconds: shotMin,
        shot_max_seconds: shotMax,
        style,
        aspect,
        audio_mode: audio,
        continuity_mode: continuity,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success('已更新')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className='rounded-md bg-line2/60 p-2.5'>
      <div className='flex flex-wrap items-end gap-x-5 gap-y-3'>
        <div className={FIELD}>
          <Label className='text-xs'>
            单集目标时长（秒）<span className='text-muted-foreground'> · 0 为不限</span>
          </Label>
          <Input type='number' min={0} className='w-24 bg-card' value={target} onChange={(event) => setTarget(Math.max(0, Number(event.target.value)))} />
        </div>
        <div className={FIELD}>
          <Label className='text-xs'>画幅</Label>
          {/* 一个开关同时管图像与视频：分开配置时出现过方图首帧喂给竖屏视频模型。 */}
          <Segmented
            value={aspect}
            options={ASPECTS}
            onChange={setAspect}
            render={(option) => (
              <>
                {ASPECT_LABEL[option]}
                <span className='ml-1 font-mono text-2xs opacity-60'>{option}</span>
              </>
            )}
          />
        </div>
        <div className={FIELD}>
          <Label className='text-xs'>单镜时长（秒）</Label>
          <div className='flex items-center gap-1.5'>
            <Input type='number' min={1} step={1} className='w-16 bg-card' value={shotMin} onChange={(event) => setShotMin(Math.max(1, Number(event.target.value)))} />
            <span className='text-ink3'>–</span>
            <Input type='number' min={1} step={1} className='w-16 bg-card' value={shotMax} onChange={(event) => setShotMax(Math.max(1, Number(event.target.value)))} />
          </div>
        </div>
        <div className={FIELD}>
          <Label className='text-xs'>音轨</Label>
          <Segmented value={audio} options={AUDIO_MODES} onChange={setAudio} render={(option) => AUDIO_MODE_LABEL[option]} />
        </div>
        <div className={FIELD}>
          <Label className='text-xs'>
            末帧参考<span className='text-muted-foreground'> · 以上一镜末帧作为本镜参考图</span>
          </Label>
          <Segmented value={continuity} options={CONTINUITY_MODES} onChange={setContinuity} render={(option) => CONTINUITY_MODE_LABEL[option]} />
        </div>
        <div className={cn(FIELD, 'min-w-64 flex-1')}>
          <div className='flex items-center gap-2'>
            <Label className='text-xs'>画风</Label>
            <StylePicker projectId={project.id} onPick={setStyle} />
          </div>
          <Input className='bg-card' value={style} placeholder='胶片质感的写实影像，低饱和冷调' onChange={(event) => setStyle(event.target.value)} />
        </div>
        <Button variant='outline' size='sm' disabled={patch.isPending || shotMin > shotMax} onClick={() => patch.mutate()}>
          保存
        </Button>
        {shotMin > shotMax && <span className='pb-2 text-2xs text-fail'>单镜时长下限不能大于上限</span>}
      </div>
    </div>
  )
}

function StylePicker({ projectId, onPick }: { projectId: string; onPick: (prompt: string) => void }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>()
  const suggest = useMutation({
    mutationFn: () => api.suggestStyle(projectId),
    onError: (error: Error) => toast.error(error.message),
  })

  const picks = (suggest.data?.picks ?? []).flatMap((pick) => {
    const preset = stylePresetOf(pick.label)
    return preset === undefined ? [] : [{ ...preset, reason: pick.reason }]
  })
  const recommended = new Set(picks.map((pick) => pick.label))

  const apply = (prompt: string) => {
    onPick(prompt)
    setOpen(false)
  }

  const trigger = 'flex items-center gap-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'

  return (
    <div className='relative flex items-center gap-2' ref={ref}>
      <button type='button' className={trigger} onClick={() => setOpen(!open)}>
        <Palette className='h-3.5 w-3.5' />
        预设
      </button>
      <button
        type='button'
        className={trigger}
        disabled={suggest.isPending}
        onClick={() => {
          setOpen(true)
          suggest.mutate()
        }}
      >
        <Sparkles className='h-3.5 w-3.5' />
        {suggest.isPending ? '推荐中…' : '推荐'}
      </button>
      {open && (
        <div className='absolute top-[calc(100%+6px)] left-0 z-20 grid w-[42rem] max-w-[calc(100vw-2rem)] grid-cols-3 gap-x-4 gap-y-3 rounded-xl border bg-popover p-3 shadow-lg'>
          {picks.length > 0 && (
            <div className='col-span-3 flex flex-wrap items-center gap-2 border-b pb-3'>
              {picks.map((pick) => (
                <button
                  key={pick.label}
                  type='button'
                  title={pick.prompt}
                  className='flex min-w-0 items-baseline gap-1.5 rounded-md border border-brand px-2 py-1.5 text-xs transition-colors hover:bg-line2'
                  onClick={() => apply(pick.prompt)}
                >
                  {pick.label}
                  <span className='max-w-48 truncate text-2xs text-ink3'>{pick.reason}</span>
                </button>
              ))}
            </div>
          )}
          {STYLE_GROUPS.map((group) => (
            <div key={group.group} className='space-y-1.5'>
              <p className='text-2xs font-semibold text-ink3'>{group.group}</p>
              <div className='flex flex-wrap gap-1.5'>
                {group.presets.map((preset) => (
                  <button
                    key={preset.label}
                    type='button'
                    title={`适合${preset.fits}\n\n${preset.prompt}`}
                    className={cn('rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-line2', recommended.has(preset.label) && 'border-brand')}
                    onClick={() => apply(preset.prompt)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
