/** 模型只给每集收尾的那一句，下标由代码定位；定位不上带原因重问，重问用尽就报错。 */

import { episodeCountOf } from '@vesper/shared'

import { locateAnchors } from '../domain/anchor'
import { titleOf } from '../domain/import'
import { argsFor, generateText, type GenContext } from './gen'
import { parseReply, z } from './reply'
import { EPISODE_SYSTEM, episodePrompt } from './prompts'
import { Conflict } from '../domain/errors'
import { appendEvent } from '../repo/runs'
import type { EpisodeDraft, ProjectRow } from '../repo/projects'
import type { SourceRow } from '../repo/sources'

const episodeSchema = z.object({
  episodes: z
    .array(
      z.object({
        title: z.string(),
        synopsis: z.string().default(''),
        ends_with: z.string(),
      }),
    )
    .min(1),
})

export interface PlanResult {
  readonly episodes: EpisodeDraft[]
  /** 重试过几轮。0 表示第一次就定位上了。 */
  readonly retries: number
}

const MAX_ATTEMPTS = 3

/** 区间是这一份原文内部的下标。 */
export async function planEpisodes(ctx: GenContext, project: ProjectRow, file: SourceRow): Promise<PlanResult> {
  const args = argsFor(ctx, 'episode')
  const wanted = episodeCountOf(args.episode_count)
  // 导入时已是整篇一集，不填集数就没有可做的。
  if (wanted === 0) throw new Conflict('请先在参数中填写集数，当前为整篇一集')

  const source = file.text
  let failure: readonly string[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text } = await generateText(ctx, {
      owner: { kind: 'project', id: project.id },
      purpose: 'episode_plan',
      label: attempt === 1 ? '分集规划' : `分集规划（第 ${attempt} 次）`,
      params: {
        system: EPISODE_SYSTEM,
        prompt: episodePrompt({ source, targetSeconds: project.target_seconds, failure }, args),
      },
    })

    const reply = parseReply(text, episodeSchema, '分集规划')
    const located = locateAnchors(
      source,
      reply.episodes.map((e) => e.ends_with),
    )

    if (located.ok) {
      // 整篇一集时沿用导入时的集名，它带着章号。
      const single = reply.episodes.length === 1
      return {
        episodes: reply.episodes.map((e, i) => ({
          title: single ? titleOf(file) : e.title,
          synopsis: e.synopsis,
          sourceStart: located.spans[i]?.start ?? 0,
          sourceEnd: located.spans[i]?.end ?? source.length,
        })),
        retries: attempt - 1,
      }
    }

    failure = located.reasons
    appendEvent(ctx.db, ctx.runId, {
      type: 'note',
      level: 'warn',
      message: `第 ${attempt} 次分集：部分集的末句未能在原文中定位，${attempt < MAX_ATTEMPTS ? '附原因重试' : '放弃'}：${failure.join('；')}`,
    })
  }

  throw new Conflict(`模型 ${MAX_ATTEMPTS} 次都没能给出能在原文里定位的分集末句：${failure.join('；')}`)
}
