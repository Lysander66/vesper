/** 执行器测试用本地 mock 供应商，真实发出请求，才能同时检查落库内容与对方收到的内容。 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import type { Server } from 'bun'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase } from '../src/db/schema'
import { createJob, loadJob, updateJob } from '../src/db/records'
import { assetRefFromFile } from '../src/endpoint/asset'
import { executeJob } from '../src/runner/execute'
import { AMBIGUOUS_SUBMIT_ERROR, classifyPendingJobs } from '../src/runner/resume'
import { recover } from '../src/pipeline/recover'
import { DEFAULT_POLL_POLICY, type Clock, type PollPolicy } from '../src/runner/policy'

type MockServer = Server<undefined>

const API_KEY = 'sk-mock-key-abcdefgh'
const VIDEO_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0x2a)])

interface RecordedRequest {
  readonly method: string
  readonly authorization: string | null
  readonly body: unknown
}

interface Mock {
  readonly server: MockServer
  readonly url: string
  readonly requests: RecordedRequest[]
}

/** 提交即受理，轮询两次在跑、第三次成功，再下载。 */
function startMock(): Mock {
  const requests: RecordedRequest[] = []
  let polls = 0

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === 'POST' ? ((await request.json()) as unknown) : null
      requests.push({
        method: request.method,
        authorization: request.headers.get('authorization'),
        body,
      })

      if (url.pathname.endsWith('/video_generation') && request.method === 'POST') {
        return Response.json({ task_id: 'task-abc' })
      }
      if (url.pathname.includes('/query/video_generation/')) {
        polls += 1
        const status = polls < 3 ? { status: 'running' } : { status: 'succeeded', content: { url: `${url.origin}/files/out.mp4` } }
        return Response.json({ task: status })
      }
      if (url.pathname === '/files/out.mp4') {
        return new Response(VIDEO_BYTES, { headers: { 'Content-Type': 'video/mp4' } })
      }
      return new Response('not found', { status: 404 })
    },
  })

  return { server, url: `http://localhost:${server.port}`, requests }
}

/** 虚拟时钟：sleep 只推进时间。 */
function fakeClock(): Clock {
  let current = 0
  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms
    },
  }
}

let db: Database
let mock: Mock
let artifactDir: string
let assetPath: string

const FAST: PollPolicy = { ...DEFAULT_POLL_POLICY, overallTimeoutMs: 60_000, requestTimeoutMs: 5_000 }

/** 首帧按来源名 `start_image` 传入，minimax 定义里的输入名是 `first_frame`。 */
async function seedJob(): Promise<string> {
  const now = new Date().toISOString()
  const definition = await Bun.file(new URL('../endpoints/minimax-h3.json', import.meta.url)).text()
  db.query('INSERT INTO endpoints VALUES (?, ?, ?, ?, ?, ?)').run('ep-1', 'H3', 'video', definition, now, now)
  db.query('INSERT INTO credentials (id, name, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run('cr-1', 'mock', mock.url, API_KEY, now)
  return createJob(db, {
    owner: { kind: 'shot', id: 'shot-1' },
    purpose: 'clip',
    endpointId: 'ep-1',
    credentialId: 'cr-1',
    params: { model: 'H3', prompt: '镜头缓缓推近', duration: 6, aspect_ratio: '16:9' },
    inputs: { start_image: await assetRefFromFile(assetPath) },
  })
}

function run(jobId: string) {
  return executeJob(db, jobId, { artifactDir, policy: FAST, clock: fakeClock(), random: () => 0 })
}

beforeEach(async () => {
  db = openDatabase(':memory:')
  mock = startMock()
  artifactDir = await mkdtemp(join(tmpdir(), 'vesper-artifacts-'))
  const assetDir = await mkdtemp(join(tmpdir(), 'vesper-assets-'))
  assetPath = join(assetDir, 'frame.png')
  await Bun.write(assetPath, PNG_BYTES)
})

afterEach(() => {
  mock.server.stop(true)
})

describe('落库与实际发送', () => {
  test('落库的是素材引用，发出的是 base64', async () => {
    const jobId = await seedJob()
    await run(jobId)

    const submitted = mock.requests.find((r) => r.method === 'POST')!
    const content = (submitted.body as { content: Array<{ image_url?: { url: string } }> }).content
    const wire = content.find((item) => item.image_url)!.image_url!.url
    expect(wire).toStartWith('data:image/png;base64,')

    const record = loadJob(db, jobId)!.calls[0]!
    expect(record.request_body).toContain(assetPath)
    expect(record.request_body).not.toContain('base64,')
  })

  test('凭证随请求发出，落库与产物地址里都没有原文', async () => {
    const jobId = await seedJob()
    await run(jobId)

    expect(mock.requests[0]!.authorization).toBe(`Bearer ${API_KEY}`)
    for (const call of loadJob(db, jobId)!.calls) {
      expect(call.request_headers).not.toContain(API_KEY)
      expect(call.url).not.toContain(API_KEY)
    }
  })
})

describe('重启续跑', () => {
  test('已受理的任务只续轮询，不重发提交', async () => {
    const jobId = await seedJob()
    updateJob(db, jobId, { status: 'running', providerTaskId: 'task-abc' })

    const outcome = await run(jobId)

    expect(outcome.status).toBe('succeeded')
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0)
    expect(loadJob(db, jobId)!.calls.every((c) => c.section !== 'submit')).toBe(true)
  })

  test('提交结果未知的任务标记失败并说明原因，不重发', async () => {
    const jobId = await seedJob()
    updateJob(db, jobId, { status: 'running' })

    const { ambiguous } = classifyPendingJobs(db)
    expect(ambiguous.map((r) => r.id)).toEqual([jobId])

    const report = await recover(db, { artifactDir, policy: FAST, clock: fakeClock(), random: () => 0 })
    expect(report.abandoned).toEqual([jobId])
    expect(mock.requests).toHaveLength(0)
    expect(loadJob(db, jobId)!.job.error).toBe(AMBIGUOUS_SUBMIT_ERROR)
  })
})
