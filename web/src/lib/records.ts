import { ARTIFACT_KIND_LABEL, ASSET_FILE_ROLE_LABEL, type AssetFileRole } from '@vesper/shared'

export interface RecordsOwner {
  kind: 'project' | 'episode' | 'shot' | 'asset'
  id: string
}

export const OWNER_LABEL: Record<RecordsOwner['kind'], string> = {
  project: '作品',
  episode: '分集',
  shot: '镜头',
  asset: '资产',
}

export function ownerLine(kind: string | null, id: string | null): string {
  if (id === null) return ''
  const label = kind === null ? '归属' : (OWNER_LABEL[kind as RecordsOwner['kind']] ?? kind)
  return `${label} ${id.slice(-8)}`
}

const TASK_LABEL: Record<string, string> = {
  plan: '分集规划',
  episode_plan: '分集规划',
  asset_extract: '提取资产',
  looks: '设定图',
  project_looks: '批量生成设定图',
  voice_sample: '试音',
  beats: '叙事节拍',
  shots: '拆分镜',
  review: '审查',
  produce_shot: '单镜生成',
  produce_episode: '整集生成',
  assemble: '合成',
  tail_frame: '取末帧',
  ...ARTIFACT_KIND_LABEL,
}

export function taskLabel(kind: string): string {
  return TASK_LABEL[kind] ?? kind
}

export function purposeLabel(purpose: string | null): string {
  if (purpose === null || purpose === '') return '调用'
  if (purpose.startsWith('look_')) {
    const role = purpose.slice('look_'.length) as AssetFileRole
    return `设定图 · ${ASSET_FILE_ROLE_LABEL[role] ?? role}`
  }
  return taskLabel(purpose)
}

export function jobSeconds(createdAt: string, finishedAt: string | null): number | null {
  if (finishedAt === null) return null
  const ms = Date.parse(finishedAt) - Date.parse(createdAt)
  return Number.isFinite(ms) ? ms / 1000 : null
}

export function localStamp(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('zh-CN', { hour12: false })
}

export function argvLine(argv: string): string {
  try {
    return (JSON.parse(argv) as string[]).map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part)).join(' ')
  } catch {
    return argv
  }
}

export function prettyJson(text: string | null): string {
  if (text === null || text === '') return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** 带 `b64_json` 的响应体是几 MB 的一行，整段铺进 <pre> 会卡死页面；复制仍取全文。 */
export function truncate(text: string, limit = 4000): { body: string; hidden: number } {
  return text.length <= limit ? { body: text, hidden: 0 } : { body: text.slice(0, limit), hidden: text.length - limit }
}
