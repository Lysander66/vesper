import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ARTIFACT_KIND_LABEL, type Artifact, type ArtifactKind, type ArtifactOwner, type SlotStatus } from '@vesper/shared'
import { AlertTriangle, Ban, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, fileUrl } from '@/lib/api'
import { SLOT_LABEL, SLOT_TONE, TONE_TEXT } from '@/lib/status'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Lightbox } from '@/components/lightbox'
import { VersionButton } from '@/components/version-button'
import { ThumbButton, VersionStrip } from '@/components/version-strip'

const mediaOf = (kind: ArtifactKind): 'video' | 'image' => (kind === 'clip' || kind === 'film' ? 'video' : 'image')

const SLOT_ICON: Partial<Record<SlotStatus, typeof CircleDashed>> = {
  missing: CircleDashed,
  running: Loader2,
  failed: XCircle,
  skipped: Ban,
}

export function ArtifactSlot({
  kind,
  owner,
  status,
  artifact,
  className,
  onGenerate,
  busy = false,
  blockedReason,
}: {
  kind: ArtifactKind
  owner: ArtifactOwner
  status: SlotStatus
  artifact: Artifact | undefined
  className?: string
  onGenerate?: (() => void) | undefined
  busy?: boolean
  blockedReason?: string | undefined
}) {
  const stale = status === 'stale' || artifact?.state === 'stale'
  const Icon = SLOT_ICON[status]
  const canLaunch = onGenerate !== undefined && status !== 'skipped'

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      {kind === 'voice' && artifact?.path && <audio src={fileUrl(artifact.path)} controls className='h-7 w-44' />}
      {stale && (
        <span className='flex shrink-0 items-center gap-1 text-2xs text-stale'>
          <AlertTriangle className='h-3.5 w-3.5' />
          过时
        </span>
      )}
      {!artifact?.path && (
        <span className={cn('flex shrink-0 items-center gap-1 text-2xs', TONE_TEXT[SLOT_TONE[status]])}>
          {Icon && <Icon className={cn('h-3.5 w-3.5', status === 'running' && 'animate-spin')} />}
          {SLOT_LABEL[status]}
        </span>
      )}
      {artifact && <ArtifactVersions owner={owner} kind={kind} version={artifact.version} />}
      {canLaunch && (
        // 禁用的按钮收不到鼠标事件，title 挂在外层才提示得出来。
        <span title={blockedReason} className='shrink-0'>
          <Button variant='outline' size='sm' className='h-7 px-2 text-xs' disabled={busy || status === 'running' || blockedReason !== undefined} onClick={onGenerate}>
            {artifact ? '重新生成' : '生成'}
          </Button>
        </span>
      )}
    </div>
  )
}

export function ArtifactVersions({ owner, kind, version, className }: { owner: ArtifactOwner; kind: ArtifactKind; version: number; className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <VersionButton current={version} className={className} onClick={() => setOpen(true)} />
      <HistoryDialog owner={owner} kind={kind} open={open} onOpenChange={setOpen} />
    </>
  )
}

function HistoryDialog({ owner, kind, open, onOpenChange }: { owner: ArtifactOwner; kind: ArtifactKind; open: boolean; onOpenChange: (open: boolean) => void }) {
  const history = useQuery({
    queryKey: ['artifact-history', owner, kind],
    queryFn: () => api.artifactHistory(owner, kind),
    enabled: open,
  })
  const queryClient = useQueryClient()
  const restore = useMutation({
    mutationFn: (version: number) => api.restoreArtifact(owner, kind, version),
    onSuccess: async (artifact) => {
      toast.success(`已恢复，当前 v${artifact.version}`)
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='right-0 left-0 mx-auto w-fit max-w-[min(80rem,calc(100%-2rem))] translate-x-0'>
        <DialogTitle>{ARTIFACT_KIND_LABEL[kind]} · 历史版本</DialogTitle>
        {history.data === undefined ? (
          <LoadingState lines={2} />
        ) : (
          <VersionStrip
            items={history.data.map((row) => ({ ...row, key: row.id }))}
            media={kind === 'voice' ? 'audio' : mediaOf(kind)}
            label={ARTIFACT_KIND_LABEL[kind]}
            owner={owner}
            purpose={kind}
            restoring={restore.isPending}
            onRestore={(item) => restore.mutate(item.version)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ArtifactThumb({ kind, path }: { kind: ArtifactKind; path: string }) {
  const [viewing, setViewing] = useState<number | null>(null)

  return (
    <>
      <ThumbButton media={mediaOf(kind)} label={ARTIFACT_KIND_LABEL[kind]} path={path} fill className='h-full w-full object-contain' onOpen={() => setViewing(0)} />
      <Lightbox images={[{ path, label: ARTIFACT_KIND_LABEL[kind], media: mediaOf(kind) }]} index={viewing} onIndexChange={setViewing} />
    </>
  )
}
