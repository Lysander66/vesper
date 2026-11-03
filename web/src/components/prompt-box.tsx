/** 改写只进本次参数，不写回设定，也不会让产物过时。 */
import { useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Textarea } from '@/components/ui/textarea'
import type { LaunchParamsState } from '@/components/launch-params'

export function PromptBox({ purpose, text, state, title, className }: { purpose: string; text: string; state?: LaunchParamsState | undefined; title: ReactNode; className?: string }) {
  const [editing, setEditing] = useState(false)
  const rewritten = state?.promptText[purpose]
  const value = rewritten ?? text

  return (
    <div className='space-y-2'>
      <div className='flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1'>
        {title}
        {rewritten !== undefined && <span className='text-2xs text-brand'>已改写</span>}
        <div className='ml-auto flex items-center'>
          {state && rewritten !== undefined && (
            <Button
              variant='ghost'
              size='icon-sm'
              title='恢复默认值'
              aria-label='恢复默认值'
              className='text-muted-foreground'
              onClick={() => {
                state.setPromptText(purpose, null)
                setEditing(false)
              }}
            >
              <RotateCcw className='h-3.5 w-3.5' />
            </Button>
          )}
          {state && !editing && (
            <Button
              variant='ghost'
              size='sm'
              className='px-2 text-muted-foreground'
              onClick={() => {
                state.setPromptText(purpose, text)
                setEditing(true)
              }}
            >
              改写
            </Button>
          )}
          <CopyButton text={value} />
        </div>
      </div>
      {editing && state ? (
        <Textarea autoFocus className={cn('min-h-40 font-mono text-2xs leading-5', className)} value={value} onChange={(event) => state.setPromptText(purpose, event.target.value)} />
      ) : (
        <pre className={cn('min-w-0 overflow-auto font-mono text-2xs leading-5 whitespace-pre-wrap', className)}>{value}</pre>
      )}
    </div>
  )
}
