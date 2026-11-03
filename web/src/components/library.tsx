import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ASSET_CATEGORY_LABEL, type AssetCategory, type LibraryItem } from '@vesper/shared'
import { Library, Maximize2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, fileUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EmptyState, LoadingState } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { ConfirmPrompt } from '@/components/ui/confirm'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AssetCover, blurbOf } from '@/components/asset-card'
import { galleryOf } from '@/components/asset/looks'
import { Lightbox } from '@/components/lightbox'

export function LibraryTile({ item, selected, onSelect, onDelete }: { item: LibraryItem; selected?: boolean; onSelect?: () => void; onDelete?: () => void }) {
  const [viewing, setViewing] = useState<number | null>(null)
  const gallery = galleryOf(item)
  const voice = item.files.find((file) => file.role === 'voice_sample')

  return (
    <div className={cn('group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-ink3/50', selected && 'border-brand ring-1 ring-brand')}>
      <div className='relative'>
        <button type='button' className='block w-full' onClick={onSelect ?? (() => gallery.length > 0 && setViewing(0))}>
          <AssetCover category={item.category} files={item.files} className={item.category === 'character' ? 'aspect-3/4' : undefined} />
        </button>
        <div className='absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
          {gallery.length > 0 && (
            <Button variant='secondary' size='icon-sm' title='查看设定图' aria-label='查看设定图' className='shadow-xs' onClick={() => setViewing(0)}>
              <Maximize2 className='h-3.5 w-3.5' />
            </Button>
          )}
          {onDelete && (
            <Button variant='secondary' size='icon-sm' title='删除' aria-label='删除' className='shadow-xs hover:text-fail' onClick={onDelete}>
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>
      </div>
      <button type='button' className='w-full flex-1 space-y-1 p-2.5 text-left' onClick={onSelect}>
        <p className='truncate text-sm font-semibold' title={item.name}>
          {item.name}
        </p>
        {item.tags[0] && <p className='truncate text-2xs text-muted-foreground'>来自《{item.tags[0]}》</p>}
        <p className='line-clamp-2 min-h-8 text-2xs text-muted-foreground'>{blurbOf(item.category, item.data, item.base_id !== null) || '暂无设定'}</p>
      </button>
      {voice && <audio controls preload='none' src={fileUrl(voice.path)} className='h-8 w-full px-2 pb-2' />}
      <Lightbox images={gallery} index={viewing} onIndexChange={setViewing} />
    </div>
  )
}

export function FromLibraryButton({ projectId, category, onCreated }: { projectId: string; category: AssetCategory; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<LibraryItem | null>(null)
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const library = useQuery({ queryKey: ['library'], queryFn: api.library, enabled: open })
  const items = library.data?.filter((item) => item.category === category) ?? []
  const label = ASSET_CATEGORY_LABEL[category]

  const copy = useMutation({
    mutationFn: () => api.copyFromLibrary(picked?.id ?? '', projectId, name.trim()),
    onSuccess: async (asset) => {
      toast.success(`已复制到作品：${asset.name}`)
      await queryClient.invalidateQueries()
      setOpen(false)
      onCreated(asset.id)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const reset = (next: boolean) => {
    setOpen(next)
    setPicked(null)
    setName('')
  }
  const submit = () => {
    if (picked && name.trim() && !copy.isPending) copy.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size='sm' variant='outline'>
          <Library className='h-3.5 w-3.5' />
          从素材库添加
        </Button>
      </DialogTrigger>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
        <DialogTitle>从素材库添加{label}</DialogTitle>
        {library.isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState>暂无{label}，可在资产卡的「更多」菜单中存入素材库</EmptyState>
        ) : (
          <div className='grid grid-cols-3 gap-3'>
            {items.map((item) => (
              <LibraryTile
                key={item.id}
                item={item}
                selected={picked?.id === item.id}
                onSelect={() => {
                  setPicked(item)
                  setName(item.name)
                }}
              />
            ))}
          </div>
        )}
        {picked && (
          <div className='flex items-center gap-2'>
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} placeholder={`在这部作品里的${label}名`} />
            <Button disabled={!name.trim() || copy.isPending} onClick={submit}>
              复制到作品
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function useDeleteLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteLibraryItem(id),
    onSuccess: async () => {
      toast.success('已从素材库删除')
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function DeleteLibraryPrompt({ item, onOpenChange }: { item: LibraryItem | null; onOpenChange: (open: boolean) => void }) {
  const remove = useDeleteLibraryItem()
  return <ConfirmPrompt open={item !== null} onOpenChange={onOpenChange} question={`从素材库删除「${item?.name ?? ''}」？已复制到作品中的不受影响`} onConfirm={() => item && remove.mutate(item.id)} />
}
