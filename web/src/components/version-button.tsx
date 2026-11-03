import { History as HistoryIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function VersionButton({ current, className, onClick }: { current?: number; className?: string; onClick: () => void }) {
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      title={current === undefined ? '历史版本' : `历史版本 · 当前 v${current}`}
      aria-label='历史版本'
      className={cn('text-muted-foreground', className)}
      onClick={onClick}
    >
      <HistoryIcon className='h-3.5 w-3.5' />
    </Button>
  )
}
