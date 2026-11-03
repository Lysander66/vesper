import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ASSET_FILE_ROLE_LABEL, CREATURE_LOOKS, LOOKS_BY_CATEGORY, LOOKS_BY_TIER, type AssetFileRole, type AssetView } from '@vesper/shared'
import { Upload, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, fileUrl } from '@/lib/api'
import { useLaunch } from '@/lib/run-center'
import { SLOT_LABEL } from '@/lib/status'
import { cn } from '@/lib/utils'
import { AssetPreview } from '@/components/asset-preview'
import { LaunchGroup, useLaunchParams } from '@/components/launch-params'
import { Lightbox, type LightboxImage } from '@/components/lightbox'
import { RunLog } from '@/components/run-log'
import { ZoomHint } from '@/components/version-strip'

/** 与后端 LOOK_ASPECT 对齐：场景是横的，道具是方的。 */
const LOOK_BOX: Readonly<Record<string, string>> = {
  object: 'aspect-square',
  establishing: 'aspect-video',
}

function slotsOf(asset: AssetView): readonly AssetFileRole[] {
  return asset.category === 'character' && asset.data.form === 'creature' ? CREATURE_LOOKS : LOOKS_BY_CATEGORY[asset.category]
}

export function galleryOf(asset: AssetView): LightboxImage[] {
  return slotsOf(asset).flatMap((role) => {
    const file = asset.files.find((item) => item.role === role)
    return file ? [{ path: file.path, label: `${asset.name} · ${ASSET_FILE_ROLE_LABEL[role]}` }] : []
  })
}

export function lookProgress(asset: AssetView) {
  const slots = slotsOf(asset)
  const target = asset.category === 'character' ? LOOKS_BY_TIER[asset.data.tier].filter((role) => slots.includes(role)) : slots
  const has = (role: AssetFileRole) => asset.files.some((item) => item.role === role)
  const first = slots[0] as AssetFileRole
  return { slots, target, hasFirst: has(first), rest: target.filter((role) => role !== first && !has(role)) }
}

export function Looks({ asset, locked }: { asset: AssetView; locked: boolean }) {
  const [viewing, setViewing] = useState<number | null>(null)
  const { slots, target, hasFirst, rest } = lookProgress(asset)

  const params = useLaunchParams({ projectId: asset.project_id ?? '', roles: ['image'], prompts: ['look'] })
  // 读 ref 而不是 state：setState 之后这一轮闭包里还是旧值。
  const only = useRef<readonly AssetFileRole[] | undefined>(undefined)
  const launch = useLaunch(() => api.looks(asset.id, only.current as string[] | undefined, params.extra))
  const start = (roles?: readonly AssetFileRole[]) => {
    only.current = roles
    launch.trigger()
  }

  const gallery = galleryOf(asset)
  const label = !hasFirst ? '生成设定图' : rest.length > 0 ? `补齐其余 ${rest.length} 张` : '已全部生成'

  return (
    <div className='space-y-2'>
      <SectionHead title='设定图'>
        <span className='text-2xs text-muted-foreground'>
          已有 {gallery.length} / {target.length}
        </span>
        <LaunchGroup
          state={params}
          onLaunch={() => start(hasFirst ? rest : undefined)}
          icon={Wand2}
          label={label}
          launchLabel='生成设定图'
          variant='default'
          busy={launch.busy}
          disabled={locked || (hasFirst && rest.length === 0)}
          lead={asset.project_id ? <AssetPreview assetId={asset.id} state={params} /> : undefined}
        />
      </SectionHead>
      <div className={cn('grid gap-2', slots.length > 1 ? 'grid-cols-3' : 'w-full')}>
        {slots.map((role) => {
          const file = asset.files.find((item) => item.role === role)
          return (
            <LookSlot
              key={role}
              assetId={asset.id}
              role={role}
              locked={locked}
              skipped={!target.includes(role)}
              busy={launch.busy}
              onGenerate={() => start([role])}
              box={slots.length > 1 ? 'w-full aspect-3/4' : cn('h-40', LOOK_BOX[role])}
              {...(file ? { file } : {})}
              onOpen={() => setViewing(gallery.findIndex((item) => item.path === file?.path))}
            />
          )
        })}
      </div>
      <Lightbox images={gallery} index={viewing} onIndexChange={setViewing} />
      {launch.runId && <RunLog runId={launch.runId} />}
    </div>
  )
}

function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className='flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1'>
      <h4 className='text-sm font-semibold'>{title}</h4>
      {children && <div className='ml-auto flex items-center gap-2'>{children}</div>}
    </div>
  )
}

function LookSlot({
  assetId,
  role,
  file,
  locked,
  skipped,
  busy,
  box,
  onOpen,
  onGenerate,
}: {
  assetId: string
  role: AssetFileRole
  file?: AssetView['files'][number]
  locked: boolean
  skipped: boolean
  busy: boolean
  box: string
  onOpen: () => void
  onGenerate: () => void
}) {
  const queryClient = useQueryClient()
  const [over, setOver] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const label = ASSET_FILE_ROLE_LABEL[role]

  const upload = useMutation({
    mutationFn: (item: File) => api.uploadAssetFile(assetId, role, item),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success(`${label}已上传`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const addFiles = (list: FileList | null) => {
    const picked = list?.[0]
    if (picked) upload.mutate(picked)
  }

  return (
    <div className={cn('group/slot relative', skipped && !file && 'opacity-60')}>
      {file ? (
        <button type='button' className={cn('group relative block overflow-hidden rounded-lg border bg-line2/40', box)} title='查看大图' onClick={onOpen}>
          <img src={fileUrl(file.path)} alt={label} className='h-full w-full object-contain' />
          <ZoomHint />
          <span className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-5 pb-1.5 text-left text-2xs text-white'>{label}</span>
        </button>
      ) : (
        <button
          type='button'
          disabled={locked || upload.isPending}
          className={cn(
            'flex items-center justify-center rounded-lg border border-dashed text-2xs text-idle transition-colors',
            !locked && 'hover:border-ink3 hover:text-foreground',
            over && 'border-brand bg-line2/50 text-foreground',
            box
          )}
          title={skipped ? '配角不补齐此图，可单独生成' : locked ? undefined : '点击或拖入图片'}
          onClick={() => picker.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setOver(false)
            addFiles(event.dataTransfer.files)
          }}
        >
          {upload.isPending ? <span>上传中…</span> : skipped || locked ? <span>{SLOT_LABEL[skipped ? 'skipped' : 'missing']}</span> : <Upload className='h-4 w-4' />}
          <span className='absolute inset-x-0 bottom-0 px-2 pb-1.5 text-left text-2xs text-muted-foreground'>{label}</span>
        </button>
      )}
      {!locked && (
        <button
          type='button'
          disabled={busy || upload.isPending}
          className='absolute top-1 right-1 rounded-md bg-black/45 p-1 text-white opacity-0 transition-opacity group-hover/slot:opacity-100 hover:bg-black/75 focus-visible:opacity-100 disabled:opacity-0'
          title={file ? `重新生成${label}` : `单独生成${label}`}
          aria-label={file ? `重新生成${label}` : `单独生成${label}`}
          onClick={onGenerate}
        >
          <Wand2 className='h-3.5 w-3.5' />
        </button>
      )}
      <input
        ref={picker}
        type='file'
        accept='image/*'
        hidden
        onChange={(event) => {
          addFiles(event.target.files)
          // 同一个文件选第二次时 change 不会触发，除非先清空值。
          event.target.value = ''
        }}
      />
    </div>
  )
}
