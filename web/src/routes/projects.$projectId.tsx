import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { allEpisodes, type ProjectView } from '@vesper/shared'
import { PencilLine, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useFlashClear } from '@/lib/flash'
import { LoadingState, PageHeader } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { AssetsPanel } from '@/components/project/assets-panel'
import { SourcesPanel } from '@/components/project/sources-panel'
import { RecordsLink } from '@/components/records'

interface ProjectSearch {
  asset?: string
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectPage,
  validateSearch: (search: Record<string, unknown>): ProjectSearch => ({
    asset: typeof search.asset === 'string' && search.asset !== '' ? search.asset : undefined,
  }),
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  const { asset } = Route.useSearch()
  const navigate = Route.useNavigate()
  const view = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) })

  useFlashClear(asset !== undefined, () => void navigate({ search: () => ({ asset: undefined }), replace: true, resetScroll: false }))

  if (view.isError) return <p className='text-sm text-fail'>{view.error.message}</p>
  if (!view.data) return <LoadingState />
  const { project } = view.data

  // 同一路由换参数不会重新挂载，key 让各面板的草稿随作品一起换掉。
  return (
    <div key={project.id} className='space-y-4'>
      <PageHeader
        title={<ProjectTitle projectId={project.id} name={project.name} />}
        meta={
          <span className='font-mono text-2xs text-ink3'>
            {view.data.sources.length} 份原文 · {allEpisodes(view.data).length} 集 · 整体完成度 {view.data.overall_percent}%
          </span>
        }
        actions={
          <>
            <RecordsLink owner={{ kind: 'project', id: project.id }} />
            <DeleteProjectButton view={view.data} />
          </>
        }
      />

      <SourcesPanel view={view.data} />
      <AssetsPanel view={view.data} flash={asset} />
    </div>
  )
}

function ProjectTitle({ projectId, name }: { projectId: string; name: string }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: (value: string) => api.patchProject(projectId, { name: value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      setDraft(null)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (draft === null)
    return (
      <span className='inline-flex max-w-full items-center gap-1 align-middle'>
        <span className='truncate'>{name}</span>
        <Button variant='ghost' size='icon-sm' title='改名' aria-label='改名' className='shrink-0 text-muted-foreground' onClick={() => setDraft(name)}>
          <PencilLine className='h-3.5 w-3.5' />
        </Button>
      </span>
    )

  const submit = () => {
    const value = draft.trim()
    if (value === '' || value === name) {
      setDraft(null)
      return
    }
    rename.mutate(value)
  }
  return (
    <Input
      autoFocus
      value={draft}
      disabled={rename.isPending}
      className='h-8 w-72 text-lg font-semibold'
      onChange={(event) => setDraft(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit()
        if (event.key === 'Escape') setDraft(null)
      }}
    />
  )
}

function DeleteProjectButton({ view }: { view: ProjectView }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.deleteProject(view.project.id),
    // 先离开再失效：反过来本页的查询会先撞上 404。
    onSuccess: async () => {
      toast.success('已删除')
      await navigate({ to: '/' })
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const episodes = allEpisodes(view).length

  return (
    <ConfirmDialog tooltip='删除作品' question={episodes > 0 ? `删除作品及其 ${episodes} 集产物？` : '删除该作品？'} disabled={remove.isPending} onConfirm={() => remove.mutate()}>
      <Trash2 className='h-3.5 w-3.5' />
    </ConfirmDialog>
  )
}
