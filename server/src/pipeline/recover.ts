/** 重启后续跑没完成的 job，并按 `purpose` 把产出挂回镜头或资产。 */

import { ARTIFACT_KINDS, ASSET_FILE_ROLES, type ArtifactKind, type AssetFileRole } from '@vesper/shared'

import type { Database } from 'bun:sqlite'

import { updateJob, type JobRow, type OwnerRef } from '../db/records'
import { executeJob, type RunnerOptions } from '../runner/execute'
import { AMBIGUOUS_SUBMIT_ERROR, classifyPendingJobs } from '../runner/resume'
import { addAssetFile } from '../service/assets'
import { markInterrupted } from '../repo/runs'
import { recordArtifact } from '../repo/shots'
import { ownerProjectId } from '../repo/stats'
import { artifactDir } from '../store/paths'

export interface RecoverReport {
  readonly interruptedRuns: number
  readonly resumed: string[]
  readonly abandoned: string[]
}

/** `runner` 供测试注入短超时与假时钟。 */
export async function recover(db: Database, runner: Partial<RunnerOptions> = {}): Promise<RecoverReport> {
  const interruptedRuns = markInterrupted(db)
  const { resumable, fresh, ambiguous } = classifyPendingJobs(db)

  for (const row of ambiguous) updateJob(db, row.id, { status: 'failed', error: AMBIGUOUS_SUBMIT_ERROR })

  const resumed: string[] = []
  for (const row of [...resumable, ...fresh]) {
    const owner = ownerOf(row)
    // 没有归属的 job 产出挂不回去，跳过。
    if (!owner) continue
    const projectId = ownerProjectId(db, owner)
    if (!projectId) continue

    const outcome = await executeJob(db, row.id, { artifactDir: artifactDir(projectId), ...runner })
    resumed.push(row.id)
    if (outcome.status === 'succeeded') reattach(db, row.id, owner, row.purpose ?? '', outcome.artifacts)
  }

  return { interruptedRuns, resumed, abandoned: ambiguous.map((r) => r.id) }
}

function reattach(db: Database, jobId: string, owner: OwnerRef, purpose: string, artifacts: readonly string[]): void {
  const path = artifacts[0]
  if (path === undefined) return

  if (owner.kind === 'shot' && (ARTIFACT_KINDS as readonly string[]).includes(purpose)) {
    recordArtifact(db, { kind: 'shot', id: owner.id }, purpose as ArtifactKind, { path, jobId })
    return
  }
  if (owner.kind === 'asset') {
    const role = assetRole(purpose)
    if (role) addAssetFile(db, owner.id, { role, path, jobId })
  }
}

function assetRole(purpose: string): AssetFileRole | null {
  const name = purpose.replace(/^look_/, '')
  return (ASSET_FILE_ROLES as readonly string[]).includes(name) ? (name as AssetFileRole) : null
}

function ownerOf(job: JobRow): OwnerRef | null {
  return job.owner_kind && job.owner_id ? { kind: job.owner_kind, id: job.owner_id } : null
}
