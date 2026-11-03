/** 把一集合成为 mp4。有过时产物时要调用方显式传 force。 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { episodeProgress } from '../domain/progress'
import { assembleArgs, assembleFrame, durationArgs, loudnessArgs, loudnessGain, parseLoudness, type Segment } from '../local/ffmpeg'
import { parseUtterances, utteranceTexts } from '../domain/beats'
import { runCommand } from '../local/command'
import { Conflict } from '../domain/errors'
import { appendEvent } from '../repo/runs'
import { getProject } from '../repo/projects'
import { currentArtifacts, listShots, recordArtifact, shotViews } from '../repo/shots'
import { filmDir } from '../store/paths'
import { effectiveAudioMode, type GenContext } from './gen'
import type { EpisodeRow } from '../repo/projects'

export interface AssembleResult {
  readonly path: string
  readonly commandId: string
  readonly sh: string
  readonly seconds: number
}

export async function assembleEpisode(ctx: GenContext, episode: EpisodeRow, options: { force?: boolean } = {}): Promise<AssembleResult> {
  const project = getProject(ctx.db, episode.project_id)
  // 视频端点不出声时实际是单独配音，按作品设置取视频音轨会让 ffmpeg 失败。
  const audioMode = effectiveAudioMode(ctx.db, project.id, project.audio_mode)
  const progress = episodeProgress(shotViews(ctx.db, episode.id), audioMode)
  if (progress.assemblable === 'blocked') {
    throw new Conflict('还有镜头缺视频或配音，无法合成。先把缺的那几镜做完。')
  }
  if (progress.assemblable === 'needs_confirm' && !options.force) {
    throw new Conflict('有视频或配音已过时（上游改过）。确认要用当前这一版合成，或先重新生成过时的镜头。')
  }

  const segments: Segment[] = []
  const shots = listShots(ctx.db, episode.id)
  for (const shot of shots) {
    const artifacts = currentArtifacts(ctx.db, { kind: 'shot', id: shot.id })
    const video = artifacts.find((a) => a.kind === 'clip')?.path
    if (!video) throw new Conflict(`第 ${shot.idx + 1} 镜没有视频`)
    const seconds = await clipSeconds(video)
    const fadeIn = shot.join_mode === 'fade'
    // 有配音就用配音：它反映这一镜生成时的实际音轨模式。
    const audio = artifacts.find((a) => a.kind === 'voice')?.path
    const nativeAudio = !audio && audioMode === 'native'
    const source = audio ?? (nativeAudio ? video : undefined)
    const measured = source ? await measureLoudness(source) : null
    const gainDb = measured ? loudnessGain(measured, utteranceTexts(parseUtterances(shot.utterances)).length > 0) : 0
    if (audio) segments.push({ video, seconds, audio, fadeIn, gainDb })
    else segments.push({ video, seconds, nativeAudio, fadeIn, gainDb })
  }
  if (segments.length === 0) throw new Conflict('本集没有任何镜头')

  const dir = filmDir(episode.project_id)
  await mkdir(dir, { recursive: true })
  const version = currentArtifacts(ctx.db, { kind: 'episode', id: episode.id }).find((a) => a.kind === 'film')
  const output = join(dir, `${episode.id}_v${(version?.version ?? 0) + 1}.mp4`)

  const argv = assembleArgs(segments, output, assembleFrame(project.aspect))
  appendEvent(ctx.db, ctx.runId, { type: 'command_started', kind: 'assemble', episode_id: episode.id })

  const outcome = await runCommand(ctx.db, {
    owner: { kind: 'episode', id: episode.id },
    kind: 'assemble',
    argv,
    artifacts: [output],
  })

  appendEvent(ctx.db, ctx.runId, {
    type: 'command_finished',
    command_id: outcome.id,
    exit_code: outcome.exitCode,
    error: outcome.error,
  })

  if (outcome.error) throw new Conflict(`合成失败：${outcome.error}`)

  recordArtifact(ctx.db, { kind: 'episode', id: episode.id }, 'film', { path: output, commandId: outcome.id })
  return {
    path: output,
    commandId: outcome.id,
    sh: outcome.sh,
    seconds: segments.reduce((sum, s) => sum + s.seconds, 0),
  }
}

async function clipSeconds(video: string): Promise<number> {
  const proc = Bun.spawn(durationArgs(video), { stdout: 'pipe', stderr: 'pipe' })
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  const seconds = Number(text.trim())
  if (code !== 0 || !(seconds > 0)) throw new Conflict(`读不出视频时长：${video}`)
  return seconds
}

async function measureLoudness(input: string) {
  const proc = Bun.spawn(loudnessArgs(input), { stdout: 'ignore', stderr: 'pipe' })
  const [text, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Conflict(`测不出音量：${input}`)
  return parseLoudness(text)
}
