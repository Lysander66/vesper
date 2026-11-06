import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AUDIO_MODE_LABEL,
  AUDIO_MODES,
  BINDING_ROLE_LABEL,
  CONTINUITY_MODE_LABEL,
  CONTINUITY_MODES,
  PER_PROJECT_ROLES,
  capabilitiesFor,
  type AudioMode,
  type Binding,
  type BindingRole,
  type ContinuityMode,
  type DurationSpec,
  type EndpointCapabilities,
  type EndpointSummary,
  type PromptId,
  type PromptTemplate,
} from '@vesper/shared'
import { AudioLines, Film, ImageIcon, RotateCcw, SlidersHorizontal, Type, Video, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type LaunchExtra, type ParamOverrides, type PromptArgs, type PromptText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmPrompt } from '@/components/ui/confirm'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PickOrType } from '@/components/ui/pick-or-type'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { EndpointPicker } from '@/components/binding-form'

const ROLE_ICON: Record<BindingRole, ComponentType<{ className?: string }>> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  tts: AudioLines,
}

/** 由流水线计算的参数：在这里改画幅会让首帧与视频对不上。 */
const PIPELINE_OWNED = new Set(['prompt', 'duration', 'size', 'aspect_ratio', 'n'])

interface ParamSpec {
  readonly key: string
  readonly value: string
  readonly saved: string
  readonly options: readonly string[]
  readonly numeric: boolean
}

interface RoleParams {
  readonly role: BindingRole
  readonly endpointName: string
  readonly limits: readonly string[]
  readonly fields: readonly ParamSpec[]
}

interface PromptSection {
  readonly template: PromptTemplate
  readonly values: Readonly<Record<string, string>>
}

type Draft = Partial<Record<BindingRole, Record<string, string>>>

export interface LaunchParamsState {
  readonly projectId: string
  readonly bindings: readonly Binding[]
  readonly sections: readonly RoleParams[]
  readonly prompts: readonly PromptSection[]
  readonly audio: AudioMode | null
  readonly continuity: ContinuityMode | null
  readonly dirty: boolean
  readonly savable: boolean
  readonly extra: LaunchExtra
  readonly promptText: PromptText
  setField: (role: BindingRole, key: string, value: string) => void
  setPromptArg: (id: PromptId, key: string, value: string) => void
  setPromptText: (purpose: string, text: string | null) => void
  setAudio: (mode: AudioMode) => void
  setContinuity: (mode: ContinuityMode) => void
  reset: () => void
  save: () => void
  readonly saving: boolean
}

/** 入参 `undefined` 即这次发起与它无关；内部 null 即未改动、按项目值走。 */
function useProjectMode<T extends string>(projectValue: T | undefined) {
  const [override, setOverride] = useState<T | null>(null)
  const dirty = projectValue !== undefined && override !== null && override !== projectValue
  return {
    value: projectValue === undefined ? null : (override ?? projectValue),
    patch: dirty && override !== null ? override : undefined,
    dirty,
    set: setOverride,
    reset: () => setOverride(null),
  }
}

export function useLaunchParams(input: {
  projectId: string
  roles?: readonly BindingRole[]
  prompts?: readonly PromptId[]
  audioMode?: AudioMode | undefined
  continuityMode?: ContinuityMode | undefined
}): LaunchParamsState {
  const { projectId } = input
  const roles = input.roles ?? []
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>({})
  const [promptDraft, setPromptDraft] = useState<PromptArgs>({})
  const [promptText, updatePromptText] = useState<PromptText>({})
  const audio = useProjectMode(input.audioMode)
  const continuity = useProjectMode(input.continuityMode)

  const bindings = useQuery({ queryKey: ['bindings', projectId], queryFn: () => api.bindings(projectId) })
  const endpoints = useQuery({ queryKey: ['endpoints'], queryFn: api.endpoints })
  const templates = useQuery({ queryKey: ['prompts'], queryFn: api.prompts, enabled: (input.prompts?.length ?? 0) > 0 })

  const sections = buildSections(roles, bindings.data ?? [], endpoints.data ?? [], draft)
  const prompts = buildPromptSections(input.prompts ?? [], templates.data ?? [], promptDraft)
  const promptArgs = filledArgs(prompts)
  const changed = changedParams(sections)
  const savable = PER_PROJECT_ROLES.some((role) => changed[role] !== undefined) || audio.dirty || continuity.dirty
  const dirty = savable || Object.keys(promptArgs).length > 0 || Object.keys(promptText).length > 0

  const save = useMutation({
    mutationFn: async () => {
      for (const section of sections) {
        const params = changed[section.role]
        if (!params || !PER_PROJECT_ROLES.includes(section.role)) continue
        const binding = (bindings.data ?? []).find((b) => b.role === section.role)
        if (!binding) continue
        await api.setBinding({
          project_id: projectId,
          role: section.role,
          endpoint_id: binding.endpoint_id,
          credential_id: binding.credential_id,
          params: { ...binding.params, ...params },
        })
      }
      if (audio.patch !== undefined || continuity.patch !== undefined) {
        await api.patchProject(projectId, {
          ...(audio.patch === undefined ? {} : { audio_mode: audio.patch }),
          ...(continuity.patch === undefined ? {} : { continuity_mode: continuity.patch }),
        })
      }
    },
    onSuccess: async () => {
      setDraft({})
      audio.reset()
      continuity.reset()
      await queryClient.invalidateQueries()
      toast.success('已存为本作品默认')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return {
    projectId,
    bindings: bindings.data ?? [],
    sections,
    prompts,
    audio: audio.value,
    continuity: continuity.value,
    dirty,
    savable,
    extra: {
      ...(Object.keys(changed).length > 0 ? { params: changed } : {}),
      ...(Object.keys(promptArgs).length > 0 ? { prompt_args: promptArgs } : {}),
      ...(Object.keys(promptText).length > 0 ? { prompt_text: promptText } : {}),
      ...(audio.patch === undefined ? {} : { audio_mode: audio.patch }),
      ...(continuity.patch === undefined ? {} : { continuity_mode: continuity.patch }),
    },
    promptText,
    setField: (role, key, value) => setDraft((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [key]: value } })),
    setPromptArg: (id, key, value) => setPromptDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: value } })),
    setPromptText: (purpose, text) =>
      updatePromptText((prev) => {
        const next = { ...prev }
        if (text === null) delete next[purpose]
        else next[purpose] = text
        return next
      }),
    setAudio: audio.set,
    setContinuity: continuity.set,
    reset: () => {
      setDraft({})
      setPromptDraft({})
      updatePromptText({})
      audio.reset()
      continuity.reset()
    },
    save: () => save.mutate(),
    saving: save.isPending,
  }
}

export function LaunchGroup({
  state,
  onLaunch,
  icon: Icon,
  label,
  launchLabel,
  lead,
  question,
  variant = 'ghost',
  busy,
  disabled,
  title,
  className,
}: {
  state: LaunchParamsState
  onLaunch: () => void
  icon?: ComponentType<{ className?: string }>
  label: string
  launchLabel?: string
  lead?: ReactNode
  question?: ReactNode
  variant?: 'ghost' | 'outline' | 'default'
  busy?: boolean
  disabled?: boolean
  title?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const launch = () => (question ? setAsking(true) : onLaunch())

  return (
    <div className={cn('inline-flex items-center rounded-md', variant === 'ghost' && 'border', className)}>
      <Button size='sm' variant={variant} className='rounded-r-none border-r-0' disabled={busy || disabled} title={title} onClick={launch}>
        {Icon && <Icon className='h-3.5 w-3.5' />}
        {label}
      </Button>
      <Button
        size='sm'
        variant={variant}
        className={cn('rounded-l-none px-2', variant === 'ghost' && 'border-l', variant === 'default' && 'border-l border-l-white/25')}
        title='本次参数'
        aria-label='本次参数'
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className='h-3.5 w-3.5' />
        {state.dirty && <span className='ml-1 h-1.5 w-1.5 rounded-full bg-brand' />}
      </Button>

      <ParamsDialog state={state} open={open} setOpen={setOpen} onLaunch={launch} busy={busy} launchLabel={launchLabel ?? label} lead={lead} />
      <ConfirmPrompt open={asking} onOpenChange={setAsking} question={question} action={launchLabel ?? label} onConfirm={onLaunch} />
    </div>
  )
}

export function LaunchParams({ state }: { state: LaunchParamsState }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={state.dirty ? 'secondary' : 'outline'} size='sm' title='本次参数' aria-label='本次参数' onClick={() => setOpen(true)}>
        <SlidersHorizontal className='h-3.5 w-3.5' />
        {state.dirty && <span className='ml-1 h-1.5 w-1.5 rounded-full bg-brand' />}
      </Button>
      <ParamsDialog state={state} open={open} setOpen={setOpen} />
    </>
  )
}

function ParamsDialog({
  state,
  open,
  setOpen,
  onLaunch,
  busy,
  launchLabel,
  lead,
}: {
  state: LaunchParamsState
  open: boolean
  setOpen: (open: boolean) => void
  onLaunch?: () => void
  busy?: boolean
  launchLabel?: string
  lead?: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className='max-w-2xl'>
        <DialogTitle>本次参数</DialogTitle>
        {lead}
        <LaunchParamsFields state={state} />

        <div className='flex items-center gap-2 border-t pt-3'>
          {state.dirty && (
            <Button variant='ghost' size='sm' title='恢复默认值' aria-label='恢复默认值' onClick={state.reset}>
              <RotateCcw className='h-3.5 w-3.5' />
            </Button>
          )}
          {(state.sections.length > 0 || state.audio !== null) && (
            <Button variant='outline' size='sm' disabled={!state.savable || state.saving} onClick={state.save}>
              存为本作品默认
            </Button>
          )}
          {onLaunch && (
            <Button
              size='sm'
              className='ml-auto'
              disabled={busy}
              onClick={() => {
                setOpen(false)
                onLaunch()
              }}
            >
              {launchLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function LaunchParamsFields({ state }: { state: LaunchParamsState }) {
  const empty = state.sections.length === 0 && state.prompts.length === 0 && state.audio === null
  const pickable = state.sections.filter((section) => PER_PROJECT_ROLES.includes(section.role))

  return (
    <div className='space-y-2.5'>
      {empty && <p className='text-xs text-muted-foreground'>未配置模型，或暂无可调参数</p>}

      {state.prompts.map((section) => (
        <Block key={section.template.id} icon={Wand2} title={`提示词 · ${section.template.title}`}>
          <p className='text-2xs leading-snug text-muted-foreground'>{section.template.purpose}</p>
          {section.template.params.map((param) => (
            <PromptField key={param.key} param={param} value={section.values[param.key] ?? ''} onChange={(value) => state.setPromptArg(section.template.id, param.key, value)} />
          ))}
        </Block>
      ))}

      {state.sections.map((section) => (
        <Block key={section.role} icon={ROLE_ICON[section.role]} title={BINDING_ROLE_LABEL[section.role]} aside={section.endpointName}>
          {section.limits.length > 0 && <p className='text-2xs leading-snug text-muted-foreground'>{section.limits.join(' · ')}</p>}
          {section.fields.length === 0 ? (
            <p className='text-xs text-muted-foreground'>暂无可调参数</p>
          ) : (
            section.fields.map((field) => <ParamField key={field.key} field={field} onChange={(value) => state.setField(section.role, field.key, value)} />)
          )}
        </Block>
      ))}

      {(state.audio !== null || pickable.length > 0) && (
        <Block icon={Film} title='本作品'>
          {pickable.map((section) => (
            <EndpointPicker key={section.role} projectId={state.projectId} role={section.role} bindings={state.bindings} className='min-w-0' />
          ))}
          {state.audio !== null && <ModeField title='声音来源' value={state.audio} options={AUDIO_MODES} labels={AUDIO_MODE_LABEL} onChange={state.setAudio} />}
          {state.continuity !== null && <ModeField title='末帧参考' value={state.continuity} options={CONTINUITY_MODES} labels={CONTINUITY_MODE_LABEL} onChange={state.setContinuity} />}
        </Block>
      )}
    </div>
  )
}

function Block({ icon: Icon, title, aside, children }: { icon: ComponentType<{ className?: string }>; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className='space-y-2 rounded-lg border bg-card/40 p-2.5'>
      <div className='flex items-center gap-1.5'>
        <Icon className='h-3.5 w-3.5 shrink-0 text-ink3' />
        <p className='text-2xs font-semibold'>{title}</p>
        {aside && <span className='ml-auto truncate font-mono text-2xs text-muted-foreground'>{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function PromptField({ param, value, onChange }: { param: PromptTemplate['params'][number]; value: string; onChange: (value: string) => void }) {
  return (
    <div className='space-y-1'>
      <label className='text-2xs text-muted-foreground'>{param.label}</label>
      {param.kind === 'choice' ? (
        <PromptChoice options={param.options ?? []} value={value} onChange={onChange} />
      ) : param.kind === 'select' ? (
        <Segmented
          value={value === '' ? (param.options?.[0]?.value ?? '') : value}
          options={(param.options ?? []).map((option) => option.value)}
          onChange={onChange}
          render={(option) => param.options?.find((item) => item.value === option)?.label ?? option}
        />
      ) : param.kind === 'text' ? (
        <Textarea className='min-h-14 bg-card text-xs' placeholder={param.hint} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input className='h-8 bg-card text-xs' type={param.kind === 'number' ? 'number' : 'text'} placeholder={param.hint} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {(param.kind === 'choice' || param.kind === 'select') && param.hint !== undefined && <p className='text-2xs leading-snug text-ink3'>{param.hint}</p>}
    </div>
  )
}

/** 空值即全选，取消到只剩一项再取消也回到全选。 */
function PromptChoice({ options, value, onChange }: { options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  const picked = value.split(',').filter((item) => item !== '')
  const all = picked.length === 0
  const toggle = (option: string) => {
    const next = all ? options.filter((item) => item.value !== option).map((item) => item.value) : picked.includes(option) ? picked.filter((item) => item !== option) : [...picked, option]
    onChange(next.length === options.length ? '' : next.join(','))
  }

  return (
    <div className='flex flex-wrap gap-1'>
      {options.map((option) => {
        const on = all || picked.includes(option.value)
        return (
          <ToggleChip key={option.value} size='xs' on={on} onClick={() => toggle(option.value)}>
            {option.label}
          </ToggleChip>
        )
      })}
    </div>
  )
}

function fitsInline(options: readonly string[]): boolean {
  return options.length <= 4 && options.every((option) => option.length <= 12)
}

function ParamField({ field, onChange }: { field: ParamSpec; onChange: (value: string) => void }) {
  const changed = field.value !== field.saved

  return (
    <div className='space-y-1'>
      <div className='flex items-center gap-1.5'>
        <label className='font-mono text-2xs text-muted-foreground'>{field.key}</label>
        {changed && <span className='font-mono text-2xs text-brand'>默认 {field.saved || '（空）'}</span>}
      </div>
      {field.options.length === 0 ? (
        <Input className='h-8 bg-card font-mono text-xs' type={field.numeric ? 'number' : 'text'} value={field.value} onChange={(event) => onChange(event.target.value)} />
      ) : fitsInline(field.options) ? (
        <Segmented value={field.value} options={field.options} onChange={onChange} />
      ) : (
        <PickOrType value={field.value} options={field.options} onChange={onChange} />
      )}
    </div>
  )
}

function ModeField<T extends string>({
  title,
  value,
  options,
  labels,
  onChange,
}: {
  title: string
  value: T
  options: readonly T[]
  labels: Readonly<Record<T, string>>
  onChange: (mode: T) => void
}) {
  return (
    <div className='space-y-1'>
      <label className='text-2xs font-semibold text-ink3'>{title}</label>
      <Segmented value={value} options={options} render={(mode) => labels[mode]} onChange={onChange} />
    </div>
  )
}

function buildSections(roles: readonly BindingRole[], bindings: readonly Binding[], endpoints: readonly EndpointSummary[], draft: Draft): RoleParams[] {
  const sections: RoleParams[] = []
  for (const role of roles) {
    const binding = bindings.find((b) => b.role === role)
    if (!binding) continue
    const definition = endpoints.find((e) => e.id === binding.endpoint_id)?.definition
    if (!definition) continue
    const defaults = definition.defaults ?? {}
    const model = draft[role]?.model ?? binding.params.model ?? defaults.model
    const capabilities = capabilitiesFor(definition.capabilities, model)
    const limits = limitsOf(capabilities, role)
    const declared = definition.capabilities?.models?.length ? ['model'] : []
    const keys = [...new Set([...Object.keys(defaults), ...Object.keys(binding.params), ...declared])].filter((key) => !PIPELINE_OWNED.has(key))

    sections.push({
      role,
      endpointName: binding.endpoint_name,
      limits,
      fields: keys.map((key) => {
        const saved = binding.params[key] ?? defaults[key]
        const text = saved === undefined || saved === null ? '' : String(saved)
        return {
          key,
          saved: text,
          value: draft[role]?.[key] ?? text,
          options: optionsFor(definition, key, capabilities),
          numeric: typeof saved === 'number',
        }
      }),
    })
  }
  return sections
}

/** `enum_maps` 由整个端点共用，拿它当候选会列出其他模型才有的档位。 */
function optionsFor(definition: EndpointSummary['definition'], key: string, capabilities: EndpointCapabilities): string[] {
  if (key === 'resolution') return capabilities.resolutions ?? []
  if (key === 'model') return definition.capabilities?.models ?? []
  return Object.keys(definition.enum_maps?.[key] ?? {})
}

function limitsOf(caps: EndpointCapabilities, role: BindingRole): string[] {
  const out: string[] = []
  if (caps.start_image === 'yes') out.push('支持首帧')
  if (caps.durations) out.push(`时长 ${describeDurations(caps.durations)}`)
  if (role === 'video') out.push(caps.audio === 'native' ? '视频自带声音' : '视频无声音')
  if (caps.max_reference_images !== undefined) out.push(`参考图 ≤ ${caps.max_reference_images} 张`)
  if (caps.max_reference_audios !== undefined) out.push(`试音 ≤ ${caps.max_reference_audios} 段`)
  if (caps.max_prompt_chars !== undefined) out.push(`提示词 ≤ ${caps.max_prompt_chars} 字`)
  return out
}

function describeDurations(durations: DurationSpec): string {
  if ('min' in durations) return `${durations.min}–${durations.max} 秒`
  return `${[...durations].sort((a, b) => a - b).join(' / ')} 秒`
}

function buildPromptSections(ids: readonly PromptId[], templates: readonly PromptTemplate[], draft: PromptArgs): PromptSection[] {
  return ids.flatMap((id) => {
    const template = templates.find((t) => t.id === id)
    return template ? [{ template, values: draft[id] ?? {} }] : []
  })
}

function filledArgs(sections: readonly PromptSection[]): PromptArgs {
  const out: PromptArgs = {}
  for (const section of sections) {
    const filled = Object.entries(section.values).filter(([, value]) => value.trim() !== '')
    if (filled.length > 0) out[section.template.id] = Object.fromEntries(filled.map(([k, v]) => [k, v.trim()]))
  }
  return out
}

function changedParams(sections: readonly RoleParams[]): ParamOverrides {
  const out: ParamOverrides = {}
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.value === field.saved) continue
      // 留空不算改成空串：那会把端点缺省也一并清掉。
      if (field.value.trim() === '') continue
      const value = field.numeric ? Number(field.value) : field.value
      if (field.numeric && Number.isNaN(value as number)) continue
      out[section.role] = { ...(out[section.role] ?? {}), [field.key]: value }
    }
  }
  return out
}

/** 按内容比较而不是按对象：父组件每次渲染都给一个新对象。 */
export function useDebounced(extra: LaunchExtra): LaunchExtra {
  const key = JSON.stringify(extra)
  const [settled, setSettled] = useState(key)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), 300)
    return () => clearTimeout(timer)
  }, [key])
  return useMemo(() => JSON.parse(settled) as LaunchExtra, [settled])
}

export function withoutPromptText(extra: LaunchExtra): LaunchExtra {
  const rest = { ...extra }
  delete rest.prompt_text
  return rest
}

export function hasOverrides(extra: LaunchExtra): boolean {
  return Object.values(extra).some((value) => value !== undefined)
}
