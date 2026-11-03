import type {
  Artifact,
  ArtifactKind,
  ArtifactOwner,
  Aspect,
  AssetCategory,
  AssetPreview,
  AssetView,
  VoicePreset,
  LibraryItem,
  AudioMode,
  Beat,
  Binding,
  BindingRole,
  CharacterData,
  Command,
  ContinuityMode,
  Credential,
  EndpointSummary,
  EpisodeSuggestionView,
  EpisodeView,
  HomeView,
  Job,
  JobView,
  LockBatch,
  ModelCost,
  Project,
  ProjectView,
  SourceMutationView,
  PromptId,
  PromptTemplate,
  PropData,
  Run,
  SceneData,
  Shot,
  ShotInsertView,
  ShotPreview,
  StorageEntry,
  StorageView,
  StyleSuggestionView,
} from '@vesper/shared'

export type AssetPatch = Partial<Omit<CharacterData & SceneData & PropData, 'appearances'>>

export type ParamOverrides = Partial<Record<BindingRole, Record<string, unknown>>>

export type PromptArgs = Partial<Record<PromptId, Record<string, string>>>

export type PromptText = Record<string, string>

export interface LaunchExtra {
  params?: ParamOverrides
  prompt_args?: PromptArgs
  prompt_text?: PromptText
  audio_mode?: AudioMode
  continuity_mode?: ContinuityMode
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body instanceof FormData) {
    // Content-Type 要带 boundary，只能交给浏览器填。
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const response = await fetch(`/api${path}`, init)
  const text = await response.text()
  const data = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const detail = (data as { error?: string } | null)?.error
    throw new ApiError(detail ?? `服务端出错了（${response.status}）`, response.status)
  }
  return data as T
}

export const api = {
  home: () => request<HomeView>('GET', '/home'),
  projects: () => request<Project[]>('GET', '/projects'),
  project: (id: string) => request<ProjectView>('GET', `/projects/${id}`),
  createProject: (input: { name: string; files: { name: string; text: string }[]; target_seconds?: number; shot_min_seconds?: number; shot_max_seconds?: number; style?: string; aspect?: Aspect }) =>
    request<ProjectView>('POST', '/projects', input),
  patchProject: (
    id: string,
    // 单镜时长的上下限要一起传，后端据此检查两者是否交叉。
    patch: Partial<Pick<Project, 'name' | 'target_seconds' | 'shot_min_seconds' | 'shot_max_seconds' | 'style' | 'aspect' | 'audio_mode' | 'continuity_mode'>>
  ) => request<ProjectView>('PATCH', `/projects/${id}`, patch),
  deleteProject: (id: string) => request<{ id: string }>('DELETE', `/projects/${id}`),
  suggestStyle: (id: string) => request<StyleSuggestionView>('POST', `/projects/${id}/suggest-style`),

  addSources: (projectId: string, files: { name: string; text: string }[]) => request<ProjectView>('POST', `/projects/${projectId}/sources`, { files }),
  patchSource: (id: string, patch: { name?: string; text?: string }) => request<ProjectView>('PATCH', `/sources/${id}`, patch),
  deleteSource: (id: string) => request<SourceMutationView>('DELETE', `/sources/${id}`),
  reorderSources: (projectId: string, ids: readonly string[]) => request<SourceMutationView>('PUT', `/projects/${projectId}/sources/order`, { ids }),
  plan: (id: string, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/sources/${id}/plan`, extra),
  suggestEpisodes: (id: string) => request<EpisodeSuggestionView>('POST', `/sources/${id}/suggest-episodes`),
  putEpisodes: (id: string, episodes: { title: string; synopsis: string; source_start: number; source_end: number }[]) => request<SourceMutationView>('PUT', `/sources/${id}/episodes`, { episodes }),
  freeze: (id: string) => request<unknown>('POST', `/sources/${id}/freeze`),
  unfreeze: (id: string) => request<unknown>('POST', `/sources/${id}/unfreeze`),
  extractAssets: (projectId: string, sourceIds: readonly string[], extra: LaunchExtra = {}) =>
    request<{ run_id: string }>('POST', `/projects/${projectId}/assets/extract`, { source_ids: sourceIds, ...extra }),

  createAsset: (projectId: string, name: string, category: AssetCategory = 'character') => request<AssetView>('POST', `/projects/${projectId}/assets`, { name, category }),
  asset: (id: string) => request<AssetView>('GET', `/assets/${id}`),
  deleteAsset: (id: string) => request<{ id: string }>('DELETE', `/assets/${id}`),
  patchAsset: (id: string, patch: AssetPatch) => request<AssetView>('PATCH', `/assets/${id}`, patch),
  looks: (id: string, roles?: string[], extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/assets/${id}/looks`, { roles, ...extra }),
  assetPreview: (id: string, extra: LaunchExtra = {}) => request<AssetPreview>('POST', `/assets/${id}/preview`, extra),
  projectLooks: (id: string, category: AssetCategory, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/projects/${id}/looks`, { category, ...extra }),
  voiceSample: (id: string, line: string, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/assets/${id}/voice-sample`, { line, ...extra }),
  uploadAssetFile: (id: string, role: string, file: File) => {
    const form = new FormData()
    form.set('role', role)
    form.set('file', file)
    return request<AssetView>('POST', `/assets/${id}/files/upload`, form)
  },
  createCostume: (baseId: string, name: string, outfit: string) => request<AssetView>('POST', `/assets/${baseId}/costumes`, { name, outfit }),
  voices: () => request<VoicePreset[]>('GET', '/voices'),
  applyVoice: (id: string, voiceId: string) => request<AssetView>('POST', `/assets/${id}/voice-preset`, { voice_id: voiceId }),
  restoreAssetFile: (id: string, fileId: number) => request<AssetView>('POST', `/assets/${id}/files/${fileId}/restore`),
  lock: (id: string) => request<unknown>('POST', `/assets/${id}/lock`),
  lockAssets: (projectId: string, category: AssetCategory) => request<LockBatch>('POST', `/projects/${projectId}/assets/lock`, { category }),
  unlock: (id: string) => request<AssetView>('POST', `/assets/${id}/unlock`),
  // ids 为空即恢复默认顺序。
  reorderAssets: (projectId: string, category: AssetCategory, ids: readonly string[]) => request<{ ids: string[] }>('PUT', `/projects/${projectId}/assets/order`, { category, ids }),
  applyToShots: (id: string) => request<{ shots: number }>('POST', `/assets/${id}/follow`),

  library: () => request<LibraryItem[]>('GET', '/library'),
  saveToLibrary: (assetId: string, replace: 'yes' | 'no' = 'no') => request<AssetView>('POST', `/assets/${assetId}/library`, { replace }),
  copyFromLibrary: (id: string, projectId: string, name: string) => request<AssetView>('POST', `/library/${id}/copy`, { project_id: projectId, name }),
  deleteLibraryItem: (id: string) => request<{ id: string }>('DELETE', `/library/${id}`),

  episode: (id: string) => request<EpisodeView>('GET', `/episodes/${id}`),
  writeBeats: (id: string, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/episodes/${id}/beats`, extra),
  putBeats: (id: string, beats: readonly Beat[]) => request<EpisodeView>('PUT', `/episodes/${id}/beats`, { beats }),
  review: (id: string, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/episodes/${id}/review`, extra),
  confirmBeats: (id: string) => request<EpisodeView>('POST', `/episodes/${id}/beats/confirm`),
  splitShots: (id: string, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/episodes/${id}/shots/split`, extra),
  insertShot: (id: string, afterShotId: string | null) => request<ShotInsertView>('POST', `/episodes/${id}/shots`, { after_shot_id: afterShotId }),
  deleteShot: (id: string) => request<EpisodeView>('DELETE', `/shots/${id}`),
  produceEpisode: (id: string, kinds?: ArtifactKind[], extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/episodes/${id}/produce`, { kinds, ...extra }),
  assemble: (id: string, force: boolean) => request<{ run_id: string }>('POST', `/episodes/${id}/assemble`, { force: force ? 'yes' : 'no' }),

  patchShot: (
    id: string,
    patch: Partial<Pick<Shot, 'summary' | 'scene' | 'camera' | 'shot_size' | 'camera_move' | 'mood' | 'join_mode' | 'clip_source' | 'image_prompt' | 'motion_prompt' | 'utterances' | 'seconds'>> & {
      cast?: readonly string[]
    }
  ) => request<{ stale_kinds: ArtifactKind[] }>('PATCH', `/shots/${id}`, patch),
  shotPreview: (id: string, extra: LaunchExtra = {}) => request<ShotPreview>('POST', `/shots/${id}/preview`, extra),
  produceShot: (id: string, kinds?: readonly ArtifactKind[], extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/shots/${id}/produce`, { kinds, ...extra }),
  polishShot: (id: string, extra: LaunchExtra = {}) => request<{ run_id: string }>('POST', `/shots/${id}/polish`, extra),
  artifactHistory: (owner: ArtifactOwner, kind: ArtifactKind) => request<Artifact[]>('GET', `/${owner.kind === 'shot' ? 'shots' : 'episodes'}/${owner.id}/artifacts/${kind}/history`),
  restoreArtifact: (owner: ArtifactOwner, kind: ArtifactKind, version: number) =>
    request<Artifact>('POST', `/${owner.kind === 'shot' ? 'shots' : 'episodes'}/${owner.id}/artifacts/${kind}/restore`, { version }),

  run: (id: string) => request<Run>('GET', `/runs/${id}`),
  activeRuns: () => request<Run[]>('GET', '/runs'),
  recentRuns: () => request<Run[]>('GET', '/runs?scope=recent'),
  cancelRun: (id: string) => request<{ cancelled: 'yes' | 'no' }>('POST', `/runs/${id}/cancel`),

  jobs: (owner?: { kind: string; id: string }) => request<Job[]>('GET', owner ? `/jobs?owner_kind=${owner.kind}&owner_id=${owner.id}` : '/jobs'),
  job: (id: string) => request<JobView>('GET', `/jobs/${id}`),
  jobsCost: (owner?: { kind: string; id: string }) => request<ModelCost[]>('GET', owner ? `/jobs/cost?owner_kind=${owner.kind}&owner_id=${owner.id}` : '/jobs/cost'),
  exportRequestJson: (callId: number) => request<{ path: string }>('POST', `/calls/${callId}/request-json`),
  commands: (owner?: { kind: string; id: string }) => request<Command[]>('GET', owner ? `/commands?owner_kind=${owner.kind}&owner_id=${owner.id}` : '/commands'),

  endpoints: () => request<EndpointSummary[]>('GET', '/endpoints'),
  prompts: () => request<PromptTemplate[]>('GET', '/prompts'),
  credentials: () => request<Credential[]>('GET', '/credentials'),
  bindings: (projectId?: string) => request<Binding[]>('GET', projectId ? `/bindings?project_id=${projectId}` : '/bindings'),
  createCredential: (input: { name: string; base_url: string; api_key: string }) => request<{ id: string }>('POST', '/credentials', input),
  /** 不传 api_key 即保留原值。 */
  updateCredential: (id: string, input: { name: string; base_url: string; api_key?: string }) => request<unknown>('PATCH', `/credentials/${id}`, input),
  deleteCredential: (id: string) => request<unknown>('DELETE', `/credentials/${id}`),
  setBinding: (input: { project_id: string | null; role: BindingRole; endpoint_id: string; credential_id: string; params?: Record<string, unknown> }) => request<unknown>('PUT', '/bindings', input),

  clearBinding: (projectId: string, role: BindingRole) => request<unknown>('DELETE', `/bindings?project_id=${projectId}&role=${role}`),

  storage: () => request<StorageView>('GET', '/system/storage'),
  // 传 key 而不传路径：服务端用它打开文件管理器，不能接受客户端给的路径。
  reveal: (key: StorageEntry['key'] | 'root') => request<unknown>('POST', '/system/reveal', { key }),
}

export function fileUrl(path: string): string {
  return `/api/files?path=${encodeURIComponent(path)}`
}

/** `#t=` 让浏览器解出首帧停住，否则 <video> 只是一个空框。 */
export function videoUrl(path: string): string {
  return `${fileUrl(path)}#t=0.1`
}
