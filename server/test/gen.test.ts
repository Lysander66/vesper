/** 发出参数的合并顺序。端点连不上，但 job 行在发出前已经落库，检查的就是这一行。 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'

import { loadJob } from '../src/db/records'
import { openDatabase } from '../src/db/schema'
import { GenFailure, generate, isModerationRejection, maxDuration, type GenContext } from '../src/pipeline/gen'
import { createCredential, upsertBinding, upsertEndpoint } from '../src/repo/catalog'
import { createProject } from '../src/repo/projects'
import { startRun } from '../src/repo/runs'

let db: Database
let ctx: GenContext

/** 连不上的地址，提交立即失败且不重试。 */
const DEAD = 'http://127.0.0.1:1'

beforeEach(() => {
  db = openDatabase(':memory:')
  const projectId = createProject(db, { name: '雪夜', style: '日系漫剧风格' })
  const endpointId = upsertEndpoint(db, 'fake-image', {
    kind: 'declarative',
    modality: 'image',
    schema_version: '1.0.0',
    submit: { method: 'POST', url: `${DEAD}/draw`, response: 'binary' },
  })
  const credentialId = createCredential(db, { name: 'x', baseUrl: DEAD, apiKey: 'sk-abc' })
  upsertBinding(db, null, 'image', { endpointId, credentialId, params: { model: 'draw-1', prompt: '绑定里不该有的' } })
  ctx = {
    db,
    projectId,
    runId: startRun(db, { kind: 'project', id: projectId }, 'test'),
    artifactDir: '/tmp/vesper-unused',
  }
})

/** 发一次，取回落库的 params。 */
async function sent(patch: Partial<GenContext>, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const failure = (await generate({ ...ctx, ...patch }, {
    owner: { kind: 'shot', id: 'shot-1' },
    purpose: 'first_frame',
    role: 'image',
    params,
    label: '首帧',
  }).catch((error: unknown) => error)) as GenFailure
  expect(failure).toBeInstanceOf(GenFailure)
  return JSON.parse(loadJob(db, failure.jobId)!.job.params) as Record<string, unknown>
}

describe('参数合并', () => {
  test('调用点给的 prompt 覆盖绑定里的', async () => {
    expect(await sent({}, { prompt: '算出来的那段' })).toMatchObject({ model: 'draw-1', prompt: '算出来的那段' })
  })

  test('人工改写的提示词按 purpose 生效', async () => {
    expect((await sent({ promptText: { first_frame: '手写的那段' } }, { prompt: '算出来的那段' })).prompt).toBe('手写的那段')
    expect((await sent({ promptText: { clip: '手写的那段' } }, { prompt: '算出来的那段' })).prompt).toBe('算出来的那段')
  })
})

describe('审核拒绝的识别', () => {
  test('识别各供应商的审核拒绝，普通网络错误不算', () => {
    expect(isModerationRejection('提交失败：HTTP 400 Bad Request — Your request was rejected by the safety system.')).toBe(true)
    expect(isModerationRejection('提交失败：输入内容涉及敏感信息')).toBe(true)
    expect(isModerationRejection('提交失败：TypeError: ECONNRESET')).toBe(false)
  })
})

describe('端点单次最长时长', () => {
  test('区间取上限，档位取最大一档，不接受时长时没有上限', () => {
    expect(maxDuration({ durations: { min: 4, max: 15 } })).toBe(15)
    expect(maxDuration({ durations: [10, 5] })).toBe(10)
    expect(maxDuration({ durations: [] })).toBeUndefined()
    expect(maxDuration({})).toBeUndefined()
  })
})
