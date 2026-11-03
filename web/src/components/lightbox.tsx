import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fileUrl } from '@/lib/api'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export interface LightboxImage {
  readonly path: string
  readonly label: string
  readonly media?: 'image' | 'video'
}

export function Lightbox({ images, index, onIndexChange }: { images: readonly LightboxImage[]; index: number | null; onIndexChange: (index: number | null) => void }) {
  const current = index === null ? undefined : images[index]
  const step = (delta: number) => {
    if (index === null || images.length === 0) return
    onIndexChange((index + delta + images.length) % images.length)
  }

  return (
    <Dialog open={current !== undefined} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogContent
        showCloseButton={false}
        className='w-auto max-w-[min(92vw,1200px)] gap-2 border-none bg-transparent p-0 shadow-none'
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') step(1)
          if (event.key === 'ArrowLeft') step(-1)
        }}
      >
        <DialogTitle className='sr-only'>{current?.label ?? ''}</DialogTitle>
        {current && (
          <>
            <div className='flex items-center gap-2'>
              {images.length > 1 && <Arrow dir='prev' onClick={() => step(-1)} />}
              {current.media === 'video' ? (
                <video src={fileUrl(current.path)} controls autoPlay className='max-h-[82vh] min-w-0 rounded-lg bg-card object-contain' />
              ) : (
                <img src={fileUrl(current.path)} alt={current.label} className='max-h-[82vh] min-w-0 rounded-lg bg-card object-contain' />
              )}
              {images.length > 1 && <Arrow dir='next' onClick={() => step(1)} />}
            </div>
            <p className='text-center text-xs text-white/85'>
              {current.label}
              {images.length > 1 && (
                <span className='ml-2 font-mono text-2xs text-white/55'>
                  {index! + 1}/{images.length} · ← → 翻页
                </span>
              )}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Arrow({ dir, onClick }: { dir: 'prev' | 'next'; onClick: () => void }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button type='button' onClick={onClick} aria-label={dir === 'prev' ? '上一张' : '下一张'} className='shrink-0 rounded-full bg-white/15 p-2 text-white transition-colors hover:bg-white/30'>
      <Icon className='h-5 w-5' />
    </button>
  )
}
