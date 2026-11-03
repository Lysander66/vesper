import { Link } from '@tanstack/react-router'
import { type HomePulse, type HomeView } from '@vesper/shared'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export function PulseStrip({ home }: { home: HomeView }) {
  return (
    <section className='mb-13 grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[1fr_452px]'>
      <div className='grid grid-rows-[auto_1fr] border-b lg:border-r lg:border-b-0'>
        <div className='flex border-b'>
          <Cell label='今日调用' value={home.today.jobs} unit='次' />
          <Cell label='其中失败' value={home.today.failed} unit='次' bad={home.today.failed > 0} />
          <Cell label='HTTP 请求' value={home.today.calls} unit='次' />
          <Cell label='累计调用' value={home.total_jobs} unit='次' />
        </div>
        <Graph pulse={home.pulse} />
      </div>
      <CurlSample />
    </section>
  )
}

function Cell({ label, value, unit, bad }: { label: string; value: number; unit: string; bad?: boolean }) {
  return (
    <div className='flex flex-col gap-0.5 px-4 py-3.5'>
      <span className='font-mono text-2xs tracking-[.12em] text-ink3 uppercase'>{label}</span>
      <b className={cn('text-lg font-semibold tracking-tight', bad && 'text-fail')}>
        {value}
        <small className='ml-0.5 text-xs font-normal text-ink3'>{unit}</small>
      </b>
    </div>
  )
}

function Graph({ pulse }: { pulse: readonly HomePulse[] }) {
  if (pulse.length === 0) {
    return <div className='grid min-h-24 place-items-center px-5 py-4 text-xs text-ink3'>今日暂无调用</div>
  }
  const longest = Math.max(...pulse.map((job) => job.seconds), 1)

  return (
    <div className='relative flex min-h-24 items-end gap-0.5 px-5 pt-4.5 pb-5'>
      <div className='absolute inset-x-5 bottom-4.5 h-px bg-line2' />
      {pulse.map((job) => {
        const failed = job.status === 'failed'
        return (
          <div
            key={job.id}
            title={`${job.label ?? job.purpose ?? job.id} · ${job.seconds}s · ${job.calls} 次 HTTP 请求`}
            style={failed ? undefined : { height: `${Math.max(3, (job.seconds / longest) * 62)}px` }}
            className={cn(
              'max-w-[9px] min-w-[2px] flex-1 rounded-t-[1.5px]',
              failed ? 'self-stretch rounded-[1.5px] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--fail)_15%,transparent)_0_calc(100%-13px),var(--fail)_calc(100%-13px))]' : 'bg-border'
            )}
          />
        )
      })}
    </div>
  )
}

/** 示例 key 写明文无妨；真实导出的 cURL 里只能是 `$VESPER_API_KEY`。 */
const SAMPLE = `curl -X POST 'https://api.openai.com/v1/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer sk-xxx' \\
  --data-raw '{
  "model": "gpt-5.6-sol",
  "instructions": "你是美术指导，从原文中挑出需要固定形象、会在多个镜头里反复出现的人物…",
  "input": "天宝元年秋，李白奉诏入京…",
  …`

function CurlSample() {
  return (
    <div className='flex flex-col bg-line2'>
      <div className='flex items-center gap-1.5 border-b border-border px-3.5 py-2.5'>
        <i className='h-2.5 w-2.5 rounded-full bg-fail/60' />
        <i className='h-2.5 w-2.5 rounded-full bg-warn/60' />
        <i className='h-2.5 w-2.5 rounded-full bg-ok/60' />
        <Badge variant='outline' className='ml-auto px-1.5 font-mono text-2xs font-normal text-ink3'>
          示例
        </Badge>
      </div>

      <div className='relative max-h-52 flex-1 overflow-hidden'>
        <pre className='px-3.5 pt-3.5 pb-3 font-mono text-2xs leading-[1.85] break-all whitespace-pre-wrap text-muted-foreground'>
          <span className='text-ink3'>$ </span>
          {SAMPLE}
        </pre>
        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-line2' />
      </div>

      <div className='flex h-10 items-center border-t px-4 text-xs text-ink3'>
        每一次调用，都看得见
        <Link to='/records' className='ml-auto hover:text-foreground'>
          调用记录 →
        </Link>
      </div>
    </div>
  )
}
