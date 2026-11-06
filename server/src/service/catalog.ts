/** 端点、凭证、绑定的几条前置条件：绑定还指着的凭证不让删，没绑定就不让发请求。 */

import type { Database } from 'bun:sqlite'

import { BINDING_ROLE_LABEL, PER_PROJECT_ROLES, type BindingRole } from '@vesper/shared'

import { Conflict } from '../domain/errors'
import { countBindingsWith, deleteCredential as removeCredential, findBinding, getCredential, getEndpoint, upsertBinding, type Binding, type EndpointView } from '../repo/catalog'

const MODALITY_OF: Readonly<Record<BindingRole, EndpointView['kind']>> = { text: 'text', image: 'image', video: 'video', tts: 'audio' }

export function deleteCredential(db: Database, id: string): void {
  getCredential(db, id)
  const used = countBindingsWith(db, id)
  if (used > 0) throw new Conflict(`该凭证仍被 ${used} 处使用，请先解除绑定`)
  removeCredential(db, id)
}

export function setBinding(db: Database, projectId: string | null, role: BindingRole, input: { endpointId: string; credentialId: string; params?: Record<string, unknown> | undefined }): void {
  if (projectId !== null && !PER_PROJECT_ROLES.includes(role)) throw new Conflict(`「${BINDING_ROLE_LABEL[role]}」仅支持全局配置，不能按作品单独设置`)
  // 端点与凭证都要先存在，否则绑定要到生成时才报错。
  const endpoint = getEndpoint(db, input.endpointId)
  if (endpoint.kind !== MODALITY_OF[role]) throw new Conflict(`「${endpoint.name}」不能用作${BINDING_ROLE_LABEL[role]}`)
  getCredential(db, input.credentialId)
  upsertBinding(db, projectId, role, input)
}

/** 先找作品自己的绑定，没有再用全局的。 */
export function resolveBinding(db: Database, projectId: string, role: BindingRole): Binding {
  const own = PER_PROJECT_ROLES.includes(role) ? findBinding(db, projectId, role) : null
  const binding = own ?? findBinding(db, null, role)
  if (!binding) throw new Conflict(`「${BINDING_ROLE_LABEL[role]}」尚未配置接口，请先在设置中配置`)
  return binding
}
