/** 说话人留空即无名旁白，下游据此挑音色。 */
import type { Utterance } from '@vesper/shared'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function UtteranceEditor({ utterances, readOnly, onChange }: { utterances: readonly Utterance[]; readOnly?: boolean; onChange: (utterances: Utterance[]) => void }) {
  const edit = (index: number, patch: Partial<Utterance>) => onChange(utterances.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  return (
    <div className='space-y-1.5'>
      {utterances.map((line, index) => (
        <div key={index} className='flex items-start gap-1.5'>
          {readOnly ? (
            <>
              <span className='w-20 shrink-0 truncate text-2xs font-semibold text-ink3'>{line.speaker ?? '旁白'}</span>
              <p className='text-sm'>{line.text}</p>
            </>
          ) : (
            <>
              <Input className='w-24 shrink-0 text-xs' placeholder='旁白' value={line.speaker ?? ''} onChange={(event) => edit(index, { speaker: event.target.value || null })} />
              <Textarea className='min-h-0' rows={1} value={line.text} onChange={(event) => edit(index, { text: event.target.value })} />
              <Button
                variant='ghost'
                size='icon-sm'
                title='删除该句'
                aria-label='删除该句'
                className='mt-1.5 shrink-0 text-muted-foreground hover:bg-fail-bg hover:text-fail'
                onClick={() => onChange(utterances.filter((_, i) => i !== index))}
              >
                <Trash2 className='h-3.5 w-3.5' />
              </Button>
            </>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button size='sm' variant='ghost' className='h-6 px-1.5 text-2xs' onClick={() => onChange([...utterances, { speaker: null, text: '' }])}>
          <Plus className='h-3.5 w-3.5' />
          添加台词
        </Button>
      )}
    </div>
  )
}
