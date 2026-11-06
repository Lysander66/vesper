import { useState } from 'react'
import { ARTIFACT_KIND_LABEL, SHOT_ARTIFACT_KINDS, type EpisodeView } from '@vesper/shared'
import { Film, Play } from 'lucide-react'
import { api } from '@/lib/api'
import { useLaunch } from '@/lib/run-center'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { LaunchParamsFields, useLaunchParams, type LaunchParamsState } from '@/components/launch-params'
import { RecordsLink } from '@/components/records'

export function EpisodeActions({ view }: { view: EpisodeView }) {
  const params = useLaunchParams({
    projectId: view.episode.project_id,
    roles: ['image', 'video', 'tts'],
    prompts: ['first_frame', 'clip'],
    audioMode: view.audio_mode,
    continuityMode: view.continuity_mode,
  })
  const produce = useLaunch(() => api.produceEpisode(view.episode.id, undefined, params.extra))
  const [force, setForce] = useState(false)
  const assemble = useLaunch(() => api.assemble(view.episode.id, force))

  const blocked = view.progress?.assemblable === 'blocked'
  const needsConfirm = view.progress?.assemblable === 'needs_confirm'
  const canAssemble = !blocked && !(needsConfirm && !force)

  return (
    <div className='ml-auto flex shrink-0 items-center gap-2'>
      {needsConfirm && (
        <label className='flex cursor-pointer items-center gap-1.5 text-xs text-stale'>
          <Checkbox checked={force} onCheckedChange={(checked) => setForce(checked === true)} />
          包含过时产物
        </label>
      )}
      <Button size='sm' variant={canAssemble ? 'default' : 'outline'} disabled={!canAssemble || assemble.busy} onClick={assemble.trigger}>
        <Film className='h-3.5 w-3.5' />
        合成
      </Button>
      <ProduceEpisodeButton view={view} params={params} primary={!canAssemble} onConfirm={produce.trigger} busy={produce.busy} />
      <RecordsLink owner={{ kind: 'episode', id: view.episode.id }} />
    </div>
  )
}

function ProduceEpisodeButton({ view, params, primary, onConfirm, busy }: { view: EpisodeView; params: LaunchParamsState; primary: boolean; onConfirm: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const shots = view.shots.length
  const voices = params.audio === 'native' ? 0 : view.shots.filter((shot) => shot.utterances.length > 0).length
  const frames = view.shots.filter((shot) => shot.clip_source === 'first_frame').length
  const counts = { first_frame: frames, clip: shots, voice: voices }
  const done = view.shots.filter((shot) => shot.artifacts.length > 0).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size='sm' variant={primary ? 'default' : 'outline'} disabled={shots === 0 || busy}>
          <Play className='h-3.5 w-3.5' />
          整集生成
        </Button>
      </DialogTrigger>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>整集生成</DialogTitle>
          <DialogDescription>共 {shots} 镜</DialogDescription>
        </DialogHeader>
        <dl className='space-y-1.5 rounded-md bg-line2/60 p-3 text-sm'>
          {SHOT_ARTIFACT_KINDS.map((kind) => (
            <div key={kind} className='flex justify-between'>
              <dt className='text-muted-foreground'>{ARTIFACT_KIND_LABEL[kind]}</dt>
              <dd className='font-mono'>{counts[kind as keyof typeof counts]} 次</dd>
            </div>
          ))}
          <div className='flex justify-between border-t pt-1.5 font-medium'>
            <dt>合计</dt>
            <dd className='font-mono'>{frames + shots + voices} 次调用</dd>
          </div>
        </dl>
        <div className='rounded-md border p-3'>
          <p className='mb-2 text-2xs font-semibold text-ink3'>本次参数</p>
          <LaunchParamsFields state={params} />
        </div>
        {done > 0 && (
          <p className='text-sm text-stale'>
            其中 {done} 镜已有产物，这一轮<strong>全部重做</strong>
          </p>
        )}
        <DialogFooter>
          <Button variant='outline' size='sm' onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            size='sm'
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            确认生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
