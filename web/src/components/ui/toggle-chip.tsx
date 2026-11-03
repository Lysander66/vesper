import { cn } from '@/lib/utils'

export function ToggleChip({ on, size = 'sm', className, ...props }: { on: boolean; size?: 'xs' | 'sm' } & React.ComponentProps<'button'>) {
  return (
    <button
      type='button'
      aria-pressed={on}
      className={cn(
        'rounded-full transition-colors disabled:opacity-60',
        size === 'xs' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        on ? 'bg-brand text-brand-foreground' : 'bg-line2 text-muted-foreground hover:bg-border hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}
