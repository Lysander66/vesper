/** 一次生成的提交、轮询、取件与下载，每次往返都记一条 `http_calls`。上下文全从库里读，首跑与重启续跑走同一条路径。 */

import type { CallSection, JobStatus } from '@vesper/shared'

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { imageMimeFromBytes } from '../endpoint/asset'
import { extractAll } from '../endpoint/jsonpath'
import { buildContext, renderRequest, renderSection, selectSubmit, type RenderedInputs, type RenderedRequest } from '../endpoint/render'
import { parseDefinition, type EndpointDefinition } from '../endpoint/types'
import { loadJobContext, recordCall, updateJob } from '../db/records'
import {
  DEFAULT_POLL_POLICY,
  DOWNLOAD_TIMEOUT_MS,
  SUBMIT_TIMEOUT_MS,
  delayFor,
  isTransient,
  systemClock,
  type Clock,
  type PollPolicy,
} from './policy'
import { isBinaryBody, isOk, sendRequest, summarizeBody, type HttpOutcome } from './send'

import type { Database } from 'bun:sqlite'

/** 产物地址的候选字段名，端点定义的 `extract` 取其一。 */
const ARTIFACT_URL_FIELDS = ['output_url', 'video_url', 'image_url', 'audio_url', 'url'] as const
/** 响应里直接给 base64 产物的字段名。 */
const ARTIFACT_B64_FIELDS = ['output_b64', 'image_b64', 'b64_json'] as const
export const TEXT_FIELDS = ['text', 'content', 'output_text'] as const
const ERROR_FIELDS = ['error', 'message', 'status_msg'] as const

export interface RunnerEvent {
  readonly jobId: string
  readonly phase: CallSection | 'finished'
  readonly seq?: number | undefined
  readonly status?: JobStatus | undefined
  /** 供应商返回的原始状态串，`status_map` 映射前。 */
  readonly providerStatus?: string | undefined
  readonly message?: string | undefined
}

export interface RunnerOptions {
  readonly artifactDir: string
  readonly policy?: PollPolicy | undefined
  readonly clock?: Clock | undefined
  readonly random?: (() => number) | undefined
  readonly signal?: AbortSignal | undefined
  readonly onEvent?: ((event: RunnerEvent) => void) | undefined
}

export interface JobOutcome {
  readonly status: 'succeeded' | 'failed' | 'cancelled'
  readonly artifacts: string[]
  /** 按 extract 路径取出的值，文本端点的产物在这里。 */
  readonly extracted: Record<string, unknown>
  readonly providerTaskId?: string | undefined
  readonly error?: string | undefined
}

export async function executeJob(db: Database, jobId: string, options: RunnerOptions): Promise<JobOutcome> {
  const context = loadJobContext(db, jobId)
  if (!context) throw new Error(`job 不存在或缺少端点/凭证：${jobId}`)

  const { job, endpoint, credential } = context
  const definition = parseDefinition(JSON.parse(endpoint.definition))
  const policy = options.policy ?? DEFAULT_POLL_POLICY
  const clock = options.clock ?? systemClock
  const random = options.random ?? Math.random
  const signal = options.signal
  const secrets = [credential.api_key]
  const emit = (event: RunnerEvent) => options.onEvent?.(event)

  const finish = (status: 'failed' | 'cancelled', error: string): JobOutcome => {
    updateJob(db, jobId, { status, error }, secrets)
    emit({ jobId, phase: 'finished', status, message: error })
    return { status, artifacts: [], extracted: {}, error }
  }

  const ctx = buildContext(
    {
      ...(JSON.parse(job.params) as Record<string, unknown>),
      api_key: credential.api_key,
      base_url: credential.base_url,
    },
    stampInputs(JSON.parse(job.inputs) as RenderedInputs, definition),
    definition.defaults,
  )

  /** 记录里的素材是引用，发出去的是展开后的副本。 */
  const roundTrip = async (section: CallSection, request: RenderedRequest, opts: { timeoutMs: number; binary?: boolean | undefined }): Promise<HttpOutcome> => {
    const outcome = await sendRequest(request, { timeoutMs: opts.timeoutMs, signal, binary: opts.binary })
    const seq = recordCall(
      db,
      jobId,
      {
        section,
        request,
        startedAt: outcome.startedAt,
        durationMs: outcome.durationMs,
        statusCode: outcome.statusCode,
        responseHeaders: outcome.responseHeaders,
        responseBody: summarizeBody(outcome.responseBody),
        error: outcome.error,
      },
      secrets,
    )
    emit({ jobId, phase: section, seq })
    return outcome
  }

  try {
    let extracted: Record<string, unknown> = {}
    let taskId = job.provider_task_id ?? undefined

    // 已有 provider_task_id 说明是重启续跑，不重发提交。
    if (!taskId) {
      updateJob(db, jobId, { status: 'running' })
      const submit = selectSubmit(definition, ctx)
      const request = renderRequest(submit, ctx, { enumMaps: definition.enum_maps, auth: definition.auth })

      const binaryOut = submit.response === 'binary'
      const outcome = await roundTrip('submit', request, {
        timeoutMs: binaryOut ? DOWNLOAD_TIMEOUT_MS : SUBMIT_TIMEOUT_MS,
        binary: binaryOut,
      })
      if (!isOk(outcome)) {
        return finish('failed', describeFailure('提交', outcome, submit.extract))
      }

      // 响应体即产物，落盘即完成。
      if (binaryOut) {
        if (!isBinaryBody(outcome.responseBody)) return finish('failed', '端点声明了 binary 响应，但没读到字节')
        await mkdir(options.artifactDir, { recursive: true })
        const path = join(
          options.artifactDir,
          `${jobId}_0${extensionFor(outcome.responseBody.contentType, request.url)}`,
        )
        await Bun.write(path, outcome.responseBody.data)
        const produced = { bytes: outcome.responseBody.bytes, content_type: outcome.responseBody.contentType }
        updateJob(db, jobId, { status: 'succeeded', artifactPath: path, artifacts: [path], extracted: produced }, secrets)
        emit({ jobId, phase: 'finished', status: 'succeeded' })
        return { status: 'succeeded', artifacts: [path], extracted: produced }
      }

      extracted = extractAll(outcome.responseBody, submit.extract)
      taskId = asString(extracted.task_id)
      if (definition.poll && !taskId) {
        return finish('failed', `提交返回 ${outcome.statusCode} 但取不到 task_id：${errorText(extracted) ?? '响应结构与定义的 extract 路径对不上'}`)
      }
      if (taskId) updateJob(db, jobId, { providerTaskId: taskId })
    }

    // 没有 poll 节即同步端点，提交响应里就有产物。
    if (definition.poll) {
      ctx.task_id = taskId
      const deadline = clock.now() + policy.overallTimeoutMs
      let attempt = 0
      let consecutiveTransient = 0

      for (;;) {
        if (clock.now() >= deadline) {
          return finish('failed', `轮询超时：${Math.round(policy.overallTimeoutMs / 1000)}s 内任务未结束（task ${taskId}）`)
        }
        await clock.sleep(delayFor(attempt, policy, random), signal)
        attempt += 1

        const request = renderSection(definition, 'poll', ctx)
        if (!request) throw new Error('端点定义缺少 poll 节')
        const outcome = await roundTrip('poll', request, { timeoutMs: policy.requestTimeoutMs })

        if (!isOk(outcome)) {
          consecutiveTransient += 1
          if (isTransient(outcome) && consecutiveTransient <= policy.maxTransientFailures) continue
          return finish('failed', describeFailure('轮询', outcome, definition.poll.extract))
        }
        consecutiveTransient = 0

        const got = extractAll(outcome.responseBody, definition.poll.extract)
        const raw = asString(got.status)
        // 没回状态就继续等；状态映射不上直接报错，不当作仍在运行。
        if (raw === undefined) continue
        emit({ jobId, phase: 'poll', providerStatus: raw })

        const mapped = definition.status_map?.[raw]
        if (!mapped) {
          return finish('failed', `status_map 未覆盖供应商返回的状态 "${raw}"，请补进端点定义`)
        }
        if (mapped === 'failed') {
          return finish('failed', errorText(got) ?? `供应商判定任务失败（状态 "${raw}"）`)
        }
        if (mapped === 'succeeded') {
          extracted = { ...extracted, ...got }
          break
        }
      }
    }

    if (definition.result) {
      ctx.result_id = asString(extracted.result_id) ?? taskId
      const request = renderSection(definition, 'result', ctx)
      if (!request) throw new Error('端点定义缺少 result 节')
      const outcome = await roundTrip('result', request, { timeoutMs: policy.requestTimeoutMs })
      if (!isOk(outcome)) {
        return finish('failed', describeFailure('取件', outcome, definition.result.extract))
      }
      extracted = { ...extracted, ...extractAll(outcome.responseBody, definition.result.extract) }
    }

    // 产物落到本地才算完成：供应商的临时地址通常几小时就失效。
    const urls = collectStrings(extracted, ARTIFACT_URL_FIELDS)
    const inlines = collectStrings(extracted, ARTIFACT_B64_FIELDS)
    if (urls.length === 0 && inlines.length === 0) {
      // 文本端点取到文本即完成。
      if (collectStrings(extracted, TEXT_FIELDS).length > 0) {
        updateJob(db, jobId, { status: 'succeeded', extracted }, secrets)
        emit({ jobId, phase: 'finished', status: 'succeeded' })
        return { status: 'succeeded', artifacts: [], extracted, providerTaskId: taskId }
      }
      // 有的家业务失败也回 200，原因在错误字段里。
      const reason = errorText(extracted)
      return finish(
        'failed',
        reason === undefined
          ? `任务已成功但取不到产物（试过 ${[...ARTIFACT_URL_FIELDS, ...ARTIFACT_B64_FIELDS, ...TEXT_FIELDS].join(' / ')}）`
          : `任务已成功但取不到产物：${reason}`,
      )
    }

    await mkdir(options.artifactDir, { recursive: true })
    const artifacts: string[] = []

    for (const [index, url] of urls.entries()) {
      const request: RenderedRequest = { method: 'GET', url, headers: {}, body: null }
      const outcome = await roundTrip('download', request, { timeoutMs: DOWNLOAD_TIMEOUT_MS, binary: true })
      if (!isOk(outcome) || !isBinaryBody(outcome.responseBody)) {
        return finish('failed', `下载产物失败：${outcome.error ?? '响应不是二进制'}`)
      }
      const path = join(options.artifactDir, `${jobId}_${index}${extensionFor(outcome.responseBody.contentType, url)}`)
      await Bun.write(path, outcome.responseBody.data)
      artifacts.push(path)
    }

    for (const [offset, b64] of inlines.entries()) {
      const bytes = Buffer.from(stripDataUri(b64), 'base64')
      const path = join(options.artifactDir, `${jobId}_${urls.length + offset}${extensionFor(imageMimeFromBytes(bytes), '')}`)
      await Bun.write(path, bytes)
      artifacts.push(path)
    }

    updateJob(db, jobId, { status: 'succeeded', artifactPath: artifacts[0], artifacts, extracted }, secrets)
    emit({ jobId, phase: 'finished', status: 'succeeded' })
    return { status: 'succeeded', artifacts, extracted, providerTaskId: taskId }
  } catch (cause) {
    if (signal?.aborted) return finish('cancelled', '已取消')
    const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
    return finish('failed', message)
  }
}

/** 按端点定义的 inputs 设定素材的字段名、编码与占位名。 */
export function stampInputs(inputs: RenderedInputs, definition: EndpointDefinition): RenderedInputs {
  const bySource = new Map<string, string>()
  for (const [name, declaration] of Object.entries(definition.inputs)) bySource.set(declaration.source, name)

  const stamped: RenderedInputs = {}
  for (const [key, value] of Object.entries(inputs)) {
    // 先认输入名，再按来源名映射；都不认就原样保留。
    const name = definition.inputs[key] ? key : (bySource.get(key) ?? key)
    const declaration = definition.inputs[name]
    if (!declaration || value === undefined) {
      stamped[name] = value
      continue
    }
    const label = name.toUpperCase()
    stamped[name] = Array.isArray(value)
      ? value.map((ref, i) => ({ ...ref, encoding: declaration.encoding, placeholder: `${label}_${i + 1}` }))
      : { ...value, encoding: declaration.encoding, placeholder: label }
  }
  return stamped
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function errorText(extracted: Record<string, unknown>): string | undefined {
  for (const field of ERROR_FIELDS) {
    const value = asString(extracted[field])
    if (value !== undefined) return value
  }
  return undefined
}

/** 失败信息带上供应商返回的错误原文。 */
function describeFailure(phase: string, outcome: HttpOutcome, declaration: Record<string, string[]> | undefined): string {
  const detail = errorText(extractAll(outcome.responseBody, declaration))
  return detail ? `${phase}失败：${outcome.error ?? ''} — ${detail}`.trim() : `${phase}失败：${outcome.error ?? '未知错误'}`
}

function collectStrings(extracted: Record<string, unknown>, fields: readonly string[]): string[] {
  for (const field of fields) {
    const value = extracted[field]
    if (typeof value === 'string' && value !== '') return [value]
    if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === 'string' && v !== '')
      if (items.length > 0) return items
    }
  }
  return []
}

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
}

/** 先看 Content-Type，其次看 URL 路径，都认不出给 `.bin`。 */
function extensionFor(contentType: string | null, url: string): string {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  if (mime && CONTENT_TYPE_EXTENSION[mime]) return CONTENT_TYPE_EXTENSION[mime]
  const path = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  const dot = path.lastIndexOf('.')
  if (dot > 0 && dot > path.lastIndexOf('/')) {
    const ext = path.slice(dot).toLowerCase()
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext
  }
  return '.bin'
}

function stripDataUri(value: string): string {
  const comma = value.indexOf('base64,')
  return comma === -1 ? value : value.slice(comma + 'base64,'.length)
}
