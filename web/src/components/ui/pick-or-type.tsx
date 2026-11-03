import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export function PickOrType({ value, options, placeholder = '或填列表外的值', onChange }: { value: string; options: readonly string[]; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <div className='space-y-1.5'>
      <div className='flex flex-wrap gap-1'>
        {options.map((option) => (
          <button
            key={option}
            type='button'
            onClick={() => onChange(option)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-2xs transition-colors',
              option === value ? 'border-primary/40 bg-accent font-medium text-accent-foreground' : 'bg-card text-ink3 hover:bg-line2/60'
            )}
          >
            {option === value && <Check className='h-3.5 w-3.5 shrink-0' />}
            {option}
          </button>
        ))}
      </div>
      <Input className='h-8 bg-card font-mono text-xs' placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
