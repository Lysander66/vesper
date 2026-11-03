import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function CopyButton({ text, className }: { text: string; className?: string }) {
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      title='复制'
      aria-label='复制'
      className={cn('text-muted-foreground', className)}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => toast.success('已复制'))
      }}
    >
      <Copy className='h-3.5 w-3.5' />
    </Button>
  )
}
