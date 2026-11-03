import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { allEpisodes } from '@vesper/shared'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SourcePicker, useSourceState } from '@/components/source-picker'

export function NewProjectDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [targetSeconds, setTargetSeconds] = useState(0)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const source = useSourceState(
    () => `${name || '粘贴的原文'}.txt`,
    (fileName) => {
      if (!name) setName(fileName.replace(/EP?\d+.*$/i, '').replace(/\.[^.]+$/, '') || fileName)
    }
  )

  const create = useMutation({
    mutationFn: () => api.createProject({ name, files: source.payload, target_seconds: targetSeconds }),
    onSuccess: async (view) => {
      toast.success(`已导入 ${allEpisodes(view).length} 集。${view.project.volume?.message ?? ''}`)
      await queryClient.invalidateQueries({ queryKey: ['home'] })
      setOpen(false)
      void navigate({ to: '/projects/$projectId', params: { projectId: view.project.id } })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className='h-3.5 w-3.5' />
            新建作品
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>新建作品</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='name'>作品名</Label>
            <Input id='name' value={name} onChange={(event) => setName(event.target.value)} placeholder='雪夜来客' />
          </div>
          <SourcePicker state={source} id='source' label='原文' />
          <div className='space-y-1.5'>
            <Label htmlFor='target'>单集目标时长（秒）</Label>
            <Input id='target' type='number' min={0} value={targetSeconds} onChange={(event) => setTargetSeconds(Math.max(0, Number(event.target.value)))} className='w-32' />
            <p className='text-xs text-muted-foreground'>0 为不限</p>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!name || source.payload.length === 0 || create.isPending} onClick={() => create.mutate()}>
            导入并分集
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
