import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'

const ARMED_MS = 3000

/** 双击会连吃两下，等于没确认。 */
const DEBOUNCE_MS = 300

export function ConfirmButton({
  onConfirm,
  question,
  tone = 'fail',
  variant = 'ghost',
  size = 'icon-sm',
  tooltip,
  disabled,
  className,
  children,
}: {
  onConfirm: () => void
  question: ReactNode
  tone?: 'fail' | 'brand'
  variant?: 'ghost' | 'outline'
  size?: 'sm' | 'icon-sm'
  tooltip?: string
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const [armedAt, setArmedAt] = useState<number | null>(null)
  const armed = armedAt !== null

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmedAt(null), ARMED_MS)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <Button
      type='button'
      variant={variant}
      size={armed ? 'sm' : size}
      title={armed ? undefined : tooltip}
      aria-label={tooltip}
      disabled={disabled}
      className={cn(
        variant === 'ghost' && 'text-muted-foreground',
        tone === 'fail' ? 'hover:bg-fail-bg hover:text-fail' : 'hover:text-brand',
        armed && (tone === 'fail' ? 'bg-fail-bg text-fail' : 'text-brand'),
        className
      )}
      onMouseLeave={() => setArmedAt(null)}
      onClick={() => {
        if (armedAt === null) {
          setArmedAt(Date.now())
          return
        }
        if (Date.now() - armedAt < DEBOUNCE_MS) return
        setArmedAt(null)
        onConfirm()
      }}
    >
      {armed ? question : children}
    </Button>
  )
}

export function ConfirmDialog({
  onConfirm,
  question,
  action = '删除',
  variant = 'ghost',
  size = 'icon-sm',
  tooltip,
  disabled,
  className,
  children,
}: {
  onConfirm: () => void
  question: ReactNode
  action?: string
  variant?: 'ghost' | 'outline'
  size?: 'sm' | 'icon-sm'
  tooltip?: string
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type='button'
        variant={variant}
        size={size}
        title={tooltip}
        aria-label={tooltip}
        disabled={disabled}
        className={cn(variant === 'ghost' && 'text-muted-foreground', 'hover:bg-fail-bg hover:text-fail', className)}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <ConfirmPrompt open={open} onOpenChange={setOpen} question={question} action={action} onConfirm={onConfirm} />
    </>
  )
}

export function ConfirmPrompt({
  open,
  onOpenChange,
  question,
  action = '删除',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  question: ReactNode
  action?: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-sm' showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle>{question}</DialogTitle>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline' size='sm'>
              取消
            </Button>
          </DialogClose>
          <Button
            variant='destructive'
            size='sm'
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
