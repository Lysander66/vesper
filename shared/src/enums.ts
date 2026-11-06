/** 作品画幅，图像与视频都按它出。 */
export const ASPECTS = ['16:9', '9:16'] as const
/** 1:1 只用于设定图，不供作品选择。 */
export type Aspect = (typeof ASPECTS)[number] | '1:1'

export const ASPECT_LABEL: Readonly<Record<Aspect, string>> = {
  '16:9': '横屏',
  '9:16': '竖屏',
  '1:1': '方图',
}

/** 声音来源：单独配音或视频自带声音，按作品设置。 */
export const AUDIO_MODES = ['separate', 'native'] as const
export type AudioMode = (typeof AUDIO_MODES)[number]

export const AUDIO_MODE_LABEL: Readonly<Record<AudioMode, string>> = {
  separate: '单独配音',
  native: '视频自带声音',
}

/** 镜间衔接：开启时上一镜的末帧作为这一镜首帧的参考图。 */
export const CONTINUITY_MODES = ['chain', 'cut'] as const
export type ContinuityMode = (typeof CONTINUITY_MODES)[number]

export const CONTINUITY_MODE_LABEL: Readonly<Record<ContinuityMode, string>> = {
  chain: '开',
  cut: '关',
}

/** 视频的画面输入，逐镜设定，两者互斥。 */
export const CLIP_SOURCES = ['first_frame', 'reference'] as const
export type ClipSource = (typeof CLIP_SOURCES)[number]

export const CLIP_SOURCE_LABEL: Readonly<Record<ClipSource, string>> = {
  first_frame: '首帧',
  reference: '参考图',
}

export const SHOT_SIZES = ['wide', 'full', 'medium', 'close', 'extreme_close'] as const
export type ShotSize = (typeof SHOT_SIZES)[number]

export const SHOT_SIZE_LABEL: Readonly<Record<ShotSize, string>> = {
  wide: '远景',
  full: '全景',
  medium: '中景',
  close: '近景',
  extreme_close: '特写',
}

/** 运镜，一镜只做一个运动。 */
export const CAMERA_MOVES = ['static', 'push', 'pull', 'pan', 'track', 'handheld'] as const
export type CameraMove = (typeof CAMERA_MOVES)[number]

export const CAMERA_MOVE_LABEL: Readonly<Record<CameraMove, string>> = {
  static: '固定',
  push: '推',
  pull: '拉',
  pan: '摇',
  track: '跟',
  handheld: '手持',
}

/** 与上一镜的接法。continue 要求两镜是同一个场景锁定版。 */
export const SHOT_JOINS = ['continue', 'cut', 'fade'] as const
export type ShotJoin = (typeof SHOT_JOINS)[number]

export const SHOT_JOIN_LABEL: Readonly<Record<ShotJoin, string>> = {
  continue: '接上一镜',
  cut: '硬切',
  fade: '黑场',
}

export const ARTIFACT_KINDS = ['first_frame', 'clip', 'voice', 'film'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/** 镜头上的三种产物；合成版挂在集上。 */
export const SHOT_ARTIFACT_KINDS: readonly ArtifactKind[] = ['first_frame', 'clip', 'voice']

export const ARTIFACT_KIND_LABEL: Readonly<Record<ArtifactKind, string>> = {
  first_frame: '首帧',
  clip: '视频',
  voice: '配音',
  film: '合成版',
}

export type ArtifactState = 'fresh' | 'stale'

/** 产物位的状态。`skipped` 表示这一镜不需要，不计入进度。 */
export type SlotStatus = 'ready' | 'stale' | 'running' | 'failed' | 'missing' | 'skipped'

/** 能否合成。有过时产物时需要确认。 */
export type Assemblability = 'ready' | 'needs_confirm' | 'blocked'

/** 一份原文的分集方案是否已定稿。 */
export type PlanState = 'draft' | 'frozen'
export type BeatsState = 'draft' | 'confirmed'

/** scene 展开演，narration 用旁白带过。 */
export type BeatMode = 'scene' | 'narration'

export type AssetState = 'draft' | 'locked'

/** 资产类别，各有一套 data 形状。 */
export const ASSET_CATEGORIES = ['character', 'scene', 'prop'] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export const ASSET_CATEGORY_LABEL: Readonly<Record<AssetCategory, string>> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
}

/** 角色定位，决定「补其余」补到哪几张设定图。 */
export type CastTier = 'lead' | 'support'

/** 角色五张设定图加音色，场景一张空镜，道具一张单品图。 */
export const ASSET_FILE_ROLES = [
  'full_body',
  'portrait',
  'expressions',
  'turnaround',
  'outfit',
  'voice_sample',
  'establishing',
  'object',
] as const
export type AssetFileRole = (typeof ASSET_FILE_ROLES)[number]

export const ASSET_FILE_ROLE_LABEL: Readonly<Record<AssetFileRole, string>> = {
  full_body: '全身',
  portrait: '半身特写',
  expressions: '表情集',
  turnaround: '三视图',
  outfit: '服装细节',
  voice_sample: '试音',
  establishing: '场景空镜',
  object: '道具单品',
}

/** 生成顺序即依赖顺序：第一张不带参考图，其余都以它为参考。 */
export const LOOK_ORDER: readonly AssetFileRole[] = [
  'full_body',
  'portrait',
  'turnaround',
  'expressions',
  'outfit',
  'establishing',
  'object',
]

/** 角色形态。非人形角色的设定图按自身姿态取景，不出人物立绘、表情集与服装图。 */
export const CHARACTER_FORMS = ['human', 'creature'] as const
export type CharacterForm = (typeof CHARACTER_FORMS)[number]

export const CHARACTER_FORM_LABEL: Readonly<Record<CharacterForm, string>> = {
  human: '人形',
  creature: '非人形',
}

export const CREATURE_LOOKS: readonly AssetFileRole[] = ['full_body', 'portrait', 'turnaround']

/** 「补其余」补到哪几张。首次出图只出第一张。 */
export const LOOKS_BY_TIER: Readonly<Record<CastTier, readonly AssetFileRole[]>> = {
  lead: ['full_body', 'portrait', 'turnaround', 'expressions', 'outfit'],
  support: ['full_body', 'portrait'],
}

/** 一件资产的全部设定图类型。配角也列满五张，没补的仍可单独出。 */
export const LOOKS_BY_CATEGORY: Readonly<Record<AssetCategory, readonly AssetFileRole[]>> = {
  character: LOOKS_BY_TIER.lead,
  scene: ['establishing'],
  prop: ['object'],
}

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export const RUN_STATUS_LABEL: Readonly<Record<RunStatus, string>> = {
  running: '进行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '被中断',
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export const JOB_STATUS_LABEL: Readonly<Record<JobStatus, string>> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export type CallSection = 'submit' | 'poll' | 'result' | 'download'

export const CALL_SECTION_LABEL: Readonly<Record<CallSection, string>> = {
  submit: '提交',
  poll: '轮询',
  result: '取结果',
  download: '下载',
}

/** 记录归属，调用记录按它过滤。 */
export type OwnerKind = 'project' | 'episode' | 'shot' | 'asset'

export const BINDING_ROLES = ['text', 'image', 'video', 'tts'] as const
export type BindingRole = (typeof BINDING_ROLES)[number]
/** 只有图像与视频能按作品单独设置，文本与配音只有全局设置。 */
export const PER_PROJECT_ROLES: readonly BindingRole[] = ['image', 'video']

export const BINDING_ROLE_LABEL: Readonly<Record<BindingRole, string>> = {
  text: '文本',
  image: '图像',
  video: '视频',
  tts: '配音',
}

export const PROMPT_IDS = ['episode', 'assets', 'beats', 'shots', 'review', 'shot_prompt', 'look', 'first_frame', 'clip'] as const
export type PromptId = (typeof PROMPT_IDS)[number]

/** 作品卡上的进度阶段。 */
export const HOME_STAGES = ['原文', '分集', '角色', '分镜', '合成'] as const
