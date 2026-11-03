/** 接口响应的形状，server 与 web 共用。 */

import type {
  Aspect,
  Assemblability,
  ArtifactKind,
  ArtifactState,
  AssetCategory,
  AssetFileRole,
  AssetState,
  AudioMode,
  BeatMode,
  BeatsState,
  BindingRole,
  CallSection,
  CameraMove,
  CastTier,
  CharacterForm,
  ClipSource,
  ContinuityMode,
  JobStatus,
  PlanState,
  OwnerKind,
  PromptId,
  RunStatus,
  ShotJoin,
  ShotSize,
  SlotStatus,
} from './enums'

/** speaker 为 null 即旁白。 */
export interface Utterance {
  speaker: string | null
  text: string
  /** 怎么说：语气、音量、节奏，以及是否经设备传出。 */
  how?: string | undefined
}

export interface Beat {
  mode: BeatMode
  summary: string
  utterances: readonly Utterance[]
  /** 这一拍对应本集原文的字符区间。定位失败或人工改过节拍后没有。 */
  source_start?: number
  source_end?: number
}

/** 审查结果：不看原文、只读节拍或分镜复述的剧情，以及看不懂的地方。 */
export interface Review {
  /** 有分镜读分镜，没有读节拍。 */
  basis: 'beats' | 'shots'
  retelling: string
  gaps: readonly { at: string; missing: string }[]
  /** 1–10，剧情是否看得懂。 */
  score: number
  created_at: string
}

/** 原文体量。只供参考，不是合成版时长的预测。 */
export interface Volume {
  char_count: number
  narrated_seconds: number
  /** 0 = 不限。 */
  target_seconds: number
  message: string
}

/** 一份原文，不含正文。 */
export interface ProjectSource {
  id: string
  name: string
  char_count: number
  plan_state: PlanState
  frozen_at: string | null
  /** 按区间排。 */
  episodes: readonly EpisodeSummary[]
}

export interface Project {
  id: string
  name: string
  target_seconds: number
  speech_rate: number
  /** 单镜时长的目标区间。台词念不完时可以超过上限。 */
  shot_min_seconds: number
  shot_max_seconds: number
  style: string
  aspect: Aspect
  audio_mode: AudioMode
  continuity_mode: ContinuityMode
  /** 每一份原文都定稿了才算定稿。 */
  plan_state: PlanState
  created_at: string
  updated_at: string
}

/** 产物挂在镜头上，合成版挂在集上。 */
export interface ArtifactOwner {
  kind: 'shot' | 'episode'
  id: string
}

export interface Artifact {
  id: string
  kind: ArtifactKind
  version: number
  state: ArtifactState
  path: string | null
  job_id: string | null
  command_id: string | null
  created_at: string
}

export interface Progress {
  percent: number
  counts: Readonly<Record<SlotStatus, number>>
  assemblable: Assemblability
  total_seconds: number
}

export interface EpisodeSummary {
  id: string
  project_id: string
  source_id: string
  idx: number
  title: string
  synopsis: string
  /** 所属原文内的字符下标。 */
  source_start: number
  source_end: number
  beats_count: number
  beats_state: BeatsState
  shots: number
  progress: Progress | null
  film: Artifact | null
}

/** 三类共有：原文里的其他叫法与出场次数。 */
interface AssetDataBase {
  aliases: readonly string[]
  appearances: number
}

export interface CharacterData extends AssetDataBase {
  tier: CastTier
  form: CharacterForm
  /** 身份与关系，不进画面提示词。 */
  identity: string
  /** 逐字进首帧提示词。 */
  traits: string
  outfit: string
  voice: string
}

export interface SceneData extends AssetDataBase {
  /** 结构、材质、陈设。 */
  description: string
  /** 光线与时段。 */
  lighting: string
}

export interface PropData extends AssetDataBase {
  description: string
  /** 归属的角色，也进设定图提示词。 */
  holder: string
}

export type AssetData = CharacterData | SceneData | PropData

/** 作品页上的一张资产卡。 */
export interface AssetSummary<D extends AssetData = AssetData> {
  id: string
  name: string
  state: AssetState
  data: D
  files: number
  version_id: string | null
  /** 换装才有：本体角色的 id。 */
  base_id: string | null
  /** 换装锁定后本体又锁了新版，要重新锁定换装才能用上新的外貌与声音。 */
  base_newer: 'yes' | 'no'
}

export interface Binding {
  role: BindingRole
  endpoint_id: string
  endpoint_name: string
  credential_id: string
  credential_name: string
  params: Record<string, unknown>
  inherited: 'yes' | 'no'
}

export interface ProjectView {
  project: Project & { volume: Volume | null }
  /** 按导入顺序，摊平后即全作品的集序。 */
  sources: readonly ProjectSource[]
  cast: readonly AssetSummary<CharacterData>[]
  scenes: readonly AssetSummary<SceneData>[]
  props: readonly AssetSummary<PropData>[]
  bindings: readonly Binding[]
  overall_percent: number
}

/** 改分集方案或删原文后的响应。 */
export interface SourceMutationView extends ProjectView {
  /** 从第几集起改了号（1 起）。null 表示集号没变。 */
  renumbered_from: number | null
}

/** 模型建议的分集数与理由。 */
export interface EpisodeSuggestionView {
  count: number
  reason: string
}

/** 模型从画风预设里挑的几条，`label` 一定在 `STYLE_GROUPS` 里。 */
export interface StyleSuggestionView {
  picks: { label: string; reason: string }[]
}

/** 按 `idx` 顺序列出作品的全部集。 */
export function allEpisodes(view: ProjectView): EpisodeSummary[] {
  return view.sources.flatMap((source) => source.episodes)
}

/** 工作台上的一张作品卡，进度按全作品累计。 */
export interface HomeProject {
  id: string
  name: string
  style: string
  aspect: Aspect
  /** 导入的原文文件名，多份用「、」连接。 */
  source_name: string
  char_count: number
  plan_state: PlanState
  episodes: number
  shots: number
  films: number
  /** 第一镜的首帧，用作封面。 */
  cover: string | null
  percent: number
  ready: number
  stale: number
  total: number
  /** 当前在第几个阶段，1 起；全部完成为 `HOME_STAGES.length + 1`。 */
  stage: number
}

/** 今天的一次调用。 */
export interface HomePulse {
  id: string
  purpose: string | null
  status: JobStatus
  owner_kind: OwnerKind | null
  owner_id: string | null
  label: string | null
  calls: number
  seconds: number
  at: string
}

/** 最近一次挂在镜头上的调用，「接着做」跳到这里。 */
interface HomeResume {
  project_id: string
  project_name: string
  episode_id: string
  episode_idx: number
  shot_idx: number
  at: string
}

export interface HomeView {
  projects: readonly HomeProject[]
  today: { jobs: number; failed: number; calls: number; seconds: number }
  pulse: readonly HomePulse[]
  total_jobs: number
  stale: number
  unlocked: number
  running: number
  resume: HomeResume | null
}

/** 镜头对资产锁定版本的引用。 */
export interface ShotRef {
  asset_id: string
  version_id: string
  name: string
  /** 这一镜用哪张设定图当参考图，不填按固定顺序取。 */
  look?: AssetFileRole
}

export interface Shot {
  id: string
  episode_id: string
  idx: number
  summary: string
  scene: string
  camera: string
  shot_size: ShotSize
  camera_move: CameraMove
  /** 情绪弧线，只用于写提示词，改了要重写提示词才生效。 */
  mood: string
  join_mode: ShotJoin
  clip_source: ClipSource
  image_prompt: string
  motion_prompt: string
  /** 这一镜的声音，按主次写。视频自带音轨时写进视频提示词。 */
  sound: string
  utterances: readonly Utterance[]
  /** 出自第几个节拍，-1 表示未归属。 */
  beat_index: number
  seconds: number
  cast: readonly ShotRef[]
  /** null 表示这一镜不需要场景参考图。 */
  scene_ref: ShotRef | null
  props: readonly ShotRef[]
  artifacts: readonly Artifact[]
  slots: Readonly<Record<ArtifactKind, SlotStatus>> | null
  status: SlotStatus
}

/** 参考图清单里的一条，顺序与发出的参考图一致。 */
export interface ShotPreviewRef {
  /** 人物 / 场景 / 道具 / 上一镜的末帧。 */
  kind: string
  /** 末帧没有名字，为空串。 */
  name: string
  anchor: string
  path: string
  /** 超出端点上限、这次带不上的为 'no'。 */
  attached: 'yes' | 'no'
}

export interface ShotPreviewVoice {
  name: string
  attached: 'yes' | 'no'
  /** 带上的写时长，没带上的写原因。 */
  detail: string
}

/** 按当前设置这一镜将发出的内容。 */
export interface ShotPreview {
  shot_id: string
  first_frame: string
  clip: string
  refs: readonly ShotPreviewRef[]
  voices: readonly ShotPreviewVoice[]
  /** 首帧模式下首帧提示词里没写到的出场人物名。 */
  off_frame: readonly string[]
  max_refs: number
  /** 按端点档位取整后的视频时长，秒。null 表示端点不接受时长参数。 */
  duration: number | null
  /** 尚未配置调用方式的角色。此时上限与时长按不限计算，生成会失败。 */
  unbound: readonly BindingRole[]
}

export interface EpisodeView {
  episode: {
    id: string
    project_id: string
    source_id: string
    idx: number
    title: string
    synopsis: string
    source_start: number
    source_end: number
    source_name: string
    beats: readonly Beat[]
    beats_state: BeatsState
    review: Review | null
  }
  source: string
  target_seconds: number
  speech_rate: number
  audio_mode: AudioMode
  continuity_mode: ContinuityMode
  shots: readonly Shot[]
  progress: Progress | null
  film: Artifact | null
}

/** 带上新镜头的 id。 */
export interface ShotInsertView extends EpisodeView {
  shot_id: string
}

interface AssetFile {
  id: number
  role: string
  label: string
  path: string
  job_id: string | null
  created_at: string
}

interface AssetViewBase {
  id: string
  name: string
  state: AssetState
  project_id: string | null
  /** 换装才有：本体角色的 id。 */
  base_id: string | null
  files: readonly AssetFile[]
  /** 最近一次锁定时每个图位用的那张，没锁过为空。 */
  locked_paths: readonly string[]
}

/** 按 category 区分 data 的形状。 */
export type AssetView =
  | (AssetViewBase & { category: 'character'; data: CharacterData })
  | (AssetViewBase & { category: 'scene'; data: SceneData })
  | (AssetViewBase & { category: 'prop'; data: PropData })

/** 素材库里的一件，每个图位只有一张。 */
export type LibraryItem = AssetView & {
  /** 从哪部作品存进来的。 */
  tags: readonly string[]
  created_at: string
}

/** 预置音色：现成的试听录音，选用后作为角色的试音。性别、年龄段为空表示未标注。 */
export interface VoicePreset {
  id: string
  name: string
  gender: string
  age: string
  language: string
  path: string
}

/** 每张设定图将发出的提示词。 */
interface AssetPreviewLook {
  role: AssetFileRole
  prompt: string
  /** 不指定要哪几张时是否生成，只有第一张是 'yes'。 */
  wanted: 'yes' | 'no'
}

/** 批量锁定的结果，没有设定图的跳过。 */
export interface LockBatch {
  locked: readonly string[]
  skipped: number
}

export interface AssetPreview {
  asset_id: string
  looks: readonly AssetPreviewLook[]
  /** 尚未配置调用方式的角色，生成会失败。 */
  unbound: readonly BindingRole[]
}

export type AssetDataOf<C extends AssetCategory> = C extends 'character'
  ? CharacterData
  : C extends 'scene'
    ? SceneData
    : PropData

/** 任务所在位置，按集号、镜号给出。 */
export interface RunLocation {
  project_id: string
  project_name: string
  /** 作品级任务为 null。 */
  episode_no: number | null
  shot_no: number | null
  asset_id: string | null
  asset_name: string | null
}

export interface Run {
  id: string
  owner_kind: OwnerKind
  owner_id: string
  kind: string
  status: RunStatus
  started_at: string
  finished_at: string | null
  report: string | null
  error: string | null
  /** 归属已删除时为 null。 */
  location: RunLocation | null
}

/** run_events 的 payload。 */
export type RunEventPayload =
  | { type: 'job_started'; job_id: string; purpose: string; label: string }
  | {
      type: 'job_progress'
      job_id: string
      phase: string
      seq?: number | undefined
      status?: JobStatus | undefined
      provider_status?: string | undefined
      message?: string | undefined
    }
  | { type: 'note'; level: 'info' | 'warn' | 'error'; message: string; shot_id?: string | undefined }
  | { type: 'skipped'; shot_id: string; purpose: string; message: string }
  | { type: 'command_started'; kind: string; shot_id?: string | undefined; episode_id?: string | undefined }
  | { type: 'command_finished'; command_id: string; exit_code: number; error?: string | null | undefined }
  | { type: 'finished'; status: Exclude<RunStatus, 'running'>; error?: string | undefined; note?: string | undefined }

/** `/api/runs/feed` 的事件，推送所有来源发起的任务。 */
export type RunFeedEvent = { type: 'run_started'; run_id: string } | { type: 'run_finished'; run_id: string; status: Exclude<RunStatus, 'running'> }

export interface Job {
  id: string
  owner_kind: OwnerKind | null
  owner_id: string | null
  purpose: string | null
  endpoint_id: string
  status: JobStatus
  /** 标量入参的 JSON：prompt / model / duration / size…… */
  params: string
  /** 素材入参的 JSON，值是带本地路径的 `$asset` 引用。 */
  inputs: string
  provider_task_id: string | null
  error: string | null
  artifacts: string | null
  created_at: string
  finished_at: string | null
  usage: Usage | null
  /** 有用量但价目表里没有这个模型时为 null。 */
  cost: Money | null
}

/** 一次任务的用量，字段按计费方式区分。 */
export type Usage =
  | {
      kind: 'tokens'
      model: string
      input: number
      cache_write_5m: number
      cache_write_1h: number
      cache_read: number
      output: number
    }
  | { kind: 'image'; model: string; text_input: number; image_input: number; image_output: number }
  | { kind: 'video'; model: string; resolution: string; seconds: number; input_images: number }
  | { kind: 'speech'; model: string; characters: number }

export type Currency = 'USD' | 'CNY'

/** 美元与人民币各记各的，不换算。 */
export type Money = Partial<Record<Currency, number>>

/** 一个模型在范围内的花费。一个模型只有一种币种。 */
export interface ModelCost {
  model: string
  /** 价目表里没有这个模型时为 null。 */
  money: Money | null
  succeeded: number
  /** 未成功但响应带了用量、照样计费的任务。 */
  failed: number
}

/** 可重放的 cURL 导出。素材不内联，每个占位符给一行 shell 填值。 */
export interface CurlExport {
  command: string
  assets: readonly { placeholder: string; path: string; mime: string; bytes: number; fill: string }[]
  /** 命令引用的凭证变量名，重放前先 export。 */
  env_var: string | null
}

export interface Call {
  id: number
  section: CallSection
  method: string
  url: string
  request_headers: string
  request_body: string | null
  status_code: number | null
  response_body: string | null
  error: string | null
  started_at: string
  duration_ms: number | null
  curl: CurlExport
}

export interface JobView {
  job: Job
  calls: readonly Call[]
}

export interface Command {
  id: string
  owner_kind: OwnerKind | null
  owner_id: string | null
  kind: string
  argv: string
  exit_code: number | null
  stderr: string | null
  error: string | null
  started_at: string
  duration_ms: number | null
}

/** 视频时长：固定几档列出来，连续区间给两端。 */
export type DurationSpec = readonly number[] | { min: number; max: number }

/** 端点定义中界面用到的部分。 */
export interface EndpointDefinition {
  /** `title` 是设置页显示的名字，`hints.base_url` 是选中后预填的地址。 */
  meta?: {
    title?: string
    docs?: string
    notes?: string
    /** 同一产出下首选这条，设置页排在最前并预选。 */
    preferred?: 'yes'
    /** 上一代接口，设置页排在最后。 */
    legacy?: 'yes'
    hints?: { base_url?: string }
  }
  enum_maps?: Record<string, Record<string, string>>
  defaults?: Record<string, unknown>
  capabilities?: EndpointCapabilities & {
    /** 验证过的模型，作为候选项，不限制填别的。 */
    models?: string[] | undefined
    /** 随型号变的档位，键是型号名。 */
    by_model?: Record<string, EndpointCapabilities> | undefined
  }
}

/** 一款模型接受的参数范围。 */
export interface EndpointCapabilities {
  resolutions?: string[] | undefined
  durations?: DurationSpec | undefined
  aspect_ratios?: string[] | undefined
  audio?: 'native' | undefined
  start_image?: 'yes' | undefined
  max_reference_images?: number | undefined
  max_reference_audios?: number | undefined
  max_prompt_chars?: number | undefined
  prompt_style?: 'h3' | undefined
}

/** `by_model` 里写了的字段整项覆盖端点级，端点级是默认那款的档位。 */
export function capabilitiesFor(capabilities: EndpointDefinition['capabilities'], model: unknown): EndpointCapabilities {
  if (!capabilities) return {}
  const override = typeof model === 'string' ? capabilities.by_model?.[model] : undefined
  const { models: _models, by_model: _byModel, ...base } = capabilities
  return override ? { ...base, ...override } : base
}

/** 数据目录的一项。`key` 也是 `POST /api/system/reveal` 的参数。 */
export interface StorageEntry {
  key: 'db' | 'artifacts' | 'films' | 'library' | 'voices' | 'uploads' | 'requests'
  /** 显示名，目录带斜杠。 */
  label: string
  purpose: string
  path: string
  files: number
  bytes: number
}

/** 数据目录总览。改目录需改环境变量并重启。 */
export interface StorageView {
  root: string
  /** 指定数据目录的环境变量名。 */
  env_var: string
  entries: readonly StorageEntry[]
  total_bytes: number
}

export interface EndpointSummary {
  id: string
  name: string
  kind: 'image' | 'video' | 'text' | 'audio'
  definition: EndpointDefinition
}

export interface Credential {
  id: string
  name: string
  base_url: string
  /** 全局与作品级的绑定合计，不为 0 时不能删除。 */
  binding_count: number
}

export interface PromptParam {
  key: string
  kind: 'list' | 'text' | 'number' | 'choice' | 'select'
  label: string
  /** 标签说不清时才给。 */
  hint?: string
  /** `choice` 可多选，值以逗号拼接，一个不选即全要；`select` 单选，空串即第一项。 */
  options?: readonly { value: string; label: string }[]
}

/** 提示词模板的说明，由 `GET /api/prompts` 给出。 */
export interface PromptTemplate {
  id: PromptId
  title: string
  /** 一句话说明这一步向模型要什么。 */
  purpose: string
  params: readonly PromptParam[]
}

/** 人填的集数，没填或不是正整数即 0。前后端共用，判断才一致。 */
export function episodeCountOf(value: string | undefined): number {
  const count = Number(value ?? '')
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0
}

/** 集号变了时的提示语。 */
export function renumberNote(from: number | null): string | undefined {
  return from === null ? undefined : `第 ${from} 集起的集号顺移了`
}
