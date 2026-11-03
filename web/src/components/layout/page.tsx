import { Inbox, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

export function PageHeader({ title, lead, meta, actions, className }: { title: React.ReactNode; lead?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-wrap items-start gap-3', className)}>
      <div className='min-w-0 flex-1 space-y-1'>
        {lead && <div className='text-xs text-muted-foreground'>{lead}</div>}
        <h1 className='truncate text-lg font-semibold'>{title}</h1>
        {meta && <div className='text-xs text-muted-foreground'>{meta}</div>}
      </div>
      {actions && <div className='flex flex-wrap items-center gap-2'>{actions}</div>}
    </header>
  )
}

export function Section({
  id,
  title,
  meta,
  actions,
  className,
  bodyClassName,
  children,
}: {
  id?: string
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className={cn('flex flex-col rounded-lg border bg-card shadow-xs', className)}>
      <header className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <h2 className='text-sm font-semibold'>{title}</h2>
        {meta && <span className='font-mono text-2xs text-ink3'>{meta}</span>}
        {actions && <div className='ml-auto flex flex-wrap items-center gap-2'>{actions}</div>}
      </header>
      <div className={cn('space-y-3 p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({ icon: Icon = Inbox, className, children }: { icon?: LucideIcon; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground', className)}>
      <Icon className='size-6 text-ink3/50' />
      <div>{children}</div>
    </div>
  )
}

export function LoadingState({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 py-4', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-4', index % 2 === 0 ? 'w-3/5' : 'w-2/5')} />
      ))}
    </div>
  )
}
