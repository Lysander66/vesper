import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { episodeCountOf, renumberNote, type EpisodeSummary, type ProjectSource, type ProjectView } from '@vesper/shared'
import { ChevronRight, LockOpen, Sparkles, Trash2, Users, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLaunch } from '@/lib/run-center'
import { cn } from '@/lib/utils'
import { EmptyState, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { StatusChip } from '@/components/ui/status-chip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AddSourcesDialog } from '@/components/add-sources-dialog'
import { LaunchGroup, useLaunchParams } from '@/components/launch-params'
import { RunLog } from '@/components/run-log'
import { SortButton } from '@/components/sort-button'
import { ProjectSettings, VolumeBar } from './project-settings'

export function SourcesPanel({ view }: { view: ProjectView }) {
  // 存未勾选的：默认全选，之后追加的原文也是选中状态。
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const picked = view.sources.filter((source) => !excluded.has(source.id))
  const extractParams = useLaunchParams({ projectId: view.project.id, prompts: ['assets'] })
  const extract = useLaunch(() =>
    api.extractAssets(
      view.project.id,
      picked.map((source) => source.id),
      extractParams.extra
    )
  )

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Section
      title='原文与分集'
      actions={
        <>
          {view.sources.length > 0 && (
            <LaunchGroup
              state={extractParams}
              onLaunch={extract.trigger}
              icon={Users}
              label='提取资产'
              launchLabel='提取'
              variant='default'
              busy={extract.busy}
              disabled={picked.length === 0}
              title={picked.length === 0 ? '请先勾选原文' : `${picked.length} 份原文`}
            />
          )}
          <AddSourcesDialog projectId={view.project.id} />
          <SortButton
            title='原文排序'
            items={view.sources}
            onSave={async (ids) => {
              const result = await api.reorderSources(view.project.id, ids)
              const note = renumberNote(result.renumbered_from)
              if (note) toast.success(note)
            }}
          />
        </>
      }
    >
      {view.project.volume && <VolumeBar volume={view.project.volume} />}
      <ProjectSettings view={view} />
      {extract.runId && <RunLog runId={extract.runId} />}

      {view.sources.length === 0 ? (
        <EmptyState>暂无原文</EmptyState>
      ) : (
        <div className='divide-y rounded-md border'>
          {view.sources.map((source) => (
            // 区间表是本地草稿，只在这份原文的分集换了一批时才重挂，否则轮询会冲掉正在编辑的内容。
            <SourceBlock
              key={`${source.id}:${source.plan_state}:${source.episodes.map((episode) => episode.id).join(',')}`}
              projectId={view.project.id}
              source={source}
              picked={!excluded.has(source.id)}
              onPick={() => toggle(source.id)}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

function SourceBlock({ projectId, source, picked, onPick }: { projectId: string; source: ProjectSource; picked: boolean; onPick: () => void }) {
  const frozen = source.plan_state === 'frozen'
  const queryClient = useQueryClient()
  const [rows, setRows] = useState(() => source.episodes.map(toRow))
  const [dirty, setDirty] = useState(false)
  const [open, setOpen] = useState(false)

  const planParams = useLaunchParams({ projectId, prompts: ['episode'] })
  const plan = useLaunch(() => api.plan(source.id, planParams.extra))
  const wantedCount = episodeCountOf(planParams.prompts.find((section) => section.template.id === 'episode')?.values.episode_count)

  const suggest = useMutation({
    mutationFn: () => api.suggestEpisodes(source.id),
    onSuccess: (result) => planParams.setPromptArg('episode', 'episode_count', String(result.count)),
    onError: (error: Error) => toast.error(error.message),
  })

  const save = useMutation({
    mutationFn: () => api.putEpisodes(source.id, rows),
    onSuccess: async (result) => {
      setDirty(false)
      await queryClient.invalidateQueries()
      toast.success('区间已保存', { description: renumberNote(result.renumbered_from) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const toggleFreeze = useMutation({
    mutationFn: () => (frozen ? api.unfreeze(source.id) : api.freeze(source.id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success(frozen ? '已取消定稿' : '已定稿')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteSource(source.id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      toast.success('已删除这份原文', { description: renumberNote(result.renumbered_from) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const edit = (index: number, patch: Partial<Row>) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
  }

  const covered = rows.reduce((sum, row) => sum + (row.source_end - row.source_start), 0)
  // 有未保存的改动、规划进行中或区间未铺满时强制展开，免得问题藏在折叠里。
  const forced = dirty || plan.runId !== null || (!frozen && covered !== source.char_count)
  const expanded = open || forced
  const single = source.episodes.length === 1 ? source.episodes[0] : undefined

  return (
    <section>
      <header className='flex items-center gap-2 px-2.5 py-1'>
        <Checkbox checked={picked} onCheckedChange={onPick} title='提取资产时包含此原文' aria-label='提取资产时包含此原文' />
        <button type='button' className='flex min-w-0 flex-1 items-center gap-2 py-1 text-left' title={source.name} aria-expanded={expanded} disabled={forced} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-ink3 transition-transform', expanded && 'rotate-90')} />
          {single ? (
            <>
              <span className='w-10 shrink-0 font-mono text-2xs text-ink3'>EP{single.idx + 1}</span>
              <span className='truncate text-sm font-semibold'>{single.title}</span>
            </>
          ) : (
            <span className='truncate text-sm font-semibold'>
              {source.name}
              <span className='ml-2 font-mono text-2xs font-normal text-ink3'>{source.episodes.length} 集</span>
            </span>
          )}
          {/* 这里是字符下标，与时长预估的「字」不同：那个不计空白。 */}
          <span className='shrink-0 font-mono text-2xs text-ink3'>{source.char_count} 字符</span>
        </button>
        {frozen ? (
          <StatusChip tone='ok'>已定稿</StatusChip>
        ) : (
          <Button size='sm' variant='ghost' disabled={rows.length === 0 || toggleFreeze.isPending} onClick={() => toggleFreeze.mutate()}>
            定稿
          </Button>
        )}
      </header>

      {!expanded && !single && source.episodes.length > 0 && (
        <ul className='pr-2.5 pb-1 pl-[3.25rem]'>
          {source.episodes.map((episode) => (
            <EpisodeLine key={episode.id} episode={episode} />
          ))}
        </ul>
      )}

      {expanded && (
        <div className='space-y-2 pr-2.5 pb-2 pl-[3.25rem]'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span className='mr-auto truncate text-2xs text-ink3'>{source.name}</span>
            {!frozen && (
              <LaunchGroup
                state={planParams}
                onLaunch={plan.trigger}
                icon={Wand2}
                label='自动规划'
                launchLabel='规划'
                busy={plan.busy}
                question={replanWarning(source.episodes, wantedCount, dirty)}
                disabled={wantedCount === 0}
                title={wantedCount === 0 ? '请先在参数中填写集数' : `切成 ${wantedCount} 集`}
                lead={
                  <div className='flex items-center gap-2'>
                    <Button size='sm' variant='outline' disabled={suggest.isPending} onClick={() => suggest.mutate()}>
                      <Sparkles className='h-3.5 w-3.5' />
                      {suggest.isPending ? '推荐中…' : '推荐集数'}
                    </Button>
                    {suggest.data && <p className='min-w-0 text-2xs leading-snug text-ink3'>{suggest.data.reason}</p>}
                  </div>
                }
              />
            )}
            {dirty && !frozen && (
              <Button size='sm' variant='outline' disabled={save.isPending} onClick={() => save.mutate()}>
                保存区间
              </Button>
            )}
            {frozen && (
              <Button size='sm' variant='ghost' disabled={toggleFreeze.isPending} onClick={() => toggleFreeze.mutate()}>
                <LockOpen className='h-3.5 w-3.5' />
                取消定稿
              </Button>
            )}
            {!frozen && (
              <ConfirmDialog tooltip='删除这份原文' question={`删除该原文及其 ${source.episodes.length} 集？`} disabled={remove.isPending} onConfirm={() => remove.mutate()}>
                <Trash2 className='h-3.5 w-3.5' />
              </ConfirmDialog>
            )}
          </div>

          {plan.runId && <RunLog runId={plan.runId} />}

          {rows.length === 0 ? (
            <EmptyState className='py-3'>暂无分集</EmptyState>
          ) : frozen ? (
            // 定稿后渲染成纯文本而不是 disabled 输入框，满屏灰框既难读又像出了故障。
            <ul>
              {source.episodes.map((episode) => (
                <EpisodeLine key={episode.id} episode={episode} />
              ))}
            </ul>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-12'>#</TableHead>
                    <TableHead className='w-56'>标题</TableHead>
                    <TableHead>梗概</TableHead>
                    <TableHead className='w-20'>起</TableHead>
                    <TableHead className='w-20'>止</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell className='font-mono text-xs text-ink3'>EP{(source.episodes[index]?.idx ?? index) + 1}</TableCell>
                      <TableCell>
                        <Input value={row.title} onChange={(event) => edit(index, { title: event.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input value={row.synopsis} onChange={(event) => edit(index, { synopsis: event.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input type='number' value={row.source_start} onChange={(event) => edit(index, { source_start: Number(event.target.value) })} />
                      </TableCell>
                      <TableCell>
                        <Input type='number' value={row.source_end} onChange={(event) => edit(index, { source_end: Number(event.target.value) })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {covered !== source.char_count && (
                <p className='font-mono text-2xs text-warn'>
                  已覆盖 {covered} / {source.char_count} 字符
                  {covered < source.char_count && ` · 余 ${source.char_count - covered} 字符未分集`}
                  {covered > source.char_count && ' · 区间有重叠'}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function EpisodeLine({ episode }: { episode: EpisodeSummary }) {
  return (
    <li className='flex items-baseline gap-2 py-0.5 text-sm'>
      <span className='w-10 shrink-0 font-mono text-2xs text-ink3'>EP{episode.idx + 1}</span>
      <span className='shrink-0'>{episode.title}</span>
      <span className='truncate text-xs text-muted-foreground'>{episode.synopsis}</span>
      <span className='ml-auto shrink-0 font-mono text-2xs text-ink3'>
        {episode.source_start} – {episode.source_end}
      </span>
    </li>
  )
}

interface Row {
  title: string
  synopsis: string
  source_start: number
  source_end: number
}

function toRow(episode: EpisodeSummary): Row {
  return {
    title: episode.title,
    synopsis: episode.synopsis,
    source_start: episode.source_start,
    source_end: episode.source_end,
  }
}

function replanWarning(episodes: readonly EpisodeSummary[], wanted: number, dirty: boolean): string | undefined {
  const worked = (episode: EpisodeSummary) => episode.beats_count > 0 || episode.shots > 0
  const dropped = episodes.slice(wanted).filter(worked)
  if (dropped.length > 0) {
    const first = dropped[0]!.idx + 1
    const last = dropped[dropped.length - 1]!.idx + 1
    return `删除第 ${first === last ? first : `${first}–${last}`} 集的节拍与镜头？`
  }
  if (episodes.some(worked)) return '已生成节拍的分集区间将改变，是否重新规划？'
  if (dirty) return '未保存的区间将丢失，是否重新规划？'
  return undefined
}
