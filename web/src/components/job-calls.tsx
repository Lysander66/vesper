import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CALL_SECTION_LABEL, type Call, type JobStatus } from '@vesper/shared'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { prettyJson, truncate } from '@/lib/records'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'

export function JobCalls({ jobId }: { jobId: string }) {
  const detail = useQuery({ queryKey: ['job', jobId], queryFn: () => api.job(jobId) })
  if (!detail.data) return <LoadingState lines={2} className='px-3 py-2' />

  const { job, calls } = detail.data
  const envVar = calls.find((call) => call.curl.env_var !== null)?.curl.env_var

  return (
    <div className='space-y-3'>
      {job.error && <p className='text-sm text-destructive'>{job.error}</p>}
      {envVar && <p className='font-mono text-2xs text-muted-foreground'>下面的 cURL 重放前，先 export {envVar}=…</p>}
      <Params json={job.params} />
      {job.inputs !== '{}' && <Inputs json={job.inputs} />}
      {calls.map((call) => (
        <CallRow key={call.id} call={call} />
      ))}
      {calls.length === 0 && <NoCalls status={job.status} />}
    </div>
  )
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function asObject(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function Params({ json }: { json: string }) {
  const parsed = asObject(json)
  if (parsed === null) return <CodeBlock label='请求参数' text={prettyJson(json)} />

  const { prompt, ...rest } = parsed
  const line = Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('  ')

  return (
    <div className='min-w-0 space-y-1'>
      {typeof prompt === 'string' && prompt !== '' && <CodeBlock label='提示词' text={prompt} wrap />}
      {line !== '' && (
        <p className='truncate font-mono text-xs text-ink3' title={line}>
          {line}
        </p>
      )}
    </div>
  )
}

interface AssetRef {
  path: string
  bytes?: number
  placeholder?: string
}

function Inputs({ json }: { json: string }) {
  const parsed = asObject(json)
  const refs = Object.values(parsed ?? {})
    .flatMap((value) => (Array.isArray(value) ? (value as unknown[]) : [value]))
    .filter((item): item is AssetRef => typeof item === 'object' && item !== null && 'path' in item)
  if (refs.length === 0) return <CodeBlock label='输入图片' text={prettyJson(json)} />

  return (
    <div className='min-w-0 space-y-0.5'>
      <p className='text-xs text-muted-foreground'>输入图片</p>
      {refs.map((ref) => (
        <p key={ref.placeholder ?? ref.path} className='truncate font-mono text-xs' title={ref.path}>
          {ref.placeholder && <span className='text-ink3'>{ref.placeholder} ← </span>}
          {ref.path.split('/').pop()}
          {ref.bytes !== undefined && <span className='text-ink3'>{`  ${(ref.bytes / 1024 / 1024).toFixed(1)} MB`}</span>}
        </p>
      ))}
    </div>
  )
}

function NoCalls({ status }: { status: JobStatus }) {
  const text = status === 'queued' || status === 'running' ? '尚未发出请求' : status === 'cancelled' ? '已取消，无调用明细' : '调用明细已过保留期'
  return <p className='text-sm text-muted-foreground'>{text}</p>
}

function CallRow({ call }: { call: Call }) {
  return (
    <div className='min-w-0 space-y-1 rounded-md bg-line2/50 p-2'>
      <div className='flex items-center gap-2 text-xs'>
        <Badge variant='outline' className='shrink-0 bg-card'>
          {CALL_SECTION_LABEL[call.section] ?? call.section}
        </Badge>
        <span className='min-w-0 truncate font-mono' title={`${call.method} ${call.url}`}>
          {call.method} {pathOf(call.url)}
        </span>
        <span className={cn('ml-auto shrink-0 font-mono', call.status_code && call.status_code >= 400 ? 'text-destructive' : 'text-muted-foreground')}>{call.status_code ?? call.error ?? '—'}</span>
        <span className='shrink-0 font-mono text-ink3'>{call.duration_ms === null ? '—' : `${(call.duration_ms / 1000).toFixed(1)}s`}</span>
      </div>

      <CodeBlock label='cURL' text={call.curl.command} />
      {call.curl.assets.map((asset) => (
        <CodeBlock key={asset.placeholder} label={asset.placeholder} text={`# ← ${asset.path}\n${asset.fill}`} />
      ))}
      {/* 有占位符即图嵌在 JSON 体里：几 MB 的 base64 过不了 shell，得导出 JSON 再发。 */}
      {call.curl.assets.length > 0 && <SendScript callId={call.id} envVar={call.curl.env_var} />}

      <CodeBlock label='请求头' text={prettyJson(call.request_headers)} collapsed />
      {call.request_body && <CodeBlock label='请求体' text={prettyJson(call.request_body)} collapsed />}
      {call.response_body && <CodeBlock label='响应体' text={prettyJson(call.response_body)} collapsed />}
    </div>
  )
}

function SendScript({ callId, envVar }: { callId: number; envVar: string | null }) {
  const [path, setPath] = useState<string | null>(null)
  const exportJson = useMutation({
    mutationFn: () => api.exportRequestJson(callId),
    onSuccess: (result) => setPath(result.path),
    onError: (error: Error) => toast.error(error.message),
  })

  if (path === null) {
    return (
      <div className='flex items-center gap-2'>
        <p className='text-2xs text-muted-foreground'>请求体含图像数据，上方 cURL 无法直接在终端运行</p>
        <Button variant='outline' size='sm' disabled={exportJson.isPending} onClick={() => exportJson.mutate()}>
          导出请求 JSON
        </Button>
      </div>
    )
  }

  return <CodeBlock text={`${envVar ? `export ${envVar}=…\n` : ''}bun run server/src/tools/send.ts ${path}`} />
}

export function CodeBlock({
  label,
  text,
  collapsed,
  wrap,
}: {
  label?: string
  text: string
  collapsed?: boolean
  /** 命令与 JSON 折了行就复制不回去，只有提示词这类给人读的文本才折行。 */
  wrap?: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  const { body, hidden } = truncate(text)

  return (
    <div className='min-w-0'>
      <div className='flex items-center gap-1'>
        {label !== undefined && (
          <button type='button' onClick={() => setOpen(!open)} className='text-xs text-muted-foreground hover:text-foreground'>
            {collapsed ? `${open ? '▾' : '▸'} ${label}` : label}
          </button>
        )}
        {open && <CopyButton text={text} className='ml-auto' />}
      </div>
      {open && (
        <pre className={cn('min-w-0 rounded-md bg-card p-2 font-mono text-xs leading-5', wrap ? 'whitespace-pre-wrap' : 'overflow-x-auto')}>
          {body}
          {hidden > 0 && <span className='text-stale'>{`\n…已截断 ${hidden} 字符`}</span>}
        </pre>
      )}
    </div>
  )
}
