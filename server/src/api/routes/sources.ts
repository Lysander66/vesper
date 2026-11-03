/** 原文这一组：追加、改写，以及分集规划、定稿与按批提取资产。 */

import type { Database } from 'bun:sqlite'

import { renumberNote, type EpisodeSuggestionView, type SourceMutationView } from '@vesper/shared'

import { BadRequest, body, json, z, type Register } from '../http'
import { launch, runSync } from '../tasks'
import { projectView } from '../views'
import { extraOf, launchExtra, EXTRA_SCHEMA } from './params'
import { normalizeSource } from '../../domain/import'
import { Conflict } from '../../domain/errors'
import { getProject } from '../../repo/projects'
import { getSource } from '../../repo/sources'
import {
  addSources,
  freezeSource,
  removeSource,
  renameSource,
  reorderSources,
  replaceSourceEpisodes,
  replaceSourceText,
  unfreezeSource,
} from '../../service/sources'
import { extractAssets } from '../../pipeline/assets'
import { planEpisodes } from '../../pipeline/plan'
import { suggestEpisodeCount } from '../../pipeline/suggest'

export function registerSources(on: Register, db: Database): void {
  on('POST', '/api/projects/:id/sources', async (request, params) => {
    const input = await body(
      request,
      z.object({ files: z.array(z.object({ name: z.string().default(''), text: z.string() })).min(1) }),
    )
    const id = params.id ?? ''
    getProject(db, id)
    addSources(db, id, input.files)
    return json(projectView(db, id), 201)
  })

  on('PUT', '/api/projects/:id/sources/order', async (request, params) => {
    const input = await body(request, z.object({ ids: z.array(z.string()).min(1) }))
    const id = params.id ?? ''
    const renumberedFrom = reorderSources(db, id, input.ids)
    const view: SourceMutationView = { ...projectView(db, id), renumbered_from: renumberedFrom }
    return json(view)
  })

  on('PATCH', '/api/sources/:id', async (request, params) => {
    const patch = await body(request, z.object({ name: z.string().min(1).optional(), text: z.string().optional() }))
    const source = getSource(db, params.id ?? '')
    if (patch.name !== undefined) renameSource(db, source.id, patch.name)
    if (patch.text !== undefined) replaceSourceText(db, source.id, normalizeSource(patch.text))
    return json(projectView(db, source.project_id))
  })

  on('DELETE', '/api/sources/:id', (_request, params) => {
    const source = getSource(db, params.id ?? '')
    const renumberedFrom = removeSource(db, source.id)
    const view: SourceMutationView = { ...projectView(db, source.project_id), renumbered_from: renumberedFrom }
    return json(view)
  })


  on('POST', '/api/sources/:id/plan', async (request, params) => {
    const extra = await launchExtra(request)
    const source = getSource(db, params.id ?? '')
    if (source.plan_state === 'frozen') throw new Conflict('这份原文已定稿，需先重新编辑')
    const project = getProject(db, source.project_id)
    const runId = launch(
      { db, projectId: project.id, owner: { kind: 'project', id: project.id }, kind: 'plan', ...extra },
      async (ctx) => {
        const result = await planEpisodes(ctx, project, source)
        const written = replaceSourceEpisodes(db, source.id, result.episodes)
        return {
          episodes: written.episodes,
          retries: result.retries,
          renumbered_from: written.renumberedFrom,
          note: renumberNote(written.renumberedFrom),
        }
      },
    )
    return json({ run_id: runId }, 202)
  })

  // 只返回建议集数与理由，不写库。
  on('POST', '/api/sources/:id/suggest-episodes', async (_request, params) => {
    const source = getSource(db, params.id ?? '')
    const project = getProject(db, source.project_id)
    const suggestion = await runSync(
      { db, projectId: project.id, owner: { kind: 'project', id: project.id }, kind: 'episode_suggest' },
      (ctx) => suggestEpisodeCount(ctx, project, source),
    )
    const view: EpisodeSuggestionView = suggestion
    return json(view)
  })

  on('PUT', '/api/sources/:id/episodes', async (request, params) => {
    const input = await body(
      request,
      z.object({
        episodes: z
          .array(
            z.object({
              title: z.string().default(''),
              synopsis: z.string().default(''),
              source_start: z.number().int().nonnegative(),
              source_end: z.number().int().positive(),
            }),
          )
          .min(1),
      }),
    )
    const source = getSource(db, params.id ?? '')
    const written = replaceSourceEpisodes(
      db,
      source.id,
      input.episodes.map((e) => ({
        title: e.title,
        synopsis: e.synopsis,
        sourceStart: e.source_start,
        sourceEnd: e.source_end,
      })),
    )
    const view: SourceMutationView = {
      ...projectView(db, source.project_id),
      renumbered_from: written.renumberedFrom,
    }
    return json(view)
  })

  on('POST', '/api/sources/:id/freeze', (_request, params) => json(freezeSource(db, params.id ?? '')))

  on('POST', '/api/sources/:id/unfreeze', (_request, params) => {
    const source = getSource(db, params.id ?? '')
    unfreezeSource(db, source.id)
    return json(projectView(db, source.project_id))
  })

  on('POST', '/api/projects/:id/assets/extract', async (request, params) => {
    const input = await body(request, z.object({ source_ids: z.array(z.string()).min(1), ...EXTRA_SCHEMA }))
    const project = getProject(db, params.id ?? '')
    const files = input.source_ids.map((id) => getSource(db, id))
    const stray = files.find((file) => file.project_id !== project.id)
    if (stray) throw new BadRequest(`「${stray.name}」不属于这部作品`)
    const runId = launch(
      {
        db,
        projectId: project.id,
        owner: { kind: 'project', id: project.id },
        kind: 'asset_extract',
        ...extraOf(input),
      },
      (ctx) => extractAssets(ctx, project, files),
    )
    return json({ run_id: runId }, 202)
  })
}
