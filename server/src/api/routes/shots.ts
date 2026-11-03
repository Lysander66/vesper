/** 单镜：修改、删除与单镜生成。 */

import type { Database } from 'bun:sqlite'
import { CAMERA_MOVES, CLIP_SOURCES, SHOT_JOINS, SHOT_SIZES } from '@vesper/shared'

import { body, json, z, type Register } from '../http'
import { assertIdle, launch } from '../tasks'
import { launchExtra, produceInput } from './params'
import { getEpisode, getProject } from '../../repo/projects'
import { getShot } from '../../repo/shots'
import { castRefs, removeShot, updateShot } from '../../service/shots'
import { episodeView, shotPreview } from '../views'
import { polishShot } from '../../pipeline/polish'
import { produceShot } from '../../pipeline/produce'
import { effectiveAudioMode } from '../../pipeline/gen'

export function registerShots(on: Register, db: Database): void {
  on('PATCH', '/api/shots/:id', async (request, params) => {
    const patch = await body(
      request,
      z.object({
        summary: z.string().optional(),
        scene: z.string().optional(),
        camera: z.string().optional(),
        shot_size: z.enum(SHOT_SIZES).optional(),
        camera_move: z.enum(CAMERA_MOVES).optional(),
        mood: z.string().optional(),
        join_mode: z.enum(SHOT_JOINS).optional(),
        clip_source: z.enum(CLIP_SOURCES).optional(),
        image_prompt: z.string().optional(),
        motion_prompt: z.string().optional(),
        sound: z.string().optional(),
        utterances: z
          .array(z.object({ speaker: z.string().nullable().default(null), text: z.string(), how: z.string().optional() }))
          .optional(),
        seconds: z.number().positive().optional(),
        /** 资产 id；引用落到各自最新的锁定版本。 */
        cast: z.array(z.string()).optional(),
      }),
    )
    const project = getProject(db, getEpisode(db, getShot(db, params.id ?? '').episode_id).project_id)
    const impacted = updateShot(db, params.id ?? '', {
      summary: patch.summary,
      scene: patch.scene,
      camera: patch.camera,
      shotSize: patch.shot_size,
      cameraMove: patch.camera_move,
      mood: patch.mood,
      joinMode: patch.join_mode,
      clipSource: patch.clip_source,
      imagePrompt: patch.image_prompt,
      motionPrompt: patch.motion_prompt,
      sound: patch.sound,
      utterances: patch.utterances,
      seconds: patch.seconds,
      cast: patch.cast === undefined ? undefined : castRefs(db, patch.cast),
    }, effectiveAudioMode(db, project.id, project.audio_mode))
    const shot = getShot(db, params.id ?? '')
    return json({ shot, stale_kinds: impacted })
  })

  on('DELETE', '/api/shots/:id', (_request, params) => {
    const shot = getShot(db, params.id ?? '')
    assertIdle(db, { kind: 'shot', id: shot.id })
    removeShot(db, shot.id)
    return json(episodeView(db, shot.episode_id))
  })

  /** 请求体与发起接口相同，返回照此会发出的内容。 */
  on('POST', '/api/shots/:id/preview', async (request, params) => {
    const input = await produceInput(request)
    const shot = getShot(db, params.id ?? '')
    const { audio, continuity, promptArgs, overrides, promptText } = input
    return json(shotPreview(db, shot, { audio, continuity, promptArgs, overrides, promptText }))
  })

  // 重写会覆盖两个提示词字段里人改过的内容，前端须先确认。
  on('POST', '/api/shots/:id/polish', async (request, params) => {
    const extra = await launchExtra(request)
    const shot = getShot(db, params.id ?? '')
    const episode = getEpisode(db, shot.episode_id)
    const runId = launch(
      { db, projectId: episode.project_id, owner: { kind: 'shot', id: shot.id }, kind: 'polish_shot', ...extra },
      (ctx) => polishShot(ctx, shot),
    )
    return json({ run_id: runId }, 202)
  })

  on('POST', '/api/shots/:id/produce', async (request, params) => {
    const input = await produceInput(request)
    const shot = getShot(db, params.id ?? '')
    const episode = getEpisode(db, shot.episode_id)
    const project = getProject(db, episode.project_id)
    const audio = input.audio ?? project.audio_mode
    const continuity = input.continuity ?? project.continuity_mode
    const runId = launch(
      {
        db,
        projectId: episode.project_id,
        owner: { kind: 'shot', id: shot.id },
        kind: 'produce_shot',
        overrides: input.overrides,
        promptArgs: input.promptArgs,
        promptText: input.promptText,
      },
      (ctx) => produceShot(ctx, shot, input.kinds, audio, continuity),
    )
    return json({ run_id: runId }, 202)
  })
}
