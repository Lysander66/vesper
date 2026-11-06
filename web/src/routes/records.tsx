import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { JOB_STATUS_LABEL, type Job, type JobStatus, type ModelCost } from '@vesper/shared'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { argvLine, jobSeconds, localStamp, OWNER_LABEL, ownerLine, purposeLabel, type RecordsOwner } from '@/lib/records'
import type { Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { EmptyState, LoadingState, PageHeader, Section } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { titleOf } from '@/components/binding-form'
import { formatMoney, formatUsage } from '@/components/cost'
import { CodeBlock, JobCalls } from '@/components/job-calls'

interface RecordsSearch {
  owner_kind?: RecordsOwner['kind']
  owner_id?: string
  job?: string
}

const OWNER_KINDS = ['project', 'episode', 'shot', 'asset'] as const

const STATUS_FILTERS = ['all', 'succeeded', 'failed', 'active'] as const

const STATUS_FILTER_LABEL = {
  all: '全部',
  succeeded: '已完成',
  failed: '失败',
  active: '进行中',
} as const

type StatusFilter = (typeof STATUS_FILTERS)[number]

const ALL_PURPOSES = '__all__'

const JOB_TONE: Record<JobStatus, Tone> = {
  queued: 'idle',
  running: 'busy',
  succeeded: 'ok',
  failed: 'fail',
  cancelled: 'idle',
}

export const Route = createFileRoute('/records')({
  component: RecordsPage,
  validateSearch: (search: Record<string, unknown>): RecordsSearch => {
    const kind = OWNER_KINDS.find((item) => item === search.owner_kind)
    const id = typeof search.owner_id === 'string' && search.owner_id !== '' ? search.owner_id : undefined
    const job = typeof search.job === 'string' && search.job !== '' ? search.job : undefined
    return { ...(kind && id ? { owner_kind: kind, owner_id: id } : {}), ...(job ? { job } : {}) }
  },
})

function RecordsPage() {
  const { owner_kind, owner_id, job: focus } = Route.useSearch()
  const owner: RecordsOwner | undefined = owner_kind && owner_id ? { kind: owner_kind, id: owner_id } : undefined

  const jobs = useQuery({ queryKey: ['jobs', owner ?? 'all'], queryFn: () => api.jobs(owner) })
  const commands = useQuery({ queryKey: ['commands', owner ?? 'all'], queryFn: () => api.commands(owner) })
  const cost = useQuery({ queryKey: ['jobs-cost', owner ?? 'all'], queryFn: () => api.jobsCost(owner) })
  const endpoints = useQuery({ queryKey: ['endpoints'], queryFn: api.endpoints })
  const endpointName = (id: string) => titleOf(endpoints.data ?? [], id) ?? endpoints.data?.find((item) => item.id === id)?.name ?? id

  const [status, setStatus] = useState<StatusFilter>('all')
  const [purpose, setPurpose] = useState<string>(ALL_PURPOSES)
  const [keyword, setKeyword] = useState('')

  const all = jobs.data ?? []
  const purposes = [...new Set(all.map((job) => job.purpose).filter((item) => item !== null))]
  const rows = all.filter((job) => matchStatus(job, status) && (purpose === ALL_PURPOSES || job.purpose === purpose) && matchKeyword(job, endpointName(job.endpoint_id), keyword))

  return (
    <div className='mx-auto w-full max-w-6xl space-y-4 py-2'>
      <PageHeader
        title='调用记录'
        meta='最近 100 条'
        actions={
          owner && (
            <>
              <Badge variant='outline' className='font-mono'>
                {OWNER_LABEL[owner.kind]} · {owner.id}
              </Badge>
              <Button asChild variant='ghost' size='sm'>
                <Link to='/records' search={{}}>
                  查看全部
                </Link>
              </Button>
            </>
          )
        }
      />

      {cost.data && cost.data.length > 0 && <ModelCosts costs={cost.data} />}

      <div className='flex flex-wrap items-center gap-2'>
        <Segmented value={status} options={STATUS_FILTERS} onChange={setStatus} render={(key) => STATUS_FILTER_LABEL[key]} />

        <Select value={purpose} onValueChange={setPurpose}>
          <SelectTrigger className='w-44 bg-card'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PURPOSES}>全部用途</SelectItem>
            {purposes.map((item) => (
              <SelectItem key={item} value={item}>
                {purposeLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input className='w-64 bg-card' placeholder='搜索任务 ID、归属 ID、接口、错误信息或用途' value={keyword} onChange={(event) => setKeyword(event.target.value)} />

        <span className='font-mono text-2xs text-ink3'>{rows.length === all.length ? `${all.length} 条` : `${rows.length} / ${all.length} 条`}</span>
      </div>

      <section className='space-y-2'>
        {jobs.isPending && <LoadingState />}
        {jobs.isSuccess && all.length === 0 && <EmptyState>暂无调用记录</EmptyState>}
        {all.length > 0 && rows.length === 0 && <EmptyState>无符合条件的记录</EmptyState>}
        {rows.map((job) => (
          <JobRow key={job.id} job={job} endpoint={endpointName(job.endpoint_id)} focused={job.id === focus} />
        ))}
      </section>

      {commands.data !== undefined && commands.data.length > 0 && (
        <Section title='本地命令' bodyClassName='space-y-2'>
          {commands.data.map((command) => (
            <div key={command.id} className='space-y-1 rounded-md border px-3 py-2'>
              <div className='flex items-center gap-2 text-sm'>
                <Badge variant={command.exit_code === 0 ? 'ok' : 'fail'}>exit {command.exit_code ?? '—'}</Badge>
                <span>{command.kind}</span>
                <span className='ml-auto font-mono text-2xs text-ink3'>{localStamp(command.started_at)}</span>
                <CopyButton text={argvLine(command.argv)} />
              </div>
              <CodeBlock text={argvLine(command.argv)} />
              {command.stderr && <CodeBlock label='stderr' text={command.stderr} />}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

function ModelCosts({ costs }: { costs: readonly ModelCost[] }) {
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2'>
      {costs.map((cost) => (
        <div key={cost.model} className='rounded-md border bg-card px-3 py-2'>
          <div className='truncate font-mono text-2xs text-ink3' title={cost.model}>
            {cost.model}
          </div>
          <div className='font-mono text-base'>{cost.money ? formatMoney(cost.money) : <span className='text-muted-foreground'>未定价</span>}</div>
          <div className='font-mono text-2xs text-muted-foreground'>
            {cost.succeeded} 次{cost.failed > 0 && <span className='text-destructive'> · 失败 {cost.failed} 次</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function matchStatus(job: Job, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return job.status === 'queued' || job.status === 'running'
  return job.status === filter
}

function matchKeyword(job: Job, endpoint: string, keyword: string): boolean {
  const word = keyword.trim().toLowerCase()
  if (word === '') return true
  return [job.id, job.owner_id, endpoint, job.error, purposeLabel(job.purpose)].join(' ').toLowerCase().includes(word)
}

function JobRow({ job, endpoint, focused }: { job: Job; endpoint: string; focused: boolean }) {
  const [open, setOpen] = useState(focused)
  const anchor = useRef<HTMLDivElement>(null)
  const seconds = jobSeconds(job.created_at, job.finished_at)

  useEffect(() => {
    if (focused) anchor.current?.scrollIntoView({ block: 'center' })
  }, [focused])

  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div ref={anchor} className={cn('rounded-md border', focused && 'ring-2 ring-ring/50')}>
      <button className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm' onClick={() => setOpen(!open)}>
        <Chevron className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
        <Badge variant={JOB_TONE[job.status]} className='shrink-0'>
          {JOB_STATUS_LABEL[job.status] ?? job.status}
        </Badge>
        <span className='shrink-0'>{purposeLabel(job.purpose)}</span>
        <span className='truncate font-mono text-2xs text-ink3'>
          {endpoint}
          {job.owner_id === null ? '' : ` · ${ownerLine(job.owner_kind, job.owner_id)}`}
        </span>
        <span className='ml-auto shrink-0 font-mono text-2xs text-muted-foreground'>{seconds === null ? '进行中' : `${seconds.toFixed(1)}s`}</span>
        {job.usage && <span className='shrink-0 font-mono text-2xs text-muted-foreground'>{job.cost ? formatMoney(job.cost) : '未定价'}</span>}
        <span className='shrink-0 font-mono text-2xs text-ink3'>{localStamp(job.created_at)}</span>
      </button>
      {open && (
        <div className='border-t px-3 py-2'>
          {job.usage && <p className='mb-2 font-mono text-2xs text-muted-foreground'>{formatUsage(job.usage)}</p>}
          <JobCalls jobId={job.id} />
        </div>
      )}
    </div>
  )
}
