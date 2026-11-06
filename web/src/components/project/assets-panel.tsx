import { Fragment, useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ASSET_CATEGORY_LABEL, type AssetCategory, type ProjectView } from '@vesper/shared'
import { Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLaunch } from '@/lib/run-center'
import { Section } from '@/components/layout/page'
import { ConfirmButton } from '@/components/ui/confirm'
import { AssetCard, AssetPanel, CATEGORY_ICON, NewAssetButton, SortAssetsButton } from '@/components/asset-card'
import { LaunchGroup, useLaunchParams } from '@/components/launch-params'
import { FromLibraryButton } from '@/components/library'
import { RunLog } from '@/components/run-log'

/** 未锁定的角色被镜头引用会直接报错，场景与道具只是改按文本描述生成，所以只提示角色。 */
export function AssetsPanel({ view, flash }: { view: ProjectView; flash: string | undefined }) {
  const unlockedCast = view.cast.filter((member) => member.state !== 'locked').length

  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 单独保存一份：`?asset=` 高亮结束后会被清除，面板不能随之关闭。
  const [taken, setTaken] = useState<string>()
  if (flash !== undefined && flash !== taken) {
    setTaken(flash)
    setExpandedId(flash)
  }

  return (
    <Section title='资产'>
      {unlockedCast > 0 && <p className='text-xs text-warn'>{unlockedCast} 个角色未锁定</p>}

      <div className='space-y-3'>
        <AssetGroup
          id='cast'
          projectId={view.project.id}
          category='character'
          items={view.cast}
          flash={flash}
          expandedId={expandedId}
          onExpand={setExpandedId}
          empty='暂无角色'
          render={(asset, controls) => <AssetCard category='character' asset={asset} {...controls} />}
        />
        <AssetGroup
          id='scenes'
          projectId={view.project.id}
          category='scene'
          items={view.scenes}
          flash={flash}
          expandedId={expandedId}
          onExpand={setExpandedId}
          empty='暂无场景'
          render={(asset, controls) => <AssetCard category='scene' asset={asset} {...controls} />}
        />
        <AssetGroup
          id='props'
          projectId={view.project.id}
          category='prop'
          items={view.props}
          flash={flash}
          expandedId={expandedId}
          onExpand={setExpandedId}
          empty='暂无道具'
          render={(asset, controls) => <AssetCard category='prop' asset={asset} {...controls} />}
        />
      </div>
    </Section>
  )
}

interface CardControls {
  flash: boolean
  expanded: boolean
  onToggle: () => void
}

function AssetGroup<T extends { id: string; name: string; state: string }>({
  id,
  projectId,
  category,
  items,
  empty,
  flash,
  expandedId,
  onExpand,
  render,
}: {
  id: string
  projectId: string
  category: AssetCategory
  items: readonly T[]
  empty: string
  flash: string | undefined
  expandedId: string | null
  onExpand: (id: string | null) => void
  render: (asset: T, controls: CardControls) => React.ReactNode
}) {
  const [columns, gridRef] = useGridColumns()
  const locked = items.filter((item) => item.state === 'locked').length
  const unlocked = items.length - locked
  const Icon = CATEGORY_ICON[category]
  const queryClient = useQueryClient()

  const params = useLaunchParams({ projectId, roles: ['image'], prompts: ['look'] })
  const looks = useLaunch(() => api.projectLooks(projectId, category, params.extra))

  const lockAll = useMutation({
    mutationFn: () => api.lockAssets(projectId, category),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      const skipped = result.skipped > 0 ? `，${result.skipped} 件无设定图，未锁定` : ''
      toast.success(`已锁定 ${result.locked.length} 件${skipped}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const at = items.findIndex((item) => item.id === expandedId)
  // 面板插在所在行的行末，紧跟卡片会把一行截断。
  const after = at < 0 ? -1 : Math.min(items.length - 1, at - (at % columns) + columns - 1)

  return (
    <section id={id} className='space-y-2.5 border-t pt-3 first:border-t-0 first:pt-0'>
      <div className='flex items-center gap-2'>
        <Icon className='h-3.5 w-3.5 text-muted-foreground' />
        <h3 className='text-sm font-semibold'>{ASSET_CATEGORY_LABEL[category]}</h3>
        <ConfirmButton
          tone='brand'
          size='sm'
          className='h-auto rounded-md bg-line2 px-1.5 py-0.5 font-mono text-2xs'
          disabled={unlocked === 0 || lockAll.isPending}
          question={`锁定 ${unlocked} 件？`}
          onConfirm={() => lockAll.mutate()}
        >
          {locked}/{items.length} 已锁定
        </ConfirmButton>
        <div className='ml-auto flex items-center gap-1.5'>
          <LaunchGroup state={params} onLaunch={looks.trigger} icon={Wand2} label='生成设定图' variant='default' busy={looks.busy} disabled={items.length === 0} />
          <NewAssetButton projectId={projectId} category={category} onCreated={onExpand} />
          <FromLibraryButton projectId={projectId} category={category} onCreated={onExpand} />
          <SortAssetsButton projectId={projectId} category={category} items={items} />
        </div>
      </div>
      {looks.runId && <RunLog runId={looks.runId} />}
      {items.length === 0 ? (
        <p className='text-xs text-muted-foreground'>{empty}</p>
      ) : (
        <div ref={gridRef} className='grid gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6'>
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {render(item, {
                flash: item.id === flash,
                expanded: item.id === expandedId,
                onToggle: () => onExpand(item.id === expandedId ? null : item.id),
              })}
              {index === after && items[at] && (
                // key 让面板随资产整个重建，设定字段的草稿不会串到下一件上。
                <AssetPanel key={items[at].id} assetId={items[at].id} name={items[at].name} onClose={() => onExpand(null)} />
              )}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  )
}

function useGridColumns(): [number, (element: HTMLDivElement | null) => void] {
  const [columns, setColumns] = useState(1)
  const observer = useRef<ResizeObserver | null>(null)

  // 空态与网格互换会换掉 DOM 节点，所以用 callback ref；只在挂载时绑定会盯住旧节点。
  const attach = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (element === null) return
    const measure = () => setColumns(getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length)
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(element)
  }, [])

  return [columns, attach]
}
