import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BINDING_ROLE_LABEL, BINDING_ROLES, type Binding, type BindingRole, type Credential, type EndpointSummary, type StorageEntry } from '@vesper/shared'
import { ExternalLink, FolderOpen, KeyRound, PencilLine, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EmptyState, LoadingState, PageHeader, Section } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { BindingForm, CLASH_PLACEHOLDER, endpointsFor, hasBaseUrlClash, ROLE_MODALITY, titleOf } from '@/components/binding-form'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <PageHeader title='设置' />
      <CredentialsCard />
      <RolesCard />
      <StorageCard />
    </div>
  )
}

function StorageCard() {
  const storage = useQuery({ queryKey: ['storage'], queryFn: api.storage })

  const reveal = useMutation({
    mutationFn: (key: StorageEntry['key'] | 'root') => api.reveal(key),
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Section title='数据目录' bodyClassName='space-y-4'>
      <div className='flex items-center gap-2 rounded-md border px-3 py-2'>
        <FolderOpen className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
        {storage.data ? <span className='flex-1 truncate font-mono text-xs'>{storage.data.root}</span> : <Skeleton className='h-4 flex-1' />}
        <span className='text-xs text-muted-foreground'>{formatBytes(storage.data?.total_bytes)}</span>
        {storage.data && <CopyButton text={storage.data.root} />}
        <Button variant='ghost' size='icon-sm' title='打开目录' aria-label='打开目录' className='text-muted-foreground' disabled={!storage.data} onClick={() => reveal.mutate('root')}>
          <ExternalLink className='h-3.5 w-3.5' />
        </Button>
      </div>

      <div className='space-y-1'>
        {storage.data?.entries.map((entry) => (
          <button key={entry.key} className='flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm hover:bg-line2' onClick={() => reveal.mutate(entry.key)}>
            <span className='w-28 shrink-0 font-mono text-xs'>{entry.label}</span>
            <span className='flex-1 truncate text-xs text-muted-foreground'>{entry.purpose}</span>
            <span className='w-20 shrink-0 text-right'>{formatBytes(entry.bytes)}</span>
            <span className='w-16 shrink-0 text-right text-xs text-muted-foreground'>{entry.key === 'db' ? '' : `${entry.files} 个`}</span>
          </button>
        ))}
      </div>

      <p className='text-xs text-muted-foreground'>
        设置环境变量 <code className='font-mono'>{storage.data?.env_var}</code> 可更改数据目录位置
      </p>
    </Section>
  )
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function RolesCard() {
  const endpoints = useQuery({ queryKey: ['endpoints'], queryFn: api.endpoints })
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: api.credentials })
  const bindings = useQuery({ queryKey: ['bindings'], queryFn: () => api.bindings() })

  return (
    <Section title='默认模型' bodyClassName='space-y-4'>
      {bindings.isPending ? (
        <LoadingState />
      ) : (
        BINDING_ROLES.map((role) => {
          const current = bindings.data?.find((binding) => binding.role === role)
          return (
            <RoleRow
              key={`${role}:${current?.endpoint_id ?? ''}:${current?.credential_id ?? ''}`}
              role={role}
              current={current ?? null}
              endpoints={endpointsFor(endpoints.data, ROLE_MODALITY[role])}
              credentials={credentials.data ?? []}
            />
          )
        })
      )}
    </Section>
  )
}

function RoleRow({ role, current, endpoints, credentials }: { role: BindingRole; current: Binding | null; endpoints: EndpointSummary[]; credentials: Credential[] }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return <BindingForm role={role} current={current} endpoints={endpoints} credentials={credentials} onDone={() => setEditing(false)} />
  }

  const credential = credentials.find((item) => item.id === current?.credential_id)
  const model = typeof current?.params.model === 'string' ? current.params.model : ''

  return (
    <div className='flex items-center gap-3 border-b pb-3 last:border-0'>
      <p className='w-16 shrink-0 text-sm font-medium'>{BINDING_ROLE_LABEL[role]}</p>
      {current ? (
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm'>{titleOf(endpoints, current.endpoint_id) ?? current.endpoint_name}</p>
          <p className='truncate text-xs text-muted-foreground'>
            {model && <span className='font-mono'>{model} · </span>}
            {credential ? credential.name || credential.base_url : current.credential_name}
          </p>
        </div>
      ) : (
        <div className='flex-1'>
          <Badge variant='fail'>未配置</Badge>
        </div>
      )}
      <Button variant='outline' size='sm' onClick={() => setEditing(true)}>
        {current ? '修改' : '配置'}
      </Button>
    </div>
  )
}

function CredentialsCard() {
  const queryClient = useQueryClient()
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: api.credentials })
  const [editing, setEditing] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCredential(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success('已删除')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const all = credentials.data ?? []

  return (
    <Section
      title='API 凭证'
      bodyClassName='space-y-2'
      actions={
        <Button variant='outline' size='sm' disabled={editing === 'new'} onClick={() => setEditing('new')}>
          <Plus className='h-3.5 w-3.5' />
          添加
        </Button>
      }
    >
      {credentials.isPending && <LoadingState />}
      {editing === 'new' && <CredentialForm siblings={all} onDone={() => setEditing(null)} />}

      {all.map((credential) => {
        if (editing === credential.id) {
          return <CredentialForm key={credential.id} current={credential} siblings={all.filter((item) => item.id !== credential.id)} onDone={() => setEditing(null)} />
        }
        const used = credential.binding_count
        return (
          <div key={credential.id} className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
            <KeyRound className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
            <span className={cn('flex-1 truncate', !credential.name && 'font-mono text-xs')}>{credential.name || credential.base_url}</span>
            <span className='shrink-0 text-xs text-muted-foreground'>{used > 0 ? `已用于 ${used} 处` : '未使用'}</span>
            <Button variant='ghost' size='icon-sm' title='编辑' aria-label='编辑' className='text-muted-foreground' onClick={() => setEditing(credential.id)}>
              <PencilLine className='h-3.5 w-3.5' />
            </Button>
            <ConfirmButton
              disabled={used > 0}
              tooltip={used > 0 ? `已用于 ${used} 处` : '删除'}
              question={`删除「${credential.name || credential.base_url}」？`}
              onConfirm={() => remove.mutate(credential.id)}
            >
              <Trash2 className='h-3.5 w-3.5' />
            </ConfirmButton>
          </div>
        )
      })}

      {credentials.isSuccess && all.length === 0 && editing === null && <EmptyState icon={KeyRound}>暂无 API 凭证</EmptyState>}
    </Section>
  )
}

function CredentialForm({ current, siblings, onDone }: { current?: Credential; siblings: Credential[]; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(current?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(current?.base_url ?? '')
  const [apiKey, setApiKey] = useState('')

  const save = useMutation({
    mutationFn: () =>
      current ? api.updateCredential(current.id, { name, base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) }) : api.createCredential({ name, base_url: baseUrl, api_key: apiKey }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success('已保存')
      onDone()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const clash = hasBaseUrlClash(name, baseUrl, siblings)
  const incomplete = baseUrl === '' || clash || (!current && apiKey === '')

  return (
    <div className='space-y-2 rounded-md border border-dashed px-3 py-2.5'>
      <Input value={name} placeholder={clash ? CLASH_PLACEHOLDER : '名称，留空则显示 Base URL'} onChange={(event) => setName(event.target.value)} />
      <Input className='font-mono text-xs' value={baseUrl} placeholder='https://api.example.com' onChange={(event) => setBaseUrl(event.target.value)} />
      <Input type='password' value={apiKey} placeholder={current ? 'API Key，留空则保留原值' : 'API Key'} onChange={(event) => setApiKey(event.target.value)} />
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
