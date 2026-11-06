import type { Database } from 'bun:sqlite'

import { HOME_STAGES, type HomeProject, type HomePulse, type HomeView, type OwnerKind, type SlotStatus } from '@vesper/shared'

import { episodeProgress, overallPercent } from '../domain/progress'
import { effectiveAudioMode } from '../pipeline/gen'
import { listEpisodes, listProjects, type ProjectRow } from '../repo/projects'
import { listSources } from '../repo/sources'
import { listShots, shotViews } from '../repo/shots'
import { projectPlanState } from '../service/sources'
import {
  assetName,
  assetStateCounts,
  callTotalsSince,
  countDraftAssets,
  countEpisodesWithFilm,
  countJobs,
  countRunningRuns,
  coverPath,
  episodeIdx,
  jobPulseSince,
  jobStatusCountsSince,
  lastShotJob,
  projectName,
  shotPosition,
} from '../repo/stats'

export function homeView(db: Database): HomeView {
  const projects = listProjects(db).map((project) => projectCard(db, project))
  return {
    projects,
    today: todayCounts(db),
    pulse: todayPulse(db),
    total_jobs: countJobs(db),
    stale: projects.reduce((sum, p) => sum + p.stale, 0),
    unlocked: countDraftAssets(db),
    running: countRunningRuns(db),
    resume: lastShotJob(db),
  }
}

function projectCard(db: Database, project: ProjectRow): HomeProject {
  const projectId = project.id
  const sources = listSources(db, projectId)
  const episodes = listEpisodes(db, projectId)
  const audioMode = effectiveAudioMode(db, projectId, project.audio_mode)
  const progress = episodes.map((episode) => episodeProgress(shotViews(db, episode.id), audioMode))

  const counts = {} as Record<SlotStatus, number>
  for (const episode of progress) {
    for (const [slot, n] of Object.entries(episode.counts)) {
      counts[slot as SlotStatus] = (counts[slot as SlotStatus] ?? 0) + n
    }
  }
  const total = Object.entries(counts).reduce((sum, [slot, n]) => (slot === 'skipped' ? sum : sum + n), 0)
  const shots = episodes.reduce((sum, episode) => sum + listShots(db, episode.id).length, 0)
  const films = countEpisodesWithFilm(db, projectId)
  const { locked, drafts } = assetStateCounts(db, projectId)
  const planState = projectPlanState(db, projectId)

  return {
    id: project.id,
    name: project.name,
    style: project.style,
    aspect: project.aspect,
    source_name: sources.map((source) => source.name).join('、'),
    char_count: sources.reduce((sum, source) => sum + source.text.length, 0),
    plan_state: planState,
    episodes: episodes.length,
    shots,
    films,
    cover: coverPath(db, projectId),
    percent: overallPercent(progress),
    ready: counts.ready ?? 0,
    stale: counts.stale ?? 0,
    total,
    stage: stageOf({ episodes: episodes.length, frozen: planState === 'frozen', locked, drafts, shots, films }),
  }
}

interface StageInput {
  episodes: number
  frozen: boolean
  locked: number
  drafts: number
  shots: number
  films: number
}

/** 所处阶段，1 起；全部完成为 `HOME_STAGES.length + 1`。 */
function stageOf(input: StageInput): number {
  const done = [
    true,
    input.episodes > 0 && input.frozen,
    input.locked > 0 && input.drafts === 0,
    input.shots > 0 && input.episodes > 0,
    input.films > 0 && input.films === input.episodes,
  ]
  const at = done.indexOf(false)
  return at === -1 ? HOME_STAGES.length + 1 : at + 1
}

function todayCounts(db: Database) {
  const since = midnight()
  const jobs = jobStatusCountsSince(db, since)
  const calls = callTotalsSince(db, since)

  return {
    jobs: jobs.reduce((sum, row) => sum + row.n, 0),
    failed: jobs.find((row) => row.status === 'failed')?.n ?? 0,
    calls: calls.n,
    seconds: Math.round(calls.ms / 1000),
  }
}

function todayPulse(db: Database): HomePulse[] {
  return jobPulseSince(db, midnight()).map((row) => ({
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    owner_kind: row.owner_kind,
    owner_id: row.owner_id,
    label: ownerLabel(db, row.owner_kind, row.owner_id),
    calls: row.calls,
    // 按往返累计计时，失败的调用也有准确耗时。
    seconds: Math.round(row.ms / 100) / 10,
    at: row.created_at,
  }))
}

/** 调用的归属，如 `EP01 · S24`；认不出时回 null。 */
function ownerLabel(db: Database, kind: OwnerKind | null, id: string | null): string | null {
  if (!kind || !id) return null
  if (kind === 'shot') {
    const at = shotPosition(db, id)
    return at ? `EP${pad(at.ep + 1)} · S${pad(at.shot + 1)}` : null
  }
  if (kind === 'episode') {
    const idx = episodeIdx(db, id)
    return idx === null ? null : `EP${pad(idx + 1)}`
  }
  if (kind === 'asset') return assetName(db, id)
  return projectName(db, id)
}

/** 「今天」按本地零点算，不按 UTC。 */
function midnight(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
