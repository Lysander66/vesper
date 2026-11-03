import { useState, type ReactNode } from 'react'
import { Code2, Play, Undo2, ZoomIn } from 'lucide-react'
import { fileUrl, videoUrl } from '@/lib/api'
import { localStamp, type RecordsOwner } from '@/lib/records'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm'
import { Lightbox } from '@/components/lightbox'
import { CallsDialog } from '@/components/records'

interface StripItem {
  key: string | number
  version: number
  path: string | null
  created_at: string
  job_id: string | null
  badge?: ReactNode
}

export function VersionStrip({
  items,
  media,
  label,
  owner,
  purpose,
  compact = false,
  restoring = false,
  onRestore,
}: {
  items: readonly StripItem[]
  media: 'image' | 'video' | 'audio'
  label: string
  owner: RecordsOwner
  purpose: string
  compact?: boolean
  restoring?: boolean
  onRestore?: (item: StripItem) => void
}) {
  const [viewing, setViewing] = useState<number | null>(null)
  const [calls, setCalls] = useState<string | null>(null)
  const solo = items.length === 1 && !compact
  const gallery = media === 'audio' ? [] : items.flatMap((item) => (item.path ? [{ path: item.path, label: `v${item.version}`, media }] : []))

  return (
    <>
      <div className='flex gap-4 overflow-x-auto pb-1'>
        {items.map((item, index) => (
          <div key={item.key} className={cn('space-y-1.5', solo ? 'min-w-0' : 'shrink-0')}>
            <div className='space-y-0.5'>
              <div className='flex items-center gap-1.5'>
                <span className='font-mono text-sm font-medium'>v{item.version}</span>
                {index === 0 && (
                  <Badge variant='muted' className='px-1.5 text-2xs'>
                    当前
                  </Badge>
                )}
                {item.badge}
                {item.job_id !== null && (
                  <Button variant='ghost' size='icon-sm' title='该版本的调用记录' aria-label='该版本的调用记录' className='-my-1 text-muted-foreground' onClick={() => setCalls(item.job_id)}>
                    <Code2 className='h-3.5 w-3.5' />
                  </Button>
                )}
                {index > 0 && item.path && onRestore && <RestoreButton disabled={restoring} onConfirm={() => onRestore(item)} />}
              </div>
              <p className='font-mono text-2xs text-ink3'>{localStamp(item.created_at)}</p>
            </div>
            {item.path ? (
              media === 'audio' ? (
                <audio src={fileUrl(item.path)} controls className='w-72' />
              ) : (
                <ThumbButton
                  media={media}
                  label={label}
                  path={item.path}
                  className={solo ? 'max-h-[72vh] max-w-full' : 'max-h-[50vh] max-w-[260px]'}
                  onOpen={() => setViewing(gallery.findIndex((image) => image.path === item.path))}
                />
              )
            ) : (
              <p className='w-48 rounded-md border border-dashed px-2 py-6 text-center text-xs text-muted-foreground'>文件已删除</p>
            )}
          </div>
        ))}
      </div>
      <Lightbox images={gallery} index={viewing} onIndexChange={setViewing} />
      {calls !== null && <CallsDialog jobId={calls} purpose={purpose} owner={owner} open onOpenChange={(next) => !next && setCalls(null)} />}
    </>
  )
}

function RestoreButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  return (
    <ConfirmButton
      size='sm'
      tone='brand'
      className='-my-1 h-7 px-1.5 text-xs'
      disabled={disabled}
      question={
        <>
          <Undo2 className='h-3.5 w-3.5' />
          恢复此版本？
        </>
      }
      onConfirm={onConfirm}
    >
      <Undo2 className='h-3.5 w-3.5' />
      恢复此版本
    </ConfirmButton>
  )
}

export function ThumbButton({
  media,
  label,
  path,
  className,
  fill = false,
  onOpen,
}: {
  media: 'image' | 'video'
  label: string
  path: string
  className?: string
  fill?: boolean
  onOpen: () => void
}) {
  return (
    <button type='button' onClick={onOpen} aria-label={`放大${label}`} className={cn('group relative block max-w-full overflow-hidden rounded-md', fill ? 'h-full w-full' : 'w-fit')}>
      {media === 'video' ? <video src={videoUrl(path)} muted preload='metadata' className={className} /> : <img src={fileUrl(path)} alt={label} className={className} />}
      <ZoomHint media={media} />
    </button>
  )
}

export function ZoomHint({ media = 'image' }: { media?: 'image' | 'video' }) {
  return (
    <span className='absolute inset-0 flex items-center justify-center text-transparent transition-colors group-hover:bg-black/35 group-hover:text-white'>
      {media === 'video' ? <Play className='h-5 w-5' /> : <ZoomIn className='h-4 w-4' />}
    </span>
  )
}
