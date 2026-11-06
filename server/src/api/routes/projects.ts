import type { Database } from 'bun:sqlite'

import { ASPECTS, AUDIO_MODES, CONTINUITY_MODES, type StyleSuggestionView } from '@vesper/shared'

import { body, json, z, type Register } from '../http'
import { runSync } from '../tasks'
import { projectView } from '../views'
import { Conflict } from '../../domain/errors'
import { createProject, DEFAULT_SHOT_SECONDS, getProject, listProjects } from '../../repo/projects'
import { listSources } from '../../repo/sources'
import { addSources } from '../../service/sources'
import { deleteProject, updateProject } from '../../service/projects'
import { DEFAULT_STYLE } from '../../pipeline/prompts'
import { suggestStyle } from '../../pipeline/suggest'

export function registerProjects(on: Register, db: Database): void {
  on('GET', '/api/projects', () => json(listProjects(db)))

  on('POST', '/api/projects', async (request) => {
    const input = await body(
      request,
      z.object({
        name: z.string().min(1),
        files: z.array(z.object({ name: z.string().default(''), text: z.string() })).min(1),
        // 0 表示不限。
        target_seconds: z.number().int().nonnegative().default(0),
        speech_rate: z.number().positive().default(5),
        shot_min_seconds: z.number().positive().default(DEFAULT_SHOT_SECONDS.min),
        shot_max_seconds: z.number().positive().default(DEFAULT_SHOT_SECONDS.max),
        style: z.string().default(DEFAULT_STYLE),
        aspect: z.enum(ASPECTS).default('16:9'),
      }).refine((v) => v.shot_min_seconds <= v.shot_max_seconds, '单镜时长下限不能大于上限'),
    )
    // 同一事务：原文全为空时 addSources 会抛错，不能留下没有原文的作品。
    const id = db.transaction(() => {
      const projectId = createProject(db, {
        name: input.name,
        targetSeconds: input.target_seconds,
        speechRate: input.speech_rate,
        shotSeconds: { min: input.shot_min_seconds, max: input.shot_max_seconds },
        style: input.style,
        aspect: input.aspect,
      })
      addSources(db, projectId, input.files)
      return projectId
    })()
    return json(projectView(db, id), 201)
  })

  on('GET', '/api/projects/:id', (_request, params) => json(projectView(db, params.id ?? '')))

  on('PATCH', '/api/projects/:id', async (request, params) => {
    const patch = await body(
      request,
      z.object({
        name: z.string().optional(),
        target_seconds: z.number().int().nonnegative().optional(),
        speech_rate: z.number().positive().optional(),
        // 上下限一起给，校验交叉时不必再读库。
        shot_min_seconds: z.number().positive().optional(),
        shot_max_seconds: z.number().positive().optional(),
        style: z.string().optional(),
        aspect: z.enum(ASPECTS).optional(),
        audio_mode: z.enum(AUDIO_MODES).optional(),
        continuity_mode: z.enum(CONTINUITY_MODES).optional(),
      })
        .refine(
          (v) => (v.shot_min_seconds === undefined) === (v.shot_max_seconds === undefined),
          '单镜时长的上下限要一起给',
        )
        .refine(
          (v) => (v.shot_min_seconds ?? 0) <= (v.shot_max_seconds ?? 0),
          '单镜时长下限不能大于上限',
        ),
    )
    const id = params.id ?? ''
    updateProject(db, id, {
      name: patch.name,
      targetSeconds: patch.target_seconds,
      speechRate: patch.speech_rate,
      shotSeconds:
        patch.shot_min_seconds !== undefined && patch.shot_max_seconds !== undefined
          ? { min: patch.shot_min_seconds, max: patch.shot_max_seconds }
          : undefined,
      style: patch.style,
      aspect: patch.aspect,
      audioMode: patch.audio_mode,
      continuityMode: patch.continuity_mode,
    })
    return json(projectView(db, id))
  })

  on('DELETE', '/api/projects/:id', (_request, params) => {
    const id = params.id ?? ''
    deleteProject(db, id)
    return json({ id })
  })

  // 只返回预设名与理由，不写库。读第一份原文的开头：题材与情绪在开篇就已确定。
  on('POST', '/api/projects/:id/suggest-style', async (_request, params) => {
    const project = getProject(db, params.id ?? '')
    const file = listSources(db, project.id)[0]
    if (file === undefined) throw new Conflict('这部作品还没有原文')
    const picks = await runSync(
      { db, projectId: project.id, owner: { kind: 'project', id: project.id }, kind: 'style_suggest' },
      (ctx) => suggestStyle(ctx, project, file),
    )
    const view: StyleSuggestionView = { picks }
    return json(view)
  })
}
