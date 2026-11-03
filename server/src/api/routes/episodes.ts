/** 单集：节拍、分镜、整集生成与合成。 */

import type { Database } from 'bun:sqlite'

import type { Review, ShotInsertView } from '@vesper/shared'

import { body, json, optionalBody, z, type Register } from '../http'
import { launch } from '../tasks'
import { episodeView } from '../views'
import { EXTRA_SCHEMA, extraOf, launchExtra, produceInput } from './params'
import { Conflict } from '../../domain/errors'
import { getEpisode, getProject, setEpisodeBeats, setEpisodeReview } from '../../repo/projects'
import { confirmEpisodeBeats } from '../../service/projects'
import { listShots } from '../../repo/shots'
import { addShot } from '../../service/shots'
import { getSource } from '../../repo/sources'
import { splitShots, writeBeats } from '../../pipeline/script'
import { reviewAfter, reviewEpisode } from '../../pipeline/review'
import { produceShot } from '../../pipeline/produce'
import { assembleEpisode } from '../../pipeline/assemble'

export function registerEpisodes(on: Register, db: Database): void {
  on('GET', '/api/episodes/:id', (_request, params) => json(episodeView(db, params.id ?? '')))

  on('POST', '/api/episodes/:id/beats', async (request, params) => {
    const extra = await launchExtra(request)
    const episode = requireFrozen(db, params.id ?? '')
    const runId = launch(
      { db, projectId: episode.project_id, owner: { kind: 'episode', id: episode.id }, kind: 'beats', ...extra },
      async (ctx) => {
        const beats = await writeBeats(ctx, episode)
        return { beats: beats.length, ...scoreNote(await reviewAfter(ctx, episode.id)) }
      },
    )
    return json({ run_id: runId }, 202)
  })

  // 节拍要人工确认，所以必须能整段改写。
  on('PUT', '/api/episodes/:id/beats', async (request, params) => {
    const input = await body(
      request,
      z.object({
        beats: z.array(
          z.object({
            mode: z.enum(['scene', 'narration']),
            summary: z.string().default(''),
            utterances: z
              .array(z.object({ speaker: z.string().nullable().default(null), text: z.string() }))
              .default([]),
          }),
        ),
      }),
    )
    const id = params.id ?? ''
    setEpisodeBeats(db, id, input.beats)
    return json(episodeView(db, id))
  })

  on('POST', '/api/episodes/:id/review', async (request, params) => {
    const extra = await launchExtra(request)
    const episode = requireFrozen(db, params.id ?? '')
    const runId = launch(
      { db, projectId: episode.project_id, owner: { kind: 'episode', id: episode.id }, kind: 'review', ...extra },
      async (ctx) => scoreNote(await reviewEpisode(ctx, episode.id)),
    )
    return json({ run_id: runId }, 202)
  })

  on('POST', '/api/episodes/:id/beats/confirm', (_request, params) => {
    const id = params.id ?? ''
    confirmEpisodeBeats(db, id)
    return json(episodeView(db, id))
  })

  on('POST', '/api/episodes/:id/shots/split', async (request, params) => {
    const input = await optionalBody(
      request,
      z.object(EXTRA_SCHEMA),
    )
    const episode = requireFrozen(db, params.id ?? '')
    const runId = launch(
      { db, projectId: episode.project_id, owner: { kind: 'episode', id: episode.id }, kind: 'shots', ...extraOf(input) },
      async (ctx) => {
        // 旧审查针对上一版分镜，拆分失败时留着会被误认为新分镜已审过。
        setEpisodeReview(db, episode.id, null)
        const result = await splitShots(ctx, episode)
        return { ...result, ...scoreNote(await reviewAfter(ctx, episode.id)) }
      },
    )
    return json({ run_id: runId }, 202)
  })

  // 与拆分镜一样要求分集已定稿，但不要求节拍已确认。
  on('POST', '/api/episodes/:id/shots', async (request, params) => {
    const input = await optionalBody(request, z.object({ after_shot_id: z.string().nullable().default(null) }))
    const episode = requireFrozen(db, params.id ?? '')
    const id = addShot(db, episode.id, input.after_shot_id, getProject(db, episode.project_id).shot_min_seconds)
    const view: ShotInsertView = { ...episodeView(db, episode.id), shot_id: id }
    return json(view, 201)
  })

  on('POST', '/api/episodes/:id/produce', async (request, params) => {
    const input = await produceInput(request)
    const episode = requireFrozen(db, params.id ?? '')
    const shots = listShots(db, episode.id)
    if (shots.length === 0) throw new Conflict('本集还没有分镜')
    const project = getProject(db, episode.project_id)
    const audio = input.audio ?? project.audio_mode
    const continuity = input.continuity ?? project.continuity_mode

    const runId = launch(
      {
        db,
        projectId: episode.project_id,
        owner: { kind: 'episode', id: episode.id },
        kind: 'produce_episode',
        overrides: input.overrides,
        promptArgs: input.promptArgs,
        // 手写提示词不用于整集生成，否则每一镜都用同一段文字。
      },
      async (ctx) => {
        // 逐镜串行：避免占满供应商的并发上限，也保证上一镜视频先落地，下一镜才有末帧可接。
        const done: string[] = []
        for (const shot of shots) {
          await produceShot(ctx, shot, input.kinds, audio, continuity)
          done.push(shot.id)
        }
        return { shots: done.length }
      },
    )
    return json({ run_id: runId }, 202)
  })

  on('POST', '/api/episodes/:id/assemble', async (request, params) => {
    const input = await optionalBody(request, z.object({ force: z.enum(['yes', 'no']).default('no') }))
    const episode = requireFrozen(db, params.id ?? '')
    const runId = launch(
      { db, projectId: episode.project_id, owner: { kind: 'episode', id: episode.id }, kind: 'assemble' },
      (ctx) => assembleEpisode(ctx, episode, { force: input.force === 'yes' }),
    )
    return json({ run_id: runId }, 202)
  })
}

function scoreNote(review: Review | null): { score?: number; note?: string } {
  return review ? { score: review.score, note: `审查 ${review.score} 分` } : {}
}

/** 分集没定稿不许往下做：区间还会变，下游做了也要重做。 */
function requireFrozen(db: Database, episodeId: string) {
  const episode = getEpisode(db, episodeId)
  if (getSource(db, episode.source_id).plan_state !== 'frozen') throw new Conflict('分集尚未定稿，先定稿再做本集')
  return episode
}
