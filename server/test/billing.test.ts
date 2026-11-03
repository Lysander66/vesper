import { beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'

import type { ModelCost } from '@vesper/shared'

import { createRouter } from '../src/api/routes'
import { createJob, recordCall, updateJob } from '../src/db/records'
import { openDatabase } from '../src/db/schema'
import { replaceShots, type ShotDraft } from '../src/repo/shots'

describe('作品花费', () => {
  let db: Database
  let route: (request: Request) => Promise<Response | undefined>

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

  async function get<T>(path: string): Promise<T> {
    const response = await route(new Request(`http://x${path}`))
    return (await response!.json()) as T
  }

  test('重拆分镜删掉镜头后，花在旧镜头上的钱仍算在这一集', async () => {
    const created = await route(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '雪夜', files: [{ name: '雪夜.txt', text: '雪下了一整夜。'.repeat(50) }], target_seconds: 60 }),
      }),
    )
    const view = (await created!.json()) as { project: { id: string }; sources: { episodes: { id: string }[] }[] }
    const projectId = view.project.id
    const episodeId = view.sources[0]!.episodes[0]!.id
    const [shotId] = replaceShots(db, episodeId, [DRAFT])

    const now = new Date().toISOString()
    db.query('INSERT INTO endpoints VALUES (?, ?, ?, ?, ?, ?)').run('ep-1', 'H3', 'video', '{}', now, now)
    db.query('INSERT INTO credentials (id, name, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run('cr-1', 'minimax', 'https://x', 'sk-1', now)
    const jobId = createJob(db, {
      owner: { kind: 'shot', id: shotId! },
      endpointId: 'ep-1',
      credentialId: 'cr-1',
      params: { model: 'MiniMax-H3' },
      inputs: {},
    })
    recordCall(db, jobId, {
      section: 'poll',
      request: { method: 'GET', url: 'https://x/v2/video_generation/t-1', headers: {}, body: null },
      startedAt: new Date(),
      durationMs: 1,
      statusCode: 200,
      responseBody: { task: { status: 'success', resolution: '768P', usage: { input_image_count: 1, output_seconds: 6 } } },
    })
    updateJob(db, jobId, { status: 'succeeded' })
    replaceShots(db, episodeId, [DRAFT])

    for (const owner of [`project&owner_id=${projectId}`, `episode&owner_id=${episodeId}`]) {
      expect(await get<ModelCost[]>(`/api/jobs/cost?owner_kind=${owner}`)).toEqual([{ model: 'MiniMax-H3', money: { CNY: 3 }, succeeded: 1, failed: 0 }])
      expect(await get<unknown[]>(`/api/jobs?owner_kind=${owner}`)).toHaveLength(1)
    }

    const [job] = await get<{ cost: unknown; usage: unknown }[]>('/api/jobs')
    expect(job).toMatchObject({ cost: { CNY: 3 }, usage: { kind: 'video', seconds: 6 } })
  })
})
