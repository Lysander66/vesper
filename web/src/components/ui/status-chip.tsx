import type { Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export function StatusChip({ tone, className, children }: { tone: Tone; className?: string; children: React.ReactNode }) {
  return (
    <Badge variant={tone} className={cn('px-1.5 text-2xs font-semibold', className)}>
      {children}
    </Badge>
  )
}
