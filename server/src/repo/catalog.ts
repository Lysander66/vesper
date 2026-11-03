/** 端点、凭证、绑定三张表的读写。凭证列表不回 api_key。 */

import type { Database } from 'bun:sqlite'

import { BINDING_ROLES, PER_PROJECT_ROLES, type BindingRole } from '@vesper/shared'

import { NotFound, nowIso, parseJson } from './common'
import { newId } from '../db/id'
import type { CredentialRow, EndpointRow } from '../db/records'
import { parseDefinition, type EndpointDefinition } from '../endpoint/types'

export interface BindingRow {
  readonly id: string
  readonly project_id: string | null
  readonly role: BindingRole
  readonly endpoint_id: string
  readonly credential_id: string
  readonly params: string
  readonly updated_at: string
}

export interface EndpointView {
  readonly id: string
  readonly name: string
  readonly kind: EndpointRow['kind']
  readonly definition: EndpointDefinition
}

export function upsertEndpoint(db: Database, name: string, raw: unknown): string {
  const kind = parseDefinition(raw).modality

  const at = nowIso()
  const existing = db.query('SELECT id FROM endpoints WHERE name = ?').get(name) as { id: string } | null
  if (existing) {
    db.query('UPDATE endpoints SET kind = ?, definition = ?, updated_at = ? WHERE id = ?').run(
      kind,
      JSON.stringify(raw),
      at,
      existing.id,
    )
    return existing.id
  }
  const id = newId('endpoint')
  db.query('INSERT INTO endpoints (id, name, kind, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    name,
    kind,
    JSON.stringify(raw),
    at,
    at,
  )
  return id
}

/** 删掉目录里已经没有的端点，仍被调用记录引用的保留。 */
export function pruneEndpoints(db: Database, keep: readonly string[]): string[] {
  if (keep.length === 0) return []
  const holes = keep.map(() => '?').join(', ')
  const rows = db
    .query(
      `SELECT id, name FROM endpoints
       WHERE name NOT IN (${holes})
         AND id NOT IN (SELECT endpoint_id FROM jobs)
         AND id NOT IN (SELECT endpoint_id FROM bindings)`,
    )
    .all(...keep) as Array<{ id: string; name: string }>

  const remove = db.query('DELETE FROM endpoints WHERE id = ?')
  for (const row of rows) remove.run(row.id)
  return rows.map((row) => row.name)
}

export function listEndpoints(db: Database): EndpointView[] {
  const rows = db.query('SELECT * FROM endpoints ORDER BY name').all() as EndpointRow[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    definition: parseDefinition(JSON.parse(row.definition)),
  }))
}

export function getEndpoint(db: Database, id: string): EndpointView {
  const row = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as EndpointRow | null
  if (!row) throw new NotFound(`端点 ${id}`)
  return { id: row.id, name: row.name, kind: row.kind, definition: parseDefinition(JSON.parse(row.definition)) }
}

export interface CredentialView {
  readonly id: string
  readonly name: string
  readonly base_url: string
  readonly created_at: string
  readonly binding_count: number
}

export function createCredential(db: Database, input: { name: string; baseUrl: string; apiKey: string }): string {
  const id = newId('cred')
  db.query('INSERT INTO credentials (id, name, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    input.name,
    input.baseUrl,
    input.apiKey,
    nowIso(),
  )
  return id
}

/** api_key 留空表示不改，界面读不回原值。 */
export function updateCredential(db: Database, id: string, input: { name: string; baseUrl: string; apiKey: string | undefined }): void {
  getCredential(db, id)
  if (input.apiKey === undefined) {
    db.query('UPDATE credentials SET name = ?, base_url = ? WHERE id = ?').run(input.name, input.baseUrl, id)
    return
  }
  db.query('UPDATE credentials SET name = ?, base_url = ?, api_key = ? WHERE id = ?').run(
    input.name,
    input.baseUrl,
    input.apiKey,
    id,
  )
}

/** 不含 api_key，按创建顺序排。 */
export function listCredentials(db: Database): CredentialView[] {
  return db
    .query(
      `SELECT c.id, c.name, c.base_url, c.created_at, (SELECT COUNT(*) FROM bindings b WHERE b.credential_id = c.id) AS binding_count
       FROM credentials c WHERE c.deleted_at IS NULL ORDER BY c.created_at`,
    )
    .all() as CredentialView[]
}

export function getCredential(db: Database, id: string): CredentialRow {
  const row = db.query('SELECT * FROM credentials WHERE id = ? AND deleted_at IS NULL').get(id) as CredentialRow | null
  if (!row) throw new NotFound(`凭证 ${id}`)
  return row
}

/** 给导出 cURL 算打码形用，凭证已删时回 undefined。 */
export function findApiKey(db: Database, credentialId: string): string | undefined {
  const row = db.query('SELECT api_key FROM credentials WHERE id = ?').get(credentialId) as { api_key: string } | null
  return row?.api_key || undefined
}

export function countBindingsWith(db: Database, credentialId: string): number {
  return (db.query('SELECT COUNT(*) AS n FROM bindings WHERE credential_id = ?').get(credentialId) as { n: number }).n
}

/** 仍被调用记录引用时只标删除并清空密钥。 */
export function deleteCredential(db: Database, id: string): void {
  const cited = db.query('SELECT 1 FROM jobs WHERE credential_id = ? LIMIT 1').get(id)
  if (cited) db.query("UPDATE credentials SET deleted_at = ?, api_key = '' WHERE id = ?").run(nowIso(), id)
  else db.query('DELETE FROM credentials WHERE id = ?').run(id)
}

export interface Binding {
  readonly role: BindingRole
  readonly endpointId: string
  readonly credentialId: string
  readonly params: Record<string, unknown>
}

export function upsertBinding(db: Database, projectId: string | null, role: BindingRole, input: { endpointId: string; credentialId: string; params?: Record<string, unknown> | undefined }): void {
  const at = nowIso()
  const existing = db
    .query(`SELECT id FROM bindings WHERE COALESCE(project_id, '') = COALESCE(?, '') AND role = ?`)
    .get(projectId, role) as { id: string } | null

  if (existing) {
    db.query('UPDATE bindings SET endpoint_id = ?, credential_id = ?, params = ?, updated_at = ? WHERE id = ?').run(
      input.endpointId,
      input.credentialId,
      JSON.stringify(input.params ?? {}),
      at,
      existing.id,
    )
    return
  }
  db.query(
    'INSERT INTO bindings (id, project_id, role, endpoint_id, credential_id, params, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(newId('binding'), projectId, role, input.endpointId, input.credentialId, JSON.stringify(input.params ?? {}), at)
}

/** `projectId` 为 null 即全局默认。 */
export function findBinding(db: Database, projectId: string | null, role: BindingRole): Binding | null {
  const row = (
    projectId === null
      ? db.query('SELECT * FROM bindings WHERE project_id IS NULL AND role = ?').get(role)
      : db.query('SELECT * FROM bindings WHERE project_id = ? AND role = ?').get(projectId, role)
  ) as BindingRow | null
  if (!row) return null
  return {
    role,
    endpointId: row.endpoint_id,
    credentialId: row.credential_id,
    params: parseJson<Record<string, unknown>>(row.params, {}),
  }
}

/** 删掉作品自己的绑定，该角色改用全局默认。 */
export function removeBinding(db: Database, projectId: string, role: BindingRole): void {
  db.query('DELETE FROM bindings WHERE project_id = ? AND role = ?').run(projectId, role)
}

/** `projectId` 为 null 时只列全局默认。 */
export function listBindings(db: Database, projectId: string | null): (Binding & { inherited: 'yes' | 'no' })[] {
  return BINDING_ROLES.flatMap((role) => {
    const own = projectId !== null && PER_PROJECT_ROLES.includes(role) ? findBinding(db, projectId, role) : null
    const binding = own ?? findBinding(db, null, role)
    if (!binding) return []
    return [{ ...binding, inherited: (own ? 'no' : 'yes') as 'yes' | 'no' }]
  })
}

