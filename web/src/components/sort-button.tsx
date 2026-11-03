import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUpDown, ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface Item {
  id: string
  name: string
}

export function SortButton({
  title,
  items,
  onSave,
  footer,
}: {
  title: string
  items: readonly Item[]
  onSave: (ids: readonly string[]) => Promise<unknown>
  footer?: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(items)
  const [dragging, setDragging] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: onSave,
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      setOpen(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return
    const next = [...draft]
    const [item] = next.splice(from, 1)
    if (item) next.splice(to, 0, item)
    setDraft(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(items)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button size='sm' variant='outline' title='排序' aria-label='排序' disabled={items.length < 2}>
          <ArrowUpDown className='h-3.5 w-3.5' />
        </Button>
      </DialogTrigger>
      <DialogContent className='max-w-sm'>
        <DialogTitle>{title}</DialogTitle>
        <ol className='space-y-1'>
          {draft.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={() => setDragging(index)}
              onDragOver={(event) => {
                event.preventDefault()
                if (dragging === null || dragging === index) return
                move(dragging, index)
                setDragging(index)
              }}
              onDragEnd={() => setDragging(null)}
              className={cn('flex items-center gap-2 rounded-md border bg-card py-1 pr-1 pl-2', dragging === index && 'opacity-50')}
            >
              <GripVertical className='h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground' />
              <span className='min-w-0 flex-1 truncate text-sm'>{item.name}</span>
              <Button size='icon-sm' variant='ghost' title='上移' aria-label='上移' disabled={index === 0} onClick={() => move(index, index - 1)}>
                <ChevronUp className='h-3.5 w-3.5' />
              </Button>
              <Button size='icon-sm' variant='ghost' title='下移' aria-label='下移' disabled={index === draft.length - 1} onClick={() => move(index, index + 1)}>
                <ChevronDown className='h-3.5 w-3.5' />
              </Button>
            </li>
          ))}
        </ol>
        <div className='flex items-center gap-2'>
          {footer?.(() => setOpen(false))}
          <Button size='sm' className='ml-auto' disabled={save.isPending} onClick={() => save.mutate(draft.map((item) => item.id))}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
