import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ASSET_CATEGORY_LABEL,
  ASSET_FILE_ROLES,
  ASSET_FILE_ROLE_LABEL,
  type AssetCategory,
  type AssetFileRole,
  type AssetSummary,
  type AssetView,
  type AssetData,
  type CharacterData,
  type PropData,
  type SceneData,
} from '@vesper/shared'
import {
  Check,
  Library,
  Lock,
  LockOpen,
  History as HistoryIcon,
  Maximize2,
  MoreHorizontal,
  Mountain,
  Package,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Shirt,
  Trash2,
  Users,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, fileUrl } from '@/lib/api'
import { FLASH_RING, useFlash } from '@/lib/flash'
import { usePopover } from '@/lib/popover'
import { useLaunch } from '@/lib/run-center'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton, ConfirmPrompt } from '@/components/ui/confirm'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusChip } from '@/components/ui/status-chip'
import { Textarea } from '@/components/ui/textarea'
import { AssetPreview } from '@/components/asset-preview'
import { AssetSheet, TIER_LABEL } from '@/components/asset/asset-sheet'
import { galleryOf, lookProgress } from '@/components/asset/looks'
import { Lightbox } from '@/components/lightbox'
import { SortButton } from '@/components/sort-button'
import { VersionStrip } from '@/components/version-strip'

export const CATEGORY_ICON: Readonly<Record<AssetCategory, LucideIcon>> = {
  character: Users,
  scene: Mountain,
  prop: Package,
}

const PREVIEW_ROLES: Readonly<Record<AssetCategory, readonly AssetFileRole[]>> = {
  character: ['portrait', 'full_body'],
  scene: ['establishing'],
  prop: ['object'],
}

export function blurbOf(category: AssetCategory, data: AssetData, costume: boolean): string {
  if (category === 'character') return costume ? (data as CharacterData).outfit : (data as CharacterData).identity
  if (category === 'prop') return [(data as PropData).holder, (data as PropData).description].filter(Boolean).join(' · ')
  return (data as SceneData).description
}

function previewOf(category: AssetCategory, files: AssetView['files'] | undefined) {
  return PREVIEW_ROLES[category].map((role) => files?.find((item) => item.role === role)).find(Boolean)
}

type CardProps = { flash?: boolean; expanded?: boolean; onToggle: () => void } & (
  { category: 'character'; asset: AssetSummary<CharacterData> } | { category: 'scene'; asset: AssetSummary<SceneData> } | { category: 'prop'; asset: AssetSummary<PropData> }
)

export function AssetCard(props: CardProps) {
  const { category, asset, flash = false, expanded = false, onToggle } = props
  const flashRef = useFlash<HTMLDivElement>(flash)
  const locked = asset.state === 'locked'
  // 列表接口不含路径与版本，需单独获取；与展开面板共用 key，展开时直接读缓存。
  const detail = useQuery({ queryKey: ['asset', asset.id], queryFn: () => api.asset(asset.id) })
  const toggleLock = useToggleLock(asset.id, locked)
  const applyToShots = useApplyToShots(asset.id)
  const remove = useRemoveAsset(asset.id)
  const save = useSaveToLibrary(asset.id)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [asking, setAsking] = useState<'follow' | 'remove' | 'versions' | 'library' | 'costume' | null>(null)
  const costume = asset.base_id !== null

  const saveToLibrary = async () => {
    const items = await queryClient.fetchQuery({ queryKey: ['library'], queryFn: api.library })
    if (items.some((item) => item.category === category && item.name === asset.name)) setAsking('library')
    else save.mutate('no')
  }

  const gallery = detail.data ? galleryOf(detail.data) : []
  const preview = previewOf(category, detail.data?.files)
  const LockIcon = locked ? LockOpen : Lock

  const progress = detail.data ? lookProgress(detail.data) : null
  const looks = useLaunch(() => api.looks(asset.id, progress?.hasFirst ? [...progress.rest] : undefined))

  const blurb = blurbOf(category, asset.data, costume)

  return (
    // 卡头里有自己的按钮，所以整卡不能是一个 button。
    <div ref={flashRef} className={cn('group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-ink3/50', expanded && 'border-brand', flash && FLASH_RING)}>
      <div className='relative flex items-center py-1.5 pr-2 pl-2.5'>
        <button type='button' className='flex min-w-0 flex-1 items-center gap-1.5 text-left' onClick={onToggle}>
          <span className='truncate text-sm font-semibold'>{asset.name}</span>
          {props.category === 'character' && props.asset.data.tier === 'lead' && !costume && (
            <Badge variant='muted' className='px-1.5 text-2xs'>
              {TIER_LABEL.lead}
            </Badge>
          )}
          {costume && (
            <Badge variant='muted' className='px-1.5 text-2xs'>
              换装
            </Badge>
          )}
          {asset.base_newer === 'yes' && <StatusChip tone='warn'>原角色已更新，需重新锁定</StatusChip>}
        </button>
        <div
          className={cn(
            'absolute inset-y-0 right-2 flex items-center gap-1.5 bg-card pl-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            looks.busy && 'opacity-100'
          )}
        >
          <Button
            variant='ghost'
            size='icon-sm'
            title='生成设定图'
            aria-label='生成设定图'
            className='text-muted-foreground'
            disabled={locked || looks.busy || progress === null || (progress.hasFirst && progress.rest.length === 0)}
            onClick={() => looks.trigger()}
          >
            <Wand2 className='h-3.5 w-3.5' />
          </Button>
          <Button variant='ghost' size='icon-sm' title='编辑' aria-label='编辑' className='text-muted-foreground' disabled={detail.data === undefined} onClick={() => setEditing(true)}>
            <PencilLine className='h-3.5 w-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            title={locked ? '解锁' : '锁定'}
            aria-label={locked ? '解锁' : '锁定'}
            className='text-muted-foreground'
            disabled={toggleLock.isPending}
            onClick={() => toggleLock.mutate()}
          >
            <LockIcon className='h-3.5 w-3.5' />
          </Button>
          <MoreMenu
            items={[
              ...(locked
                ? [
                    {
                      label: '更新到分镜',
                      icon: RefreshCw,
                      disabled: applyToShots.isPending,
                      onSelect: () => setAsking('follow'),
                    },
                  ]
                : []),
              ...(category === 'character' && !costume ? [{ label: '添加换装', icon: Shirt, onSelect: () => setAsking('costume') }] : []),
              {
                label: '历史版本',
                icon: HistoryIcon,
                disabled: detail.data === undefined,
                onSelect: () => setAsking('versions'),
              },
              ...(costume
                ? []
                : [
                    {
                      label: '存入素材库',
                      icon: Library,
                      disabled: asset.files === 0 || save.isPending,
                      onSelect: () => saveToLibrary().catch((error: Error) => toast.error(error.message)),
                    },
                  ]),
              {
                label: locked ? '解锁后可删除' : '删除',
                icon: Trash2,
                danger: true,
                disabled: locked || remove.isPending,
                onSelect: () => setAsking('remove'),
              },
            ]}
          />
        </div>
      </div>
      <ConfirmPrompt
        open={asking === 'follow'}
        onOpenChange={(open) => setAsking(open ? 'follow' : null)}
        question='将仍在用旧版本的镜头更新为当前版本，受影响的首帧与视频标为过时？'
        action='更新'
        onConfirm={() => applyToShots.mutate()}
      />
      <ConfirmPrompt
        open={asking === 'library'}
        onOpenChange={(open) => setAsking(open ? 'library' : null)}
        question={`素材库中已有「${asset.name}」，是否覆盖？`}
        action='覆盖'
        onConfirm={() => save.mutate('yes')}
      />
      <ConfirmPrompt
        open={asking === 'remove'}
        onOpenChange={(open) => setAsking(open ? 'remove' : null)}
        question={asset.files > 0 ? `删除该资产及其 ${asset.files} 张设定图？` : `删除「${asset.name}」？`}
        onConfirm={() => remove.mutate()}
      />
      <CostumeDialog baseId={asset.id} baseName={asset.name} open={asking === 'costume'} onOpenChange={(open) => setAsking(open ? 'costume' : null)} />
      {detail.data && <VersionsDialog asset={detail.data} open={asking === 'versions'} onOpenChange={(open) => setAsking(open ? 'versions' : null)} />}
      <div className='relative'>
        <button type='button' aria-label='展开' className='block w-full' onClick={onToggle}>
          <AssetCover category={category} files={detail.data?.files} />
        </button>
        {preview && (
          <Button
            variant='secondary'
            size='icon-sm'
            title='查看设定图'
            aria-label='查看设定图'
            className='absolute top-1.5 right-1.5 opacity-0 shadow-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
            onClick={() => setViewing(gallery.findIndex((item) => item.path === preview.path))}
          >
            <Maximize2 className='h-3.5 w-3.5' />
          </Button>
        )}
      </div>
      <button type='button' className='w-full flex-1 space-y-1 p-2.5 text-left' onClick={onToggle}>
        <p className='line-clamp-2 min-h-8 text-2xs text-muted-foreground'>{blurb || '暂无设定'}</p>
        <div className='flex items-center gap-1.5'>
          <span className='font-mono text-2xs text-ink3'>
            出现 {asset.data.appearances} 次 · 设定图 {asset.files} 张
          </span>
          {locked && <Check aria-label='已锁定' className='ml-auto h-3.5 w-3.5 text-ok' />}
        </div>
      </button>
      <Lightbox images={gallery} index={viewing} onIndexChange={setViewing} />
      {detail.data && <AssetSheet asset={detail.data} locked={locked} open={editing} onOpenChange={setEditing} />}
    </div>
  )
}

function useToggleLock(assetId: string, locked: boolean) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => (locked ? api.unlock(assetId) : api.lock(assetId)),
    onSuccess: async () => {
      toast.success(locked ? '已解锁' : '已锁定')
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

function useApplyToShots(assetId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.applyToShots(assetId),
    onSuccess: async ({ shots }) => {
      toast.success(shots > 0 ? `已更新 ${shots} 镜` : '分镜已是当前版本')
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

function useRemoveAsset(assetId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteAsset(assetId),
    onSuccess: async () => {
      toast.success('已删除')
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

function useSaveToLibrary(assetId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (replace: 'yes' | 'no') => api.saveToLibrary(assetId, replace),
    onSuccess: async () => {
      toast.success('已存入素材库')
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

function CostumeDialog({ baseId, baseName, open, onOpenChange }: { baseId: string; baseName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [outfit, setOutfit] = useState('')
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: () => api.createCostume(baseId, name.trim(), outfit.trim()),
    onSuccess: async (asset) => {
      toast.success(`已添加${asset.name}`)
      await queryClient.invalidateQueries()
      onOpenChange(false)
      setName('')
      setOutfit('')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogTitle>{baseName} · 添加换装</DialogTitle>
        <div className='space-y-2'>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder='换装名，如官服' />
          <Textarea value={outfit} onChange={(event) => setOutfit(event.target.value)} rows={3} placeholder='这一身的款式与颜色，只写穿戴在身上的' />
          <p className='text-2xs text-muted-foreground'>
            脸、发型与声音沿用{baseName}。全身图以{baseName}的全身图为参考生成。
          </p>
          <Button className='w-full' disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            添加
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function NewAssetButton({ projectId, category, onCreated }: { projectId: string; category: AssetCategory; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const label = ASSET_CATEGORY_LABEL[category]

  const create = useMutation({
    mutationFn: () => api.createAsset(projectId, name.trim(), category),
    onSuccess: async (asset) => {
      await queryClient.invalidateQueries()
      setOpen(false)
      setName('')
      onCreated(asset.id)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const submit = () => {
    if (name.trim() && !create.isPending) create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size='sm' variant='outline'>
          <Plus className='h-3.5 w-3.5' />
          添加
        </Button>
      </DialogTrigger>
      <DialogContent className='max-w-sm'>
        <DialogTitle>添加{label}</DialogTitle>
        <div className='flex items-center gap-2'>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} placeholder={`${label}名`} />
          <Button disabled={!name.trim() || create.isPending} onClick={submit}>
            添加
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SortAssetsButton({ projectId, category, items }: { projectId: string; category: AssetCategory; items: readonly { id: string; name: string }[] }) {
  const queryClient = useQueryClient()
  const reset = useMutation({
    mutationFn: () => api.reorderAssets(projectId, category, []),
    onError: (error: Error) => toast.error(error.message),
  })
  return (
    <SortButton
      title={`${ASSET_CATEGORY_LABEL[category]}排序`}
      items={items}
      onSave={(ids) => api.reorderAssets(projectId, category, ids)}
      footer={(close) => (
        <ConfirmButton
          tone='brand'
          tooltip='恢复默认顺序'
          question='恢复默认顺序？'
          disabled={reset.isPending}
          onConfirm={() =>
            reset.mutate(undefined, {
              onSuccess: async () => {
                await queryClient.invalidateQueries()
                close()
              },
            })
          }
        >
          <RotateCcw className='h-3.5 w-3.5' />
        </ConfirmButton>
      )}
    />
  )
}

function MoreMenu({ items }: { items: { label: string; icon: LucideIcon; danger?: boolean; disabled?: boolean; onSelect: () => void }[] }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>()

  return (
    <div className='relative' ref={ref}>
      <Button variant='ghost' size='icon-sm' title='更多' aria-label='更多' className={cn('text-muted-foreground', open && 'bg-line2')} onClick={() => setOpen(!open)}>
        <MoreHorizontal className='h-3.5 w-3.5' />
      </Button>
      {open && (
        <div className='absolute top-[calc(100%+4px)] right-0 z-20 w-32 rounded-lg border bg-popover p-1 shadow-md'>
          {items.map((item) => (
            <button
              key={item.label}
              type='button'
              disabled={item.disabled}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-line2 disabled:pointer-events-none disabled:opacity-50',
                item.danger && 'hover:bg-fail-bg hover:text-fail'
              )}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              <item.icon className='h-3.5 w-3.5 text-muted-foreground' />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function VersionsDialog({ asset, open, onOpenChange }: { asset: AssetView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const restore = useMutation({
    mutationFn: (fileId: number) => api.restoreAssetFile(asset.id, fileId),
    onSuccess: async () => {
      toast.success('已恢复')
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const roles = ASSET_FILE_ROLES.filter((role) => asset.files.some((file) => file.role === role))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='right-0 left-0 mx-auto max-h-[90vh] w-fit max-w-[min(80rem,calc(100%-2rem))] translate-x-0 overflow-y-auto'>
        <DialogTitle>{asset.name} · 历史版本</DialogTitle>
        {roles.length === 0 && <EmptyState>暂无设定图</EmptyState>}
        {roles.map((role) => {
          const rows = asset.files.filter((file) => file.role === role)
          const locked = rows.find((file) => asset.locked_paths.includes(file.path))
          return (
            <section key={role} className='min-w-0 space-y-1.5'>
              <h4 className='text-xs font-medium text-muted-foreground'>{ASSET_FILE_ROLE_LABEL[role]}</h4>
              <VersionStrip
                compact
                items={rows.map((file, index) => ({
                  ...file,
                  key: file.id,
                  version: rows.length - index,
                  badge: file === locked ? <StatusChip tone='ok'>已锁定</StatusChip> : undefined,
                }))}
                media={role === 'voice_sample' ? 'audio' : 'image'}
                label={ASSET_FILE_ROLE_LABEL[role]}
                owner={{ kind: 'asset', id: asset.id }}
                purpose={role === 'voice_sample' ? role : `look_${role}`}
                restoring={restore.isPending}
                onRestore={(item) => restore.mutate(item.key as number)}
              />
            </section>
          )
        })}
      </DialogContent>
    </Dialog>
  )
}

export function AssetPanel({ assetId, name, onClose }: { assetId: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const asset = useQuery({ queryKey: ['asset', assetId], queryFn: () => api.asset(assetId) })

  useEffect(() => {
    // 加载中的面板只有一行高，等内容加载完再滚动。
    if (asset.data === undefined) return
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [asset.data])

  return (
    <div ref={ref} className='col-span-full overflow-hidden rounded-lg border bg-card'>
      {asset.data ? (
        <AssetEditor asset={asset.data} onClose={onClose} />
      ) : (
        <div className='flex items-center gap-2 px-4 py-2.5'>
          <h3 className='text-sm font-semibold'>{name}</h3>
          <Skeleton className='h-4 w-24' />
          <span className='ml-auto'>
            <CloseButton onClose={onClose} />
          </span>
        </div>
      )}
    </div>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant='ghost' size='sm' title='收起' aria-label='收起' onClick={onClose}>
      <X className='h-3.5 w-3.5' />
    </Button>
  )
}

export function AssetCover({ category, files, className }: { category: AssetCategory; files: AssetView['files'] | undefined; className?: string }) {
  const file = previewOf(category, files)

  return (
    <div className={cn('relative aspect-3/2 w-full bg-line2', className)}>
      {file && <img src={fileUrl(file.path)} alt='' className={cn('absolute inset-0 h-full w-full object-cover', category === 'character' && 'object-top')} />}
      {files !== undefined && !file && <span className='absolute inset-0 flex items-center justify-center text-2xs text-idle'>暂无设定图</span>}
    </div>
  )
}

function AssetEditor({ asset, onClose }: { asset: AssetView; onClose: () => void }) {
  const locked = asset.state === 'locked'

  return (
    <div>
      <div className='flex items-center gap-2 border-b px-4 py-2.5'>
        <h3 className='text-sm font-semibold'>{asset.name}</h3>
        <StatusChip tone={locked ? 'ok' : 'idle'}>{locked ? '已锁定' : '未锁定'}</StatusChip>
        <span className='ml-auto'>
          <CloseButton onClose={onClose} />
        </span>
      </div>

      <div className='min-w-0 p-4'>{asset.project_id && <AssetPreview assetId={asset.id} />}</div>
    </div>
  )
}
