/** 各阶段发起生成的统一入口，保证 `owner_*` 与 `purpose` 填法一致，调用记录按这两列过滤。 */

import type { Database } from 'bun:sqlite'

import { capabilitiesFor, type Aspect, type AudioMode, type BindingRole, type EndpointCapabilities } from '@vesper/shared'

import { createJob, type OwnerRef } from '../db/records'
import type { RenderedInputs } from '../endpoint/render'
import { TEXT_FIELDS, executeJob, type JobOutcome } from '../runner/execute'
import { getEndpoint } from '../repo/catalog'
import { findProject } from '../repo/projects'
import { resolveBinding } from '../service/catalog'
import { appendEvent } from '../repo/runs'
import { isAspect, pickAspectRatio, pickSize } from '../domain/aspect'
import { resolveAudioMode } from '../domain/audio'
import { Conflict } from '../domain/errors'
import type { PromptArgs, PromptId } from './prompts'
import type { EndpointDefinition } from '../endpoint/types'

export interface GenContext {
  readonly db: Database
  readonly projectId: string
  readonly runId: string
  readonly artifactDir: string
  readonly signal?: AbortSignal | undefined
  /** 本次临时改的端点参数，不写回绑定。 */
  readonly overrides?: Partial<Record<BindingRole, Record<string, unknown>>> | undefined
  /** 本次的模板参数，按模板 id 分开：一次生成会用到几个模板。 */
  readonly promptArgs?: Partial<Record<PromptId, Record<string, string>>> | undefined
  /** 人在预览里改写的提示词，按 purpose 分，只用于本次。 */
  readonly promptText?: Record<string, string> | undefined
}

export function argsFor(ctx: GenContext, id: PromptId): PromptArgs {
  return ctx.promptArgs?.[id] ?? {}
}

export interface GenRequest {
  readonly owner: OwnerRef
  readonly purpose: string
  readonly role: BindingRole
  readonly params: Record<string, unknown>
  readonly inputs?: RenderedInputs | undefined
  /** 写进任务事件流的说明。 */
  readonly label: string
  /** 覆盖作品画幅，只给设定图用。 */
  readonly aspect?: Aspect | undefined
}

export interface GenResult {
  readonly jobId: string
  readonly outcome: JobOutcome
  readonly definition: EndpointDefinition
}

export class GenFailure extends Error {
  readonly jobId: string

  constructor(message: string, jobId: string) {
    super(message)
    this.name = 'GenFailure'
    this.jobId = jobId
  }
}

export async function generate(ctx: GenContext, request: GenRequest): Promise<GenResult> {
  const binding = resolveBinding(ctx.db, ctx.projectId, request.role)
  const endpoint = getEndpoint(ctx.db, binding.endpointId)
  const overrides = ctx.overrides?.[request.role]
  // 画幅对应的档位随模型变，先定模型。
  const model = modelOf(endpoint.definition, binding.params, overrides)

  // 后者覆盖前者：绑定、画幅、调用方参数、改写的提示词、本次临时参数。
  const written = ctx.promptText?.[request.purpose]
  const jobId = createJob(ctx.db, {
    owner: request.owner,
    purpose: request.purpose,
    endpointId: binding.endpointId,
    credentialId: binding.credentialId,
    params: {
      ...binding.params,
      ...aspectParams(ctx, endpoint.definition, request.aspect, model),
      ...request.params,
      ...(written === undefined ? {} : { prompt: written }),
      ...(overrides ?? {}),
    },
    inputs: request.inputs ?? {},
  })

  appendEvent(ctx.db, ctx.runId, { type: 'job_started', job_id: jobId, purpose: request.purpose, label: request.label })

  const outcome = await executeJob(ctx.db, jobId, {
    artifactDir: ctx.artifactDir,
    signal: ctx.signal,
    onEvent: (event) => {
      appendEvent(ctx.db, ctx.runId, {
        type: 'job_progress',
        job_id: jobId,
        phase: event.phase,
        seq: event.seq,
        status: event.status,
        provider_status: event.providerStatus,
        message: event.message,
      })
    },
  })

  if (outcome.status !== 'succeeded') {
    const reason = outcome.error ?? '未知原因'
    // 审核拒绝原样重试仍会被拒，提示可行的改法。
    const hint = isModerationRejection(reason) ? `（${endpoint.name} 的内容审核拒绝。原样重试多半还是拒，可改写提示词、换绑一个图像或视频接口，或改用参考图模式）` : ''
    throw new GenFailure(`${request.label}失败：${reason}${hint}`, jobId)
  }
  return { jobId, outcome, definition: endpoint.definition }
}

/** 把画幅换成端点声明过的参数值，没声明就不填。 */
function aspectParams(ctx: GenContext, definition: EndpointDefinition, override: Aspect | undefined, model: unknown): Record<string, unknown> {
  if (definition.modality !== 'image' && definition.modality !== 'video') return {}

  const stored = findProject(ctx.db, ctx.projectId)?.aspect
  const aspect = override ?? (isAspect(stored) ? stored : '16:9')
  const capabilities = capabilitiesFor(definition.capabilities, model)

  // 两项各按各的声明填：有的端点两项都接受。
  const size = pickSize(capabilities.resolutions ?? [], aspect)
  const ratio = pickAspectRatio(capabilities.aspect_ratios, aspect)
  return { ...(size !== null && { size }), ...(ratio !== null && { aspect_ratio: ratio }) }
}

export async function generateText(ctx: GenContext, request: Omit<GenRequest, 'role'>): Promise<{ jobId: string; text: string }> {
  const result = await generate(ctx, { ...request, role: 'text' })
  const text = firstString(result.outcome.extracted, TEXT_FIELDS)
  if (text === undefined) throw new GenFailure(`${request.label}没有返回文本`, result.jobId)
  return { jobId: result.jobId, text }
}

function firstString(extracted: Record<string, unknown>, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = extracted[field]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/** 作品的画风。全局资产没有作品，取发起这次任务的作品。 */
export function projectStyle(ctx: GenContext, projectId?: string | null): string {
  return findProject(ctx.db, projectId ?? ctx.projectId)?.style ?? ''
}

/** 档位随模型变，取档位用 roleCapabilities。 */
export function roleDefinition(ctx: GenContext, role: BindingRole): EndpointDefinition {
  return getEndpoint(ctx.db, resolveBinding(ctx.db, ctx.projectId, role).endpointId).definition
}

/** 实际生效的声音来源：视频端点不出声时按单独配音。进度、合成与发起默认值都按它算。 */
export function effectiveAudioMode(db: Database, projectId: string, wanted: AudioMode): AudioMode {
  try {
    return resolveAudioMode(wanted, endpointCapabilities(db, projectId, 'video').audio === 'native')
  } catch (error) {
    // 还没配置视频端点时按作品设置显示。
    if (error instanceof Conflict) return wanted
    throw error
  }
}

/** 时长档位、参考图上限随模型变，按本次实际用的模型取。 */
export function roleCapabilities(ctx: GenContext, role: BindingRole): EndpointCapabilities {
  return endpointCapabilities(ctx.db, ctx.projectId, role, ctx.overrides?.[role])
}

/** 预览与实际发送共用，两边取到的档位才一致。 */
export function endpointCapabilities(db: Database, projectId: string, role: BindingRole, override?: Record<string, unknown> | undefined): EndpointCapabilities {
  const binding = resolveBinding(db, projectId, role)
  const definition = getEndpoint(db, binding.endpointId).definition
  return capabilitiesFor(definition.capabilities, modelOf(definition, binding.params, override))
}

/** 优先级：本次临时参数、绑定参数、端点默认值，与 generate 合并参数的顺序一致。 */
function modelOf(definition: EndpointDefinition, params: Record<string, unknown>, override: Record<string, unknown> | undefined): unknown {
  return override?.model ?? params.model ?? definition.defaults?.model
}

/** 取不小于分镜声明时长的最短一档，区间则夹在两端之间；没有够长的档就取最长一档。 */
export function snapDuration(capabilities: EndpointCapabilities, seconds: number): number | undefined {
  const options = capabilities.durations
  if (!options) return undefined
  if ('min' in options) return Math.min(Math.max(Math.ceil(seconds), options.min), options.max)
  if (options.length === 0) return undefined
  const sorted = [...options].sort((a, b) => a - b)
  return sorted.find((d) => d >= seconds) ?? sorted[sorted.length - 1]
}

/** 端点单次能生成的最长秒数，不接受时长时为 undefined。 */
export function maxDuration(capabilities: EndpointCapabilities): number | undefined {
  const options = capabilities.durations
  if (!options) return undefined
  if ('min' in options) return options.max
  return options.length === 0 ? undefined : Math.max(...options)
}

/** 各供应商的审核拒绝没有统一错误码，按原话里的字眼识别；漏认只是少一句提示。 */
const MODERATION_WORDS = ['safety system', 'content policy', 'moderation', 'sensitive', '敏感', '审核', '违规']

export function isModerationRejection(reason: string): boolean {
  const text = reason.toLowerCase()
  return MODERATION_WORDS.some((word) => text.includes(word))
}
