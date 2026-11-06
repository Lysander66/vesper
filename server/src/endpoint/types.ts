/** 端点定义：纯数据的请求模板，能静态渲染成确定的请求。 */

import { z } from 'zod'

/** 素材来源名。流水线按这几个名字传，端点定义映射成各供应商的字段名。 */
export const ASSET_SOURCES = ['start_image', 'reference_images', 'reference_audio_files'] as const
export type AssetSource = (typeof ASSET_SOURCES)[number]

const inputDeclaration = z.object({
  source: z.enum(ASSET_SOURCES),
  /** `data_uri` 带前缀，`base64` 是裸串，`file` 走 multipart 文件部分。 */
  encoding: z.enum(['data_uri', 'base64', 'file']),
})

const templateValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(templateValue),
    z.record(z.string(), templateValue),
  ]),
)

const section = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: templateValue.optional(),
  /** `multipart` 下顶层键是表单字段，素材是文件部分。 */
  request: z.enum(['json', 'multipart']).optional(),
  /** 字段名 → 候选 JSONPath，取第一个非空。 */
  extract: z.record(z.string(), z.array(z.string())).optional(),
  /** `binary` 表示响应体本身就是产物。由定义声明，不按 Content-Type 猜。 */
  response: z.enum(['json', 'binary']).optional(),
})

/** 端点级与 by_model 级共用这一组字段。 */
const capabilityFields = z.object({
  start_image: z.literal('yes').optional(),
  max_reference_images: z.number().int().nonnegative().optional(),
  /** 参考图模式下能带几段音色样本。缺省不带。 */
  max_reference_audios: z.number().int().nonnegative().optional(),
  max_prompt_chars: z.number().int().positive().optional(),
  /** 固定几档写成数组，连续区间写成两端。 */
  durations: z.union([z.array(z.number()), z.object({ min: z.number(), max: z.number() })]).optional(),
  resolutions: z.array(z.string()).optional(),
  aspect_ratios: z.array(z.string()).optional(),
  /** 视频自带声音，缺省不出声。合成时据此决定用哪一轨。 */
  audio: z.enum(['native']).optional(),
  /** 视频提示词按 MiniMax H3 官方写法拼，缺省用通用写法。 */
  prompt_style: z.enum(['h3']).optional(),
})

export const endpointDefinitionSchema = z
  .object({
    kind: z.literal('declarative'),
    schema_version: z.string(),
    /** 绑定端点时按它过滤可选项。 */
    modality: z.enum(['image', 'video', 'text', 'audio']),
    meta: z
      .object({
        title: z.string().optional(),
        /** 这份定义依据的文档。 */
        docs: z.string().optional(),
        notes: z.string().optional(),
        /** 同类端点中首选这条，设置页排在最前并预选。每个 modality 至多一条。 */
        preferred: z.literal('yes').optional(),
        /** 上一代接口，设置页排在最后。 */
        legacy: z.literal('yes').optional(),
        hints: z.object({ base_url: z.string().optional() }).partial().optional(),
      })
      .optional(),
    /** `{{ api_key }}` 只允许出现在这里。 */
    auth: z
      .object({
        headers: z.record(z.string(), z.string()).optional(),
        query: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    inputs: z.record(z.string(), inputDeclaration).default({}),
    /** 内部写法 → 供应商写法，如 `{"resolution": {"768p": "768P"}}`。 */
    enum_maps: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    defaults: z.record(z.string(), templateValue).optional(),
    submit: section,
    /** 条件满足时整节代替 `submit`：有些供应商带图与不带图是两个接口。 */
    submit_alt: section.extend({ when: z.string().min(1) }).optional(),
    /** 缺省即同步端点：submit 的响应里就有产物地址，不轮询。 */
    poll: section.optional(),
    /** 轮询只给 id 时，再取一次产物地址。 */
    result: section.optional(),
    status_map: z.record(z.string(), z.enum(['queued', 'running', 'succeeded', 'failed'])).optional(),
    capabilities: capabilityFields
      .extend({
        /** 验证过的模型，参数面板里的候选项，不限制填别的。 */
        models: z.array(z.string()).optional(),
        /** 随模型变的档位，键是模型名。端点级写默认模型的档位。 */
        by_model: z.record(z.string(), capabilityFields).optional(),
      })
      .optional(),
  })
  .superRefine((def, ctx) => {
    // 两条提交路径的后续流程相同，是否轮询、是否 binary 必须一致。
    if (def.submit_alt && def.submit_alt.response !== def.submit.response) {
      ctx.addIssue({
        code: 'custom',
        path: ['submit_alt', 'response'],
        message: 'submit_alt 与 submit 的 response 形态必须一致，否则同一端点会有两套完成判定',
      })
    }
    if (def.poll && def.submit_alt && !def.submit_alt.extract?.task_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['submit_alt', 'extract', 'task_id'],
        message: '声明了 poll 节就必须能从 submit_alt 响应里取出 task_id，否则走这条路时无从轮询',
      })
    }
    for (const [name, sec] of [['submit', def.submit], ['submit_alt', def.submit_alt]] as const) {
      if (sec?.request !== 'multipart') continue
      if (sec.body === null || typeof sec.body !== 'object' || Array.isArray(sec.body)) {
        ctx.addIssue({
          code: 'custom',
          path: [name, 'body'],
          message: 'multipart 的请求体必须是一层键值对——每个顶层键就是一个表单字段',
        })
      }
    }
    // 模型名写错时覆盖不会生效，在这里报错。
    for (const model of Object.keys(def.capabilities?.by_model ?? {})) {
      if (def.capabilities?.models?.includes(model)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities', 'by_model', model],
        message: `by_model 的 ${model} 不在 capabilities.models 里，界面选不到它，这份覆盖永远用不上`,
      })
    }
    const fileInputs = Object.entries(def.inputs).filter(([, decl]) => decl.encoding === 'file')
    if (fileInputs.length > 0 && def.submit.request !== 'multipart' && def.submit_alt?.request !== 'multipart') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', fileInputs[0]![0], 'encoding'],
        message: 'file 编码的素材只能作为 multipart 的文件部分发送，但没有任何提交节声明 request: "multipart"',
      })
    }
    if (def.poll && !def.submit.extract?.task_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['submit', 'extract', 'task_id'],
        message: '声明了 poll 节就必须能从 submit 响应里取出 task_id，否则无从轮询',
      })
    }
    if (def.poll && !def.status_map) {
      ctx.addIssue({
        code: 'custom',
        path: ['status_map'],
        message: '声明了 poll 节就必须给 status_map，否则无法判断任务是否结束',
      })
    }
    if (def.submit.response === 'binary' && def.poll) {
      ctx.addIssue({
        code: 'custom',
        path: ['submit', 'response'],
        message: 'submit 直接回二进制就意味着同步返回结果，不该再声明 poll',
      })
    }
  })

export type EndpointDefinition = z.infer<typeof endpointDefinitionSchema>
export type EndpointSection = z.infer<typeof section>
export type InputDeclaration = z.infer<typeof inputDeclaration>
export type SectionName = 'submit' | 'poll' | 'result'

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DefinitionError'
  }
}

export function parseDefinition(raw: unknown): EndpointDefinition {
  const result = endpointDefinitionSchema.safeParse(raw)
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')
    throw new DefinitionError(`端点定义不合法：${detail}`)
  }
  return result.data
}
