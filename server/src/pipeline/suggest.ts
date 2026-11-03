/** 向模型要建议值：集数、画风。只回建议与理由，不写库。 */

import { stylePresetOf } from '@vesper/shared'

import { assessVolume } from '../domain/pacing'
import { generateText, type GenContext } from './gen'
import { parseReply, z } from './reply'
import { STYLE_SYSTEM, SUGGEST_SYSTEM, stylePrompt, suggestPrompt } from './prompts'
import { Conflict } from '../domain/errors'
import type { ProjectRow } from '../repo/projects'
import type { SourceRow } from '../repo/sources'

const suggestSchema = z.object({ count: z.number().int().positive(), reason: z.string().default('') })

/** 每集至少这么多字，按它给建议集数封顶。 */
const MIN_CHARS_PER_EPISODE = 400

export interface EpisodeSuggestion {
  readonly count: number
  readonly reason: string
}

export async function suggestEpisodeCount(ctx: GenContext, project: ProjectRow, file: SourceRow): Promise<EpisodeSuggestion> {
  const verdict = assessVolume(file.text, project.speech_rate, project.target_seconds)
  const { text } = await generateText(ctx, {
    owner: { kind: 'project', id: project.id },
    purpose: 'episode_suggest',
    label: '建议集数',
    params: {
      system: SUGGEST_SYSTEM,
      prompt: suggestPrompt({
        source: file.text,
        targetSeconds: project.target_seconds,
        narratedSeconds: verdict.narratedSeconds,
      }),
    },
  })

  const reply = parseReply(text, suggestSchema, '建议集数')
  const ceiling = Math.max(1, Math.floor(verdict.charCount / MIN_CHARS_PER_EPISODE))
  return { count: Math.min(reply.count, ceiling), reason: reply.reason }
}

const styleSchema = z.object({
  picks: z.array(z.object({ label: z.string(), reason: z.string().default('') })).min(1),
})

/** 题材、年代与情绪开篇就能看出，只发前这么多字。 */
const STYLE_SAMPLE_CHARS = 4000

const MAX_STYLE_PICKS = 3

export interface StylePick {
  readonly label: string
  readonly reason: string
}

export async function suggestStyle(ctx: GenContext, project: ProjectRow, file: SourceRow): Promise<StylePick[]> {
  const { text } = await generateText(ctx, {
    owner: { kind: 'project', id: project.id },
    purpose: 'style_suggest',
    label: '建议画风',
    params: { system: STYLE_SYSTEM, prompt: stylePrompt(file.text.slice(0, STYLE_SAMPLE_CHARS)) },
  })

  const reply = parseReply(text, styleSchema, '建议画风')
  // 不在预设表里的名称没有对应的选项，丢掉。
  const picks = reply.picks
    .filter((pick) => stylePresetOf(pick.label) !== undefined)
    .map((pick) => ({ label: pick.label, reason: pick.reason }))
  if (picks.length === 0) throw new Conflict(`模型挑的画风都不在预设里：${reply.picks.map((p) => p.label).join('、')}`)
  return picks.slice(0, MAX_STYLE_PICKS)
}
