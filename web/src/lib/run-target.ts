import type { Run } from '@vesper/shared'

export type RunTarget =
  | { page: 'project'; projectId: string; assetId?: string; hash?: string; label: string }
  | {
      page: 'episode'
      projectId: string
      episodeNo: number
      tab: 'script' | 'shots'
      shotNo?: number
      flash?: 'artifacts' | 'film'
      label: string
    }

export function runTarget(run: Run): RunTarget | null {
  const at = run.location
  if (at === null) return null

  const project = { page: 'project' as const, projectId: at.project_id }

  if (at.asset_id !== null) {
    return { ...project, assetId: at.asset_id, label: `${at.project_name} · ${at.asset_name ?? '资产'}` }
  }

  if (at.episode_no !== null) {
    const episode = { page: 'episode' as const, projectId: at.project_id, episodeNo: at.episode_no }
    const where = `${at.project_name} · 第 ${at.episode_no} 集`
    if (at.shot_no !== null) {
      return { ...episode, tab: 'shots', shotNo: at.shot_no, flash: 'artifacts', label: `${where} · 第 ${at.shot_no} 镜` }
    }
    if (run.kind === 'assemble') return { ...episode, tab: 'shots', flash: 'film', label: `${where} · 合成版` }
    if (run.kind === 'beats' || run.kind === 'review') return { ...episode, tab: 'script', label: `${where} · 脚本` }
    return { ...episode, tab: 'shots', label: `${where} · 分镜` }
  }

  const hash = run.kind === 'asset_extract' ? 'cast' : undefined
  return { ...project, hash, label: at.project_name }
}
