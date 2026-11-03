/** 各组路由共用的入参解析：发起时的临时参数，以及路径里的产物位。 */

import { optionalBody, z, BadRequest } from '../http'
import type { LaunchInput } from '../tasks'
import {
  ARTIFACT_KIND_LABEL,
  ARTIFACT_KINDS,
  AUDIO_MODES,
  BINDING_ROLES,
  CONTINUITY_MODES,
  SHOT_ARTIFACT_KINDS,
  type ArtifactKind,
  type AudioMode,
  type ContinuityMode,
} from '@vesper/shared'
import { PROMPT_IDS } from '../../pipeline/prompts'

/** 按角色分的端点参数，值不校验形状。用 `partialRecord`：zod 4 的 `record` 要求枚举每个键都出现。 */
const OVERRIDES_SCHEMA = z
  .partialRecord(z.enum(BINDING_ROLES), z.record(z.string(), z.unknown()))
  .optional()

/** 按模板 id 分的提示词参数：{ assets: { must_include: '金方、太白' } }。值一律字符串，怎么解释由模板定。 */
const PROMPT_ARGS_SCHEMA = z
  .partialRecord(z.enum(PROMPT_IDS), z.record(z.string(), z.string()))
  .optional()

/** 按 purpose 分：一次发起可能画五张设定图，按 role 分会互相覆盖。 */
const PROMPT_TEXT_SCHEMA = z.record(z.string(), z.string()).optional()

/** 各发起接口共有的临时参数。 */
export const EXTRA_SCHEMA = {
  params: OVERRIDES_SCHEMA,
  prompt_args: PROMPT_ARGS_SCHEMA,
  prompt_text: PROMPT_TEXT_SCHEMA,
}

/** 试音只调一次 TTS，没有模板参数。 */
export const VOICE_SAMPLE_SCHEMA = z.object({ line: z.string().min(1), count: z.number().int().min(1).max(5).default(3), params: OVERRIDES_SCHEMA })

const PRODUCE_SCHEMA = z.object({
  kinds: z.array(z.string()).optional(),
  // 两项缺省都按作品设置。
  audio_mode: z.enum(AUDIO_MODES).optional(),
  continuity_mode: z.enum(CONTINUITY_MODES).optional(),
  ...EXTRA_SCHEMA,
})

export interface LaunchExtra {
  readonly overrides: LaunchInput['overrides']
  readonly promptArgs: LaunchInput['promptArgs']
  readonly promptText: LaunchInput['promptText']
}

interface ProduceInput extends LaunchExtra {
  readonly kinds: ArtifactKind[]
  readonly audio: AudioMode | undefined
  readonly continuity: ContinuityMode | undefined
}

export async function produceInput(request: Request): Promise<ProduceInput> {
  const input = await optionalBody(request, PRODUCE_SCHEMA)
  return {
    kinds: pickKinds(input.kinds),
    audio: input.audio_mode,
    continuity: input.continuity_mode,
    ...extraOf(input),
  }
}

/** 只带临时参数的发起接口（规划、提取、节拍、分镜）共用。 */
export async function launchExtra(request: Request): Promise<LaunchExtra> {
  return extraOf(await optionalBody(request, z.object(EXTRA_SCHEMA)))
}

export function extraOf(input: {
  params?: LaunchInput['overrides']
  prompt_args?: LaunchInput['promptArgs']
  prompt_text?: LaunchInput['promptText']
}): LaunchExtra {
  return { overrides: input.params, promptArgs: input.prompt_args, promptText: input.prompt_text }
}

const hintOf = (kinds: readonly ArtifactKind[]) => `只能指定${kinds.map((k) => ARTIFACT_KIND_LABEL[k]).join(' / ')}`

export function artifactKind(value: string | undefined): ArtifactKind {
  const kind = ARTIFACT_KINDS.find((k) => k === value)
  if (!kind) throw new BadRequest(hintOf(ARTIFACT_KINDS))
  return kind
}

function pickKinds(kinds: string[] | undefined): ArtifactKind[] {
  if (!kinds || kinds.length === 0) return [...SHOT_ARTIFACT_KINDS]
  const valid = SHOT_ARTIFACT_KINDS.filter((k) => kinds.includes(k))
  if (valid.length === 0) throw new BadRequest(hintOf(SHOT_ARTIFACT_KINDS))
  return valid
}
