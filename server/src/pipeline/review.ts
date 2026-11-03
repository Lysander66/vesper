/** 审查：让模型当没读过原文的观众，只看节拍或分镜复述剧情，只出报告。 */

import type { Review } from '@vesper/shared'

import { argsFor, generateText, type GenContext } from './gen'
import { parseReply, z } from './reply'
import { REVIEW_SYSTEM, reviewPrompt } from './prompts'
import { parseBeats } from '../domain/beats'
import { Conflict } from '../domain/errors'
import { nowIso } from '../repo/common'
import { episodeTitle, getEpisode, listEpisodes, setEpisodeReview, type EpisodeRow } from '../repo/projects'
import { appendEvent } from '../repo/runs'
import { listShots, utterancesOf } from '../repo/shots'

const reviewSchema = z.object({
  retelling: z.string(),
  gaps: z.array(z.object({ at: z.string().default(''), missing: z.string() })).default([]),
  score: z.number(),
})

/** reviewSchema 的 JSON Schema 版，两边同步改。 */
const reviewOutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      retelling: { type: 'string' },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: { at: { type: 'string' }, missing: { type: 'string' } },
          required: ['at', 'missing'],
          additionalProperties: false,
        },
      },
      score: { type: 'number' },
    },
    required: ['retelling', 'gaps', 'score'],
    additionalProperties: false,
  },
} as const

export async function reviewEpisode(ctx: GenContext, episodeId: string): Promise<Review> {
  const episode = getEpisode(ctx.db, episodeId)
  const beats = parseBeats(episode.beats)
  const shots = listShots(ctx.db, episode.id)
  if (beats.length === 0 && shots.length === 0) throw new Conflict('本集还没有节拍，没有可审的')

  const basis = shots.length > 0 ? 'shots' : 'beats'
  const units =
    basis === 'shots'
      ? shots.map((shot) => ({
          // 没写提示词的镜头用梗概与场景代替。
          picture: [shot.image_prompt || [shot.summary, shot.scene].filter((s) => s !== '').join('。'), shot.motion_prompt]
            .filter((s) => s.trim() !== '')
            .join('\n  动作：'),
          utterances: utterancesOf(shot),
        }))
      : beats.map((beat) => ({ picture: beat.summary, utterances: beat.utterances }))

  const { text } = await generateText(ctx, {
    owner: { kind: 'episode', id: episode.id },
    purpose: 'review',
    label: `第 ${episode.idx + 1} 集审查`,
    params: {
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt(
        { title: episodeTitle(episode), previous: previousOf(ctx, episode), basis, units },
        argsFor(ctx, 'review'),
      ),
      output_config: { format: reviewOutputFormat },
    },
  })

  const reply = parseReply(text, reviewSchema, '审查')
  const review: Review = {
    basis,
    retelling: reply.retelling,
    gaps: reply.gaps.filter((gap) => gap.missing.trim() !== ''),
    score: Math.min(10, Math.max(1, Math.round(reply.score))),
    created_at: nowIso(),
  }
  setEpisodeReview(ctx.db, episode.id, review)
  return review
}

/** 生成节拍、拆完分镜后自动审查一遍，失败只记警告。 */
export async function reviewAfter(ctx: GenContext, episodeId: string): Promise<Review | null> {
  try {
    return await reviewEpisode(ctx, episodeId)
  } catch (error) {
    appendEvent(ctx.db, ctx.runId, { type: 'note', level: 'warn', message: `审查没跑成：${(error as Error).message}` })
    return null
  }
}

function previousOf(ctx: GenContext, episode: EpisodeRow): { title: string; summaries: string[] }[] {
  return listEpisodes(ctx.db, episode.project_id)
    .filter((ep) => ep.idx < episode.idx)
    .map((ep) => ({ title: episodeTitle(ep), summaries: parseBeats(ep.beats).map((beat) => beat.summary) }))
    .filter((ep) => ep.summaries.length > 0)
}
