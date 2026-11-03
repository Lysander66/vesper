import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FilePlus2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { SourcePicker, useSourceState } from '@/components/source-picker'

export function AddSourcesDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const source = useSourceState(() => '粘贴的原文.txt')

  const add = useMutation({
    mutationFn: () => api.addSources(projectId, source.payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success(`已追加 ${source.payload.length} 份原文`)
      source.reset()
      setOpen(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size='sm' variant='outline'>
          <FilePlus2 className='h-3.5 w-3.5' />
          追加原文
        </Button>
      </DialogTrigger>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>追加原文</DialogTitle>
        </DialogHeader>
        <SourcePicker state={source} id='append-source' label='原文' />
        <DialogFooter>
          <Button disabled={source.payload.length === 0 || add.isPending} onClick={() => add.mutate()}>
            追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
