import { BINDING_ROLES, type BindingRole } from '@vesper/shared'

import type { Database } from 'bun:sqlite'

import { BadRequest, body, json, query, z, type Register } from '../http'
import { bindingViews } from '../views'
import { createCredential, listCredentials, listEndpoints, removeBinding, updateCredential } from '../../repo/catalog'
import { deleteCredential, setBinding } from '../../service/catalog'
import { PROMPT_TEMPLATES } from '../../pipeline/prompts'

export function registerCatalog(on: Register, db: Database): void {
  on('GET', '/api/endpoints', () => json(listEndpoints(db)))
  // 前端按模板的参数说明生成输入框。
  on('GET', '/api/prompts', () => json(PROMPT_TEMPLATES))
  on('GET', '/api/credentials', () => json(listCredentials(db)))

  // 名称留空时界面显示 Base URL。
  on('POST', '/api/credentials', async (request) => {
    const input = await body(
      request,
      z.object({ name: z.string(), base_url: z.string().min(1), api_key: z.string().min(1) }),
    )
    const id = createCredential(db, { name: input.name, baseUrl: input.base_url, apiKey: input.api_key })
    return json({ id }, 201)
  })

  on('PATCH', '/api/credentials/:id', async (request, params) => {
    const input = await body(
      request,
      z.object({ name: z.string(), base_url: z.string().min(1), api_key: z.string().min(1).optional() }),
    )
    updateCredential(db, params.id ?? '', { name: input.name, baseUrl: input.base_url, apiKey: input.api_key })
    return json({ updated: 'yes' })
  })

  on('DELETE', '/api/credentials/:id', (_request, params) => {
    deleteCredential(db, params.id ?? '')
    return json({ deleted: 'yes' })
  })

  // 带 project_id 时返回该作品实际生效的绑定：作品级设置加继承的全局项。
  on('GET', '/api/bindings', (request) => json(bindingViews(db, query(request, 'project_id') ?? null)))

  on('PUT', '/api/bindings', async (request) => {
    const input = await body(
      request,
      z.object({
        project_id: z.string().nullable().default(null),
        role: z.enum(BINDING_ROLES),
        endpoint_id: z.string().min(1),
        credential_id: z.string().min(1),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    setBinding(db, input.project_id, input.role, {
      endpointId: input.endpoint_id,
      credentialId: input.credential_id,
      params: input.params,
    })
    return json({ ok: 'yes' })
  })

  // 只删作品级绑定，删后使用全局默认。全局绑定只能修改，不能删除。
  on('DELETE', '/api/bindings', (request) => {
    const projectId = query(request, 'project_id') ?? ''
    const role = query(request, 'role') ?? ''
    if (projectId === '') throw new BadRequest('缺少作品')
    if (!BINDING_ROLES.includes(role as BindingRole)) throw new BadRequest(`未知的模型类别 ${role}`)
    removeBinding(db, projectId, role as BindingRole)
    return json({ deleted: 'yes' })
  })
}
