/** 浮层里用它代替 Select：Select 的面板渲染在 DOM 树之外，点它会把浮层关掉。 */
import { cn } from '@/lib/utils'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  render,
  className,
}: {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  render?: (option: T) => React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-9 flex-wrap items-center gap-0.5 rounded-md border bg-card p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option}
          type='button'
          onClick={() => onChange(option)}
          className={cn('rounded-md px-2.5 py-1 text-xs transition-colors', value === option ? 'bg-accent font-medium text-accent-foreground' : 'text-ink3 hover:bg-line2/60')}
        >
          {render ? render(option) : option}
        </button>
      ))}
    </div>
  )
}
