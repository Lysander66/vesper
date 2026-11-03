import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BINDING_ROLE_LABEL, type Binding, type BindingRole, type Credential, type EndpointDefinition, type EndpointSummary } from '@vesper/shared'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PickOrType } from '@/components/ui/pick-or-type'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const ROLE_MODALITY: Record<BindingRole, EndpointSummary['kind']> = {
  text: 'text',
  image: 'image',
  video: 'video',
  tts: 'audio',
}

export function BindingForm({
  role,
  current,
  endpoints,
  credentials,
  onDone,
}: {
  role: BindingRole
  current: Binding | null
  endpoints: EndpointSummary[]
  credentials: Credential[]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const preselect = current ? undefined : endpoints.find((endpoint) => endpoint.definition.meta?.preferred === 'yes')
  const [endpointId, setEndpointId] = useState(current?.endpoint_id ?? preselect?.id ?? '')
  const [model, setModel] = useState(typeof current?.params.model === 'string' ? current.params.model : modelOf(preselect))
  const [credentialId, setCredentialId] = useState(() => current?.credential_id ?? credentialsFor(credentials, preselect?.definition)[0]?.id ?? '')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState(preselect?.definition.meta?.hints?.base_url ?? '')
  const [apiKey, setApiKey] = useState('')

  const definition = endpoints.find((endpoint) => endpoint.id === endpointId)?.definition
  const models = definition?.capabilities?.models ?? []
  const fresh = credentialId === ''

  const save = useMutation({
    mutationFn: async () => {
      const id = fresh ? (await api.createCredential({ name, base_url: baseUrl, api_key: apiKey })).id : credentialId
      // 其余端点参数（分辨率等）原样带回，换型号不该把它们抹掉。
      const params = { ...current?.params }
      if (model) params.model = model
      else delete params.model
      await api.setBinding({ project_id: null, role, endpoint_id: endpointId, credential_id: id, params })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success('已保存')
      onDone()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const pickEndpoint = (id: string) => {
    const picked = endpoints.find((endpoint) => endpoint.id === id)
    setEndpointId(id)
    // 型号与 API 凭证都不跨端点通用：沿用上一家的会得到 400 或 401。
    setModel(modelOf(picked))
    setCredentialId(credentialsFor(credentials, picked?.definition)[0]?.id ?? '')
    setBaseUrl(picked?.definition.meta?.hints?.base_url ?? '')
  }

  const clash = fresh && hasBaseUrlClash(name, baseUrl, credentials)
  const incomplete = !endpointId || (fresh && (!baseUrl || !apiKey || clash))

  return (
    <div className='space-y-3 border-b pb-4 last:border-0'>
      <p className='text-sm font-medium'>{BINDING_ROLE_LABEL[role]}</p>

      <Field label='调用方式'>
        <Select value={endpointId} onValueChange={pickEndpoint}>
          <SelectTrigger className='w-full'>
            <SelectValue placeholder='选择调用方式' />
          </SelectTrigger>
          <SelectContent>
            {endpoints.map((endpoint) => (
              <SelectItem key={endpoint.id} value={endpoint.id}>
                {endpoint.definition.meta?.title ?? endpoint.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {endpointId && models.length > 0 && (
        <Field label='模型'>
          <PickOrType value={model} options={models} onChange={setModel} placeholder='或填列表外的模型' />
        </Field>
      )}

      {credentials.length > 0 && (
        <Field label='API 凭证'>
          <div className='flex flex-wrap gap-1.5'>
            {credentialsFor(credentials, definition).map((credential) => (
              <Button key={credential.id} type='button' size='sm' variant={credentialId === credential.id ? 'default' : 'outline'} onClick={() => setCredentialId(credential.id)}>
                {credential.name || credential.base_url}
              </Button>
            ))}
            <Button type='button' size='sm' variant={fresh ? 'default' : 'outline'} onClick={() => setCredentialId('')}>
              添加
            </Button>
          </div>
        </Field>
      )}

      {fresh ? (
        <>
          <Field label='名称'>
            <Input value={name} placeholder={clash ? CLASH_PLACEHOLDER : '留空则显示 Base URL'} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label='Base URL'>
            <Input className='font-mono text-xs' value={baseUrl} placeholder='https://api.example.com' onChange={(event) => setBaseUrl(event.target.value)} />
          </Field>
          <Field label='API Key'>
            <Input type='password' value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </Field>
        </>
      ) : (
        <Field label='Base URL'>
          <p className='truncate font-mono text-xs text-muted-foreground'>{credentials.find((item) => item.id === credentialId)?.base_url}</p>
        </Field>
      )}

      <div className='flex justify-end gap-2'>
        <Button variant='ghost' size='sm' onClick={onDone}>
          取消
        </Button>
        <Button size='sm' disabled={incomplete || save.isPending} onClick={() => save.mutate()}>
          保存
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='grid gap-1.5 md:grid-cols-[6rem_minmax(0,1fr)] md:items-center md:gap-3'>
      <Label className='text-xs text-muted-foreground'>{label}</Label>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}

export const CLASH_PLACEHOLDER = '该 Base URL 已存在，请填写名称以区分'

export function hasBaseUrlClash(name: string, baseUrl: string, others: readonly Credential[]): boolean {
  return name === '' && others.some((item) => item.base_url === baseUrl)
}

export function endpointsFor(all: EndpointSummary[] | undefined, modality: EndpointSummary['kind']): EndpointSummary[] {
  const list = all?.filter((endpoint) => endpoint.kind === modality) ?? []
  return list.sort((a, b) => weightOf(b) - weightOf(a))
}

function weightOf(endpoint: EndpointSummary): number {
  const meta = endpoint.definition.meta
  if (meta?.preferred === 'yes') return 2
  return meta?.legacy === 'yes' ? 0 : 1
}

function credentialsFor(all: Credential[], definition: EndpointDefinition | undefined): Credential[] {
  const host = hostOf(definition?.meta?.hints?.base_url)
  if (host === null) return all
  return [...all].sort((a, b) => Number(hostOf(b.base_url) === host) - Number(hostOf(a.base_url) === host))
}

function hostOf(url: string | undefined): string | null {
  if (url === undefined || url === '') return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function modelOf(endpoint: EndpointSummary | undefined): string {
  const model = endpoint?.definition.defaults?.model
  return typeof model === 'string' ? model : ''
}

export function titleOf(endpoints: EndpointSummary[], id: string): string | undefined {
  return endpoints.find((endpoint) => endpoint.id === id)?.definition.meta?.title
}

/** 「跟随全局」不是存下来的值，而是没有本作品的绑定，所以选它即删除绑定。 */
export function EndpointPicker({ projectId, role, bindings, className }: { projectId: string; role: BindingRole; bindings: readonly Binding[]; className?: string }) {
  const queryClient = useQueryClient()
  const endpoints = useQuery({ queryKey: ['endpoints'], queryFn: api.endpoints })
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: api.credentials })

  const options = endpointsFor(endpoints.data, ROLE_MODALITY[role])
  const current = bindings.find((binding) => binding.role === role) ?? null
  const own = current?.inherited === 'no' ? current : null

  const pick = useMutation({
    mutationFn: async (endpointId: string) => {
      if (endpointId === '') return api.clearBinding(projectId, role)
      const endpoint = options.find((item) => item.id === endpointId)
      const credential = credentialsFor(credentials.data ?? [], endpoint?.definition)[0]
      if (!credential) throw new Error('暂无可用的 API 凭证，请先在设置页添加')
      const params = own?.endpoint_id === endpointId ? { ...own.params } : {}
      return api.setBinding({
        project_id: projectId,
        role,
        endpoint_id: endpointId,
        credential_id: credential.id,
        params,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success('已更新')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className={cn('min-w-56 flex-1 space-y-1.5', className)}>
      <Label className='text-xs'>{BINDING_ROLE_LABEL[role]}</Label>
      <Select value={own?.endpoint_id ?? ''} disabled={pick.isPending} onValueChange={(next) => pick.mutate(next)}>
        <SelectTrigger className='w-full bg-card'>
          <BindingLine options={options} binding={own ?? current} inherited={own === null} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value=''>
            <BindingLine options={options} binding={current} inherited />
          </SelectItem>
          {options.map((endpoint) => (
            <SelectItem key={endpoint.id} value={endpoint.id}>
              {endpoint.definition.meta?.title ?? endpoint.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function BindingLine({ options, binding, inherited }: { options: EndpointSummary[]; binding: Binding | null; inherited: boolean }) {
  return (
    <span className='flex min-w-0 items-center gap-1.5'>
      {inherited && <span className='shrink-0 text-ink3'>跟随全局 ·</span>}
      <span className={cn('truncate', binding === null && 'text-ink3')}>{binding === null ? '未配置' : (titleOf(options, binding.endpoint_id) ?? binding.endpoint_name)}</span>
    </span>
  )
}
