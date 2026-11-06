import { beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRouter } from '../src/api/routes'
import { createJob, recordCall } from '../src/db/records'
import { openDatabase } from '../src/db/schema'
import { artifactHistory, recordArtifact, replaceShots, type ShotDraft } from '../src/repo/shots'
import { insertAssetFile } from '../src/repo/assets'
import { artifactDir, libraryDir, requestDir } from '../src/store/paths'

let db: Database
let route: (request: Request) => Promise<Response | undefined>

const SOURCE = '雪下了一整夜，屋檐压着白。'.repeat(160) + '林小满推开门，雪落在她肩上。'

function call(method: string, path: string, body?: unknown): Promise<Response | undefined> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return route(new Request(`http://x${path}`, init))
}

async function read(response: Response | undefined): Promise<Record<string, unknown>> {
  expect(response).toBeDefined()
  return (await response!.json()) as Record<string, unknown>
}

/** 导入一份原文的作品，导入后即有一集。 */
async function newProject(): Promise<{ projectId: string; sourceId: string }> {
  const view = await read(
    await call('POST', '/api/projects', {
      name: '雪夜',
      files: [{ name: '雪夜.txt', text: SOURCE }],
      target_seconds: 60,
    }),
  )
  return {
    projectId: (view.project as { id: string }).id,
    sourceId: (view.sources as { id: string }[])[0]!.id,
  }
}

async function episodesOf(projectId: string): Promise<{ id: string; title: string }[]> {
  const view = await read(await call('GET', `/api/projects/${projectId}`))
  return (view.sources as { episodes: { id: string; title: string }[] }[]).flatMap((source) => source.episodes)
}

const DRAFT: ShotDraft = {
  summary: '推门',
  scene: '雪夜屋檐下',
  camera: '中景',
  shotSize: 'medium',
  cameraMove: 'static',
  mood: '',
  joinMode: 'cut',
  clipSource: 'first_frame',
  imagePrompt: '雪',
  motionPrompt: '推近',
  utterances: [],
  seconds: 5,
  cast: [],
  sceneRef: null,
  props: [],
  beatIndex: 0,
}

beforeEach(() => {
  db = openDatabase(':memory:')
  route = createRouter(db)
})

describe('分集定稿', () => {
  /** 给这一集挂一个镜头和一张首帧。 */
  function frameOf(episodeId: string): string {
    const [shotId] = replaceShots(db, episodeId, [DRAFT])
    recordArtifact(db, { kind: 'shot', id: shotId! }, 'first_frame', { path: '/data/v1.png' })
    return shotId!
  }

  const stateOf = (shotId: string) => artifactHistory(db, { kind: 'shot', id: shotId }, 'first_frame')[0]!.state

  test('移动一处分集边界再定稿，只有相邻两集的产物过时', async () => {
    const { projectId, sourceId } = await newProject()
    const spans = (middle: number) => [
      { title: '上', source_start: 0, source_end: 120 },
      { title: '中', source_start: 120, source_end: middle },
      { title: '下', source_start: middle, source_end: SOURCE.length },
    ]
    await call('PUT', `/api/sources/${sourceId}/episodes`, { episodes: spans(400) })
    await call('POST', `/api/sources/${sourceId}/freeze`)
    const [first, second, third] = await episodesOf(projectId)
    const shots = [frameOf(first!.id), frameOf(second!.id), frameOf(third!.id)]

    await call('POST', `/api/sources/${sourceId}/unfreeze`)
    await call('PUT', `/api/sources/${sourceId}/episodes`, { episodes: spans(500) })
    const frozen = await read(await call('POST', `/api/sources/${sourceId}/freeze`))

    expect(frozen.staleArtifacts).toBe(2)
    expect(shots.map(stateOf)).toEqual(['fresh', 'stale', 'stale'])
  })
})

describe('凭证', () => {
  test('列出凭证时不带 api_key', async () => {
    await call('POST', '/api/credentials', { name: 'minimax', base_url: 'https://api.minimax.cn', api_key: 'sk-abc' })
    const list = (await (await call('GET', '/api/credentials'))!.json()) as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    expect(Object.keys(list[0]!)).not.toContain('api_key')
    expect(JSON.stringify(list)).not.toContain('sk-abc')
  })
})

describe('导出请求 JSON', () => {
  test('落到数据目录，凭证仍是脱敏后的值', async () => {
    const now = new Date().toISOString()
    db.query('INSERT INTO endpoints VALUES (?, ?, ?, ?, ?, ?)').run('ep-1', 'H3', 'video', '{}', now, now)
    db.query('INSERT INTO credentials (id, name, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run('cr-1', 'minimax', 'https://x', 'sk-secret-value-1234', now)
    const jobId = createJob(db, {
      endpointId: 'ep-1',
      credentialId: 'cr-1',
      params: {},
      inputs: {},
    })
    const seq = recordCall(
      db,
      jobId,
      {
        section: 'submit',
        request: {
          method: 'POST',
          url: 'https://x/v2/video_generation',
          headers: { Authorization: 'Bearer sk-secret-value-1234' },
          body: { model: 'H3' },
        },
        startedAt: new Date(),
        durationMs: 1,
      },
      ['sk-secret-value-1234'],
    )
    const callId = (db.query('SELECT id FROM http_calls WHERE job_id = ? AND seq = ?').get(jobId, seq) as { id: number })
      .id

    const exported = await read(await call('POST', `/api/calls/${callId}/request-json`))
    expect(exported.path).toBe(join(requestDir(), `call-${callId}.json`))
    const text = await Bun.file(exported.path as string).text()
    expect(text).toContain('****1234')
    expect(text).not.toContain('sk-secret-value-1234')
  })
})

describe('素材库', () => {
  /** 有两版全身图、一段音色样本的角色，在用的是第二版全身图。 */
  async function withLook(projectId: string): Promise<string> {
    const asset = await read(await call('POST', `/api/projects/${projectId}/assets`, { name: '林小满', data: { aliases: ['小满'], appearances: 7, traits: '短发' } }))
    const dir = artifactDir(projectId)
    mkdirSync(dir, { recursive: true })
    for (const name of ['old.png', 'new.png', 'voice.wav']) writeFileSync(join(dir, name), name)
    const id = asset.id as string
    insertAssetFile(db, id, { role: 'full_body', path: join(dir, 'old.png') })
    insertAssetFile(db, id, { role: 'full_body', path: join(dir, 'new.png') })
    insertAssetFile(db, id, { role: 'voice_sample', path: join(dir, 'voice.wav') })
    return id
  }

  test('存入只带每种设定图类型在用的那张，作品资产列表不含库里的', async () => {
    const { projectId } = await newProject()
    const assetId = await withLook(projectId)

    const saved = await read(await call('POST', `/api/assets/${assetId}/library`, {}))
    const files = saved.files as { role: string; path: string }[]
    expect(files.map((f) => f.role).sort()).toEqual(['full_body', 'voice_sample'])
    expect(files.every((f) => f.path.startsWith(join(libraryDir(), saved.id as string)))).toBe(true)
    expect(await Bun.file(files.find((f) => f.role === 'full_body')!.path).text()).toBe('new.png')

    const library = (await (await call('GET', '/api/library'))!.json()) as { id: string; tags: string[] }[]
    expect(library.map((item) => [item.id, item.tags])).toEqual([[saved.id as string, ['雪夜']]])
    const view = await read(await call('GET', `/api/projects/${projectId}`))
    expect((view.cast as { id: string }[]).map((c) => c.id)).toEqual([assetId])
  })

  test('同名再存需指定覆盖，覆盖后旧的连文件一起删除', async () => {
    const { projectId } = await newProject()
    const assetId = await withLook(projectId)
    const first = await read(await call('POST', `/api/assets/${assetId}/library`, {}))

    expect((await call('POST', `/api/assets/${assetId}/library`, {}))!.status).toBe(409)
    const second = await read(await call('POST', `/api/assets/${assetId}/library`, { replace: 'yes' }))
    expect(second.id).not.toBe(first.id)
    expect(existsSync(join(libraryDir(), first.id as string))).toBe(false)
  })

  test('复制到作品得到一件草稿，文件另存一份', async () => {
    const { projectId } = await newProject()
    const saved = await read(await call('POST', `/api/assets/${await withLook(projectId)}/library`, {}))

    expect((await call('POST', `/api/library/${saved.id}/copy`, { project_id: projectId, name: '林小满' }))!.status).toBe(409)
    const copy = await read(await call('POST', `/api/library/${saved.id}/copy`, { project_id: projectId, name: '陆沉' }))
    expect(copy.state).toBe('draft')
    expect(copy.data).toMatchObject({ aliases: [], appearances: 0, traits: '短发' })
    const files = copy.files as { path: string }[]
    expect(files).toHaveLength(2)
    expect(files.every((f) => f.path.startsWith(artifactDir(projectId)))).toBe(true)

    await call('DELETE', `/api/library/${saved.id}`)
    expect(existsSync(files[0]!.path)).toBe(true)
    expect(await (await call('GET', '/api/library'))!.json()).toEqual([])
  })
})
