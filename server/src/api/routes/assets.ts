import type { Database } from 'bun:sqlite'

import { BadRequest, body, json, optionalBody, z, type Register } from '../http'
import { saveUpload } from '../files'
import { launch } from '../tasks'
import { assetPreview, assetView } from '../views'
import { extraOf, EXTRA_SCHEMA, VOICE_SAMPLE_SCHEMA } from './params'
import { ASSET_CATEGORIES, ASSET_FILE_ROLES, CHARACTER_FORMS, LOOK_ORDER } from '@vesper/shared'
import { getProject } from '../../repo/projects'
import { followLatestVersion } from '../../service/shots'
import { reorderAssets } from '../../repo/assets'
import {
  addAssetFile,
  createCostume,
  createProjectAsset,
  lockAsset,
  lockAssets,
  projectOf,
  removeAsset,
  restoreAssetFile,
  unlockAsset,
  updateAssetData,
} from '../../service/assets'
import { generateAllLooks, generateLooks, generateVoiceSample } from '../../pipeline/assets'
import { applyVoice, listVoices } from '../../service/voices'

export function registerAssets(on: Register, db: Database): void {
  on('POST', '/api/projects/:id/assets', async (request, params) => {
    const input = await body(
      request,
      z.object({
        name: z.string().min(1),
        category: z.enum(ASSET_CATEGORIES).default('character'),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    const id = createProjectAsset(db, params.id ?? '', input)
    return json(assetView(db, id), 201)
  })

  on('GET', '/api/assets/:id', (_request, params) => json(assetView(db, params.id ?? '')))

  on('DELETE', '/api/assets/:id', (_request, params) => {
    removeAsset(db, params.id ?? '')
    return json({ id: params.id ?? '' })
  })

  on('PATCH', '/api/assets/:id', async (request, params) => {
    const patch = await body(
      request,
      // 三类资产共用一个补丁体，字段名互不重叠。
      z.object({
        aliases: z.array(z.string()).optional(),
        tier: z.enum(['lead', 'support']).optional(),
        form: z.enum(CHARACTER_FORMS).optional(),
        identity: z.string().optional(),
        traits: z.string().optional(),
        outfit: z.string().optional(),
        voice: z.string().optional(),
        description: z.string().optional(),
        lighting: z.string().optional(),
        holder: z.string().optional(),
      }),
    )
    updateAssetData(db, params.id ?? '', dropUndefined(patch))
    return json(assetView(db, params.id ?? ''))
  })

  on('POST', '/api/assets/:id/looks', async (request, params) => {
    const input = await body(request, z.object({ roles: z.array(z.string()).optional(), ...EXTRA_SCHEMA }))
    const assetId = params.id ?? ''
    const projectId = projectOf(db, assetId)
    // 不传 roles 只画第一张。
    const roles = input.roles?.filter((r): r is (typeof LOOK_ORDER)[number] =>
      (LOOK_ORDER as readonly string[]).includes(r),
    )
    const runId = launch(
      { db, projectId, owner: { kind: 'asset', id: assetId }, kind: 'looks', ...extraOf(input) },
      (ctx) => generateLooks(ctx, assetId, roles),
    )
    return json({ run_id: runId }, 202)
  })

  /** 请求体与发起接口相同，返回照此会发出的内容。 */
  on('POST', '/api/assets/:id/preview', async (request, params) => {
    const input = await optionalBody(request, z.object({ ...EXTRA_SCHEMA }))
    const { promptArgs, overrides, promptText } = extraOf(input)
    return json(assetPreview(db, params.id ?? '', { promptArgs, overrides, promptText }))
  })

  /** 一个任务内串行处理：发起端没有并发控制。 */
  on('POST', '/api/projects/:id/looks', async (request, params) => {
    const input = await optionalBody(
      request,
      z.object({ category: z.enum(ASSET_CATEGORIES).optional(), ...EXTRA_SCHEMA }),
    )
    const project = getProject(db, params.id ?? '')
    const runId = launch(
      {
        db,
        projectId: project.id,
        owner: { kind: 'project', id: project.id },
        kind: 'project_looks',
        ...extraOf(input),
      },
      (ctx) => generateAllLooks(ctx, project.id, input.category),
    )
    return json({ run_id: runId }, 202)
  })

  on('POST', '/api/assets/:id/voice-sample', async (request, params) => {
    const input = await body(request, VOICE_SAMPLE_SCHEMA)
    const assetId = params.id ?? ''
    const runId = launch(
      {
        db,
        projectId: projectOf(db, assetId),
        owner: { kind: 'asset', id: assetId },
        kind: 'voice_sample',
        overrides: input.params,
      },
      (ctx) => generateVoiceSample(ctx, assetId, input.line, input.count),
    )
    return json({ run_id: runId }, 202)
  })

  on('POST', '/api/assets/:id/files/upload', async (request, params) => {
    const form = await request.formData()
    const role = z.enum(ASSET_FILE_ROLES).safeParse(form.get('role'))
    const file = form.get('file')
    if (!role.success) throw new BadRequest('缺少设定图类型')
    if (!(file instanceof File)) throw new BadRequest('没收到文件')
    addAssetFile(db, params.id ?? '', { role: role.data, path: await saveUpload(file, role.data === 'voice_sample' ? 'audio' : 'image') })
    return json(assetView(db, params.id ?? ''))
  })

  on('POST', '/api/assets/:id/files/:fileId/restore', (_request, params) => {
    restoreAssetFile(db, params.id ?? '', Number(params.fileId))
    return json(assetView(db, params.id ?? ''))
  })

  on('POST', '/api/assets/:id/costumes', async (request, params) => {
    const input = await body(request, z.object({ name: z.string().trim().min(1), outfit: z.string().default('') }))
    return json(assetView(db, createCostume(db, params.id ?? '', input.name, input.outfit)), 201)
  })

  on('GET', '/api/voices', () => json(listVoices()))

  on('POST', '/api/assets/:id/voice-preset', async (request, params) => {
    const input = await body(request, z.object({ voice_id: z.string().min(1) }))
    applyVoice(db, params.id ?? '', input.voice_id)
    return json(assetView(db, params.id ?? ''))
  })

  on('PUT', '/api/projects/:id/assets/order', async (request, params) => {
    const input = await body(request, z.object({ category: z.enum(ASSET_CATEGORIES), ids: z.array(z.string()) }))
    reorderAssets(db, params.id ?? '', input.category, input.ids)
    return json({ ids: input.ids })
  })

  /** 一次锁一类，由服务端汇总锁上了哪几件。 */
  on('POST', '/api/projects/:id/assets/lock', async (request, params) => {
    const input = await optionalBody(request, z.object({ category: z.enum(ASSET_CATEGORIES).optional() }))
    return json(lockAssets(db, params.id ?? '', input.category))
  })

  on('POST', '/api/assets/:id/lock', (_request, params) => json(lockAsset(db, params.id ?? '')))
  on('POST', '/api/assets/:id/follow', (_request, params) => json({ shots: followLatestVersion(db, params.id ?? '') }))
  on('POST', '/api/assets/:id/unlock', (_request, params) => {
    unlockAsset(db, params.id ?? '')
    return json(assetView(db, params.id ?? ''))
  })
}

/** zod 的可选字段解析为显式 undefined，`exactOptionalPropertyTypes` 下要先去掉才能当 Partial 用。 */
function dropUndefined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
