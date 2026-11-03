/** 调用记录的读写。凭证遮蔽在这里统一做，调用点不必各自处理。 */

import type { Database } from 'bun:sqlite'

import type { CallSection, CurlExport, JobStatus, ModelCost, OwnerKind, Usage } from '@vesper/shared'

import { elideBase64 } from './elide'
import { readUsage, sumCosts } from '../domain/billing'
import { newId } from './id'
import { toCurl } from '../endpoint/curl'
import { maskSecret, redactHeaders, redactJson, redactText } from '../endpoint/redact'
import type { RenderedInputs, RenderedRequest } from '../endpoint/render'

export interface OwnerRef {
  readonly kind: OwnerKind
  readonly id: string
}

export interface CreateJobInput {
  readonly owner?: OwnerRef | undefined
  /** 同一归属下的用途，如 `first_frame`、`clip`、`voice`。 */
  readonly purpose?: string | undefined
  readonly endpointId: string
  readonly credentialId: string
  readonly params: Record<string, unknown>
  /** 素材入参，存本地文件的引用。 */
  readonly inputs: RenderedInputs
}

export interface CallOutcome {
  readonly section: CallSection
  readonly request: RenderedRequest
  readonly startedAt: Date
  readonly durationMs: number
  readonly statusCode?: number | undefined
  readonly responseHeaders?: Record<string, string> | undefined
  readonly responseBody?: unknown
  readonly error?: string | undefined
}

export interface JobRow {
  readonly id: string
  readonly owner_kind: OwnerKind | null
  readonly owner_id: string | null
  readonly purpose: string | null
  readonly endpoint_id: string
  readonly credential_id: string
  readonly params: string
  readonly inputs: string
  readonly status: JobStatus
  readonly provider_task_id: string | null
  readonly error: string | null
  readonly artifact_path: string | null
  readonly artifacts: string | null
  readonly extracted: string | null
  readonly created_at: string
  readonly finished_at: string | null
  /** {@link Usage} 的 JSON。http_calls 会按保留天数清掉，用量另存在这里。 */
  readonly usage: string | null
  /** 结束时记下的作品与集。重拆分镜会删镜头，之后无法再从归属推出。 */
  readonly project_id: string | null
  readonly episode_id: string | null
}

export interface CallRow {
  readonly id: number
  readonly job_id: string
  readonly seq: number
  readonly section: CallSection
  readonly method: string
  readonly url: string
  readonly request_headers: string
  readonly request_body: string | null
  readonly request_encoding: 'json' | 'multipart'
  readonly status_code: number | null
  readonly response_headers: string | null
  readonly response_body: string | null
  readonly started_at: string
  readonly duration_ms: number | null
  readonly error: string | null
}

export function createJob(db: Database, input: CreateJobInput): string {
  const id = newId('job')
  db.query(
    `INSERT INTO jobs (id, owner_kind, owner_id, purpose, endpoint_id, credential_id, params, inputs, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(
    id,
    input.owner?.kind ?? null,
    input.owner?.id ?? null,
    input.purpose ?? null,
    input.endpointId,
    input.credentialId,
    JSON.stringify(input.params),
    JSON.stringify(input.inputs),
    new Date().toISOString(),
  )
  return id
}

/** 落一次 HTTP 往返。`secrets` 是本次用到的凭证原文，用于精确遮蔽。返回该 job 内的序号。 */
export function recordCall(db: Database, jobId: string, outcome: CallOutcome, secrets: readonly string[] = []): number {
  return db.transaction(() => {
    const row = db.query('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM http_calls WHERE job_id = ?').get(jobId) as {
      max_seq: number
    }
    const seq = row.max_seq + 1
    db.query(
      `INSERT INTO http_calls
         (job_id, seq, section, method, url, request_headers, request_body, request_encoding,
          status_code, response_headers, response_body, started_at, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId,
      seq,
      outcome.section,
      outcome.request.method,
      redactText(outcome.request.url, secrets),
      JSON.stringify(redactHeaders(outcome.request.headers, secrets)),
      outcome.request.body === null || outcome.request.body === undefined
        ? null
        : JSON.stringify(redactJson(outcome.request.body, secrets)),
      outcome.request.encoding ?? 'json',
      outcome.statusCode ?? null,
      outcome.responseHeaders ? JSON.stringify(redactHeaders(outcome.responseHeaders, secrets)) : null,
      outcome.responseBody === undefined
        ? null
        : JSON.stringify(redactJson(elideBase64(outcome.responseBody), secrets)),
      outcome.startedAt.toISOString(),
      outcome.durationMs,
      outcome.error ? redactText(outcome.error, secrets) : null,
    )
    return seq
  })()
}

export interface JobPatch {
  readonly status?: JobStatus | undefined
  readonly providerTaskId?: string | undefined
  readonly artifactPath?: string | undefined
  readonly artifacts?: readonly string[] | undefined
  readonly extracted?: Record<string, unknown> | undefined
  readonly error?: string | undefined
}

export function updateJob(db: Database, jobId: string, patch: JobPatch, secrets: readonly string[] = []): void {
  const terminal = patch.status === 'succeeded' || patch.status === 'failed' || patch.status === 'cancelled'
  db.query(
    `UPDATE jobs SET
       status           = COALESCE(?, status),
       provider_task_id = COALESCE(?, provider_task_id),
       artifact_path    = COALESCE(?, artifact_path),
       artifacts        = COALESCE(?, artifacts),
       extracted        = COALESCE(?, extracted),
       error            = COALESCE(?, error),
       finished_at      = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END
     WHERE id = ?`,
  ).run(
    patch.status ?? null,
    patch.providerTaskId ?? null,
    patch.artifactPath ?? null,
    patch.artifacts ? JSON.stringify(patch.artifacts) : null,
    // 不少供应商把签名地址原样回在响应里，签名串里带着 key。
    patch.extracted ? JSON.stringify(redactJson(elideBase64(patch.extracted), secrets)) : null,
    patch.error ? redactText(patch.error, secrets) : null,
    terminal ? 1 : 0,
    new Date().toISOString(),
    jobId,
  )
  if (terminal) saveUsage(db, jobId)
}

/** 从各次响应整理用量写回 jobs.usage。失败的调用也可能已扣费，照样记。 */
function saveUsage(db: Database, jobId: string): void {
  const row = db
    .query('SELECT e.kind, e.definition, j.params FROM jobs j JOIN endpoints e ON e.id = j.endpoint_id WHERE j.id = ?')
    .get(jobId) as { kind: EndpointRow['kind']; definition: string; params: string } | null
  if (!row) return
  const bodies = (
    db.query('SELECT response_body FROM http_calls WHERE job_id = ? AND response_body IS NOT NULL ORDER BY seq').all(jobId) as {
      response_body: string
    }[]
  ).map((call) => parseJson(call.response_body))
  // 没改过型号的任务 params 里不带 model，发出去的是端点默认值。
  const params = parseJson(row.params) as { model?: unknown } | null
  const definition = parseJson(row.definition) as { defaults?: { model?: unknown } } | null
  const model = params?.model ?? definition?.defaults?.model
  const usage = readUsage(row.kind, typeof model === 'string' ? model : '', bodies)
  db.query(
    `UPDATE jobs SET
       usage      = ?,
       project_id = ${PROJECT_OF_OWNER},
       episode_id = CASE owner_kind
         WHEN 'episode' THEN owner_id
         WHEN 'shot'    THEN (SELECT episode_id FROM shots WHERE id = owner_id)
       END
     WHERE id = ?`,
  ).run(usage ? JSON.stringify(usage) : null, jobId)
}

export function parseUsage(job: Pick<JobRow, 'usage'>): Usage | null {
  return job.usage ? (JSON.parse(job.usage) as Usage) : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export interface EndpointRow {
  readonly id: string
  readonly name: string
  readonly kind: 'image' | 'video' | 'text' | 'audio'
  readonly definition: string
  readonly created_at: string
  readonly updated_at: string
}

export interface CredentialRow {
  readonly id: string
  readonly name: string
  readonly base_url: string
  readonly api_key: string
  readonly created_at: string
}

export interface JobContext {
  readonly job: JobRow
  readonly endpoint: EndpointRow
  readonly credential: CredentialRow
}

/** 一个 job 复现自身所需的全部数据，首跑与重启续跑共用。 */
export function loadJobContext(db: Database, jobId: string): JobContext | null {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | null
  if (!job) return null
  const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(job.endpoint_id) as EndpointRow | null
  const credential = db.query('SELECT * FROM credentials WHERE id = ?').get(job.credential_id) as CredentialRow | null
  if (!endpoint || !credential) return null
  return { job, endpoint, credential }
}

export function loadCall(db: Database, callId: number): CallRow | null {
  return db.query('SELECT * FROM http_calls WHERE id = ?').get(callId) as CallRow | null
}

/** 调用记录与本地命令共用的过滤条件。 */
export interface RecordFilter {
  readonly ownerKind?: OwnerKind | undefined
  readonly ownerId?: string | undefined
  readonly limit?: number | undefined
}

export const RECORD_LIMIT = 100

/** 由 `owner_kind` / `owner_id` 两列推出所属作品的 SQL 表达式。 */
export const PROJECT_OF_OWNER = `CASE owner_kind
  WHEN 'project' THEN owner_id
  WHEN 'episode' THEN (SELECT project_id FROM episodes WHERE id = owner_id)
  WHEN 'shot'    THEN (SELECT e.project_id FROM shots s JOIN episodes e ON e.id = s.episode_id WHERE s.id = owner_id)
  WHEN 'asset'   THEN (SELECT project_id FROM assets WHERE id = owner_id)
END`

/** 按作品或集过滤时连带下级的记录。jobs 另按结束时记下的 project_id / episode_id 匹配，重拆分镜前的调用也算在内。 */
export function recordScope(filter: RecordFilter, table: 'jobs' | 'commands'): { where: string; args: string[] } {
  const { ownerKind: kind, ownerId: id } = filter
  if (!kind || !id) return { where: '1 = 1', args: [] }
  const jobs = table === 'jobs'
  if (kind === 'project') return { where: `${jobs ? 'project_id = ?1 OR ' : ''}(${PROJECT_OF_OWNER}) = ?1`, args: [id] }
  if (kind === 'episode') {
    return {
      where: `${jobs ? 'episode_id = ?1 OR ' : ''}(owner_kind = 'episode' AND owner_id = ?1) OR (owner_kind = 'shot' AND owner_id IN (SELECT id FROM shots WHERE episode_id = ?1))`,
      args: [id],
    }
  }
  return { where: 'owner_kind = ?1 AND owner_id = ?2', args: [kind, id] }
}

export function listJobs(db: Database, filter: RecordFilter): JobRow[] {
  const { where, args } = recordScope(filter, 'jobs')
  return db
    .query(`SELECT * FROM jobs WHERE (${where}) ORDER BY created_at DESC LIMIT ?`)
    .all(...args, filter.limit ?? RECORD_LIMIT) as JobRow[]
}

/** 范围内全部调用的花费，不受列表条数限制。 */
export function jobsCost(db: Database, filter: RecordFilter): ModelCost[] {
  const { where, args } = recordScope(filter, 'jobs')
  const rows = db.query(`SELECT usage, status FROM jobs WHERE usage IS NOT NULL AND (${where})`).all(...args) as Pick<JobRow, 'usage' | 'status'>[]
  return sumCosts(rows.map((row) => ({ usage: parseUsage(row), status: row.status })))
}

export function loadJob(db: Database, jobId: string): { job: JobRow; calls: CallRow[] } | null {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | null
  if (!job) return null
  const calls = db.query('SELECT * FROM http_calls WHERE job_id = ? ORDER BY seq').all(jobId) as CallRow[]
  return { job, calls }
}

/** 从已落库的往返重建 cURL，凭证以环境变量引用。 */
export function curlForCall(call: CallRow, apiKey?: string): CurlExport {
  return toCurl(requestOfCall(call), { apiKey: apiKey ? maskSecret(apiKey) : undefined })
}

/** 导出为 `tools/send.ts` 的入参。素材仍是路径，凭证仍是打码值，由脚本按环境变量换回。 */
export function requestJsonForCall(call: CallRow): string {
  return JSON.stringify(requestOfCall(call), null, 2)
}

function requestOfCall(call: CallRow): RenderedRequest {
  return {
    method: call.method,
    url: call.url,
    headers: JSON.parse(call.request_headers) as Record<string, string>,
    body: call.request_body === null ? null : (JSON.parse(call.request_body) as unknown),
    encoding: call.request_encoding,
  }
}
