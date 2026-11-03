/** 逐镜写首帧与视频提示词，一镜一次文本调用。生成某镜首帧或视频时提示词为空才现写，单镜也能手动重写。 */

import { SHOT_SIZE_LABEL, type Utterance } from '@vesper/shared'

import { argsFor, effectiveAudioMode, generateText, type GenContext } from './gen'
import { parseReply, z } from './reply'
import { SHOT_PROMPT_SYSTEM, shotPromptDraft } from './prompts'
import { parseBeats } from '../domain/beats'
import { anchorText, characterIn, getAssetVersion } from '../repo/assets'
import { getEpisode, getProject } from '../repo/projects'
import { castOf, listShots, propsOf, sceneRefOf, utterancesOf, type ShotRow } from '../repo/shots'
import { episodeText } from '../repo/sources'
import { updateShot } from '../service/shots'

const draftSchema = z.object({
  image_prompt: z.string().min(1),
  motion_prompt: z.string().min(1),
  sound: z.string().default(''),
  lines: z.array(z.object({ how: z.string().default('') })).default([]),
})

export async function polishShot(ctx: GenContext, shot: ShotRow): Promise<void> {
  const episode = getEpisode(ctx.db, shot.episode_id)
  const beat = parseBeats(episode.beats)[shot.beat_index]
  const source =
    beat?.source_start !== undefined && beat.source_end !== undefined
      ? episodeText(ctx.db, episode).slice(beat.source_start, beat.source_end)
      : ''

  const shots = listShots(ctx.db, episode.id)
  const at = shots.findIndex((s) => s.id === shot.id)
  const before = shots[at - 1]
  const after = shots[at + 1]
  const sceneRef = sceneRefOf(shot)

  const { text } = await generateText(ctx, {
    owner: { kind: 'shot', id: shot.id },
    purpose: 'shot_prompt',
    label: `第 ${shot.idx + 1} 镜提示词`,
    params: {
      system: SHOT_PROMPT_SYSTEM,
      prompt: shotPromptDraft(
        {
          episode: { title: episode.title, synopsis: episode.synopsis },
          beatSummary: beat?.summary ?? '',
          sourceText: source,
          previous: before ? { summary: before.summary, camera: before.camera, ending: before.motion_prompt } : null,
          next: after ? { summary: after.summary, camera: after.camera } : null,
          shot: {
            summary: shot.summary,
            scene: shot.scene,
            shotSize: SHOT_SIZE_LABEL[shot.shot_size],
            camera: shot.camera,
            cameraMove: shot.camera_move,
            mood: shot.mood,
            seconds: shot.seconds,
            clipSource: shot.clip_source,
          },
          utterances: utterancesOf(shot),
          cast: castOf(shot).map((m) => {
            const version = getAssetVersion(ctx.db, m.version_id)
            const character = characterIn(version)
            return { name: version.person, identity: character.identity, traits: character.traits }
          }),
          sceneAnchor: sceneRef ? anchorText(getAssetVersion(ctx.db, sceneRef.version_id)) : '',
          props: propsOf(shot).map((p) => ({
            name: p.name,
            description: anchorText(getAssetVersion(ctx.db, p.version_id)),
          })),
        },
        argsFor(ctx, 'shot_prompt'),
      ),
    },
  })

  const reply = parseReply(text, draftSchema, '镜头提示词')
  const audio = effectiveAudioMode(ctx.db, ctx.projectId, getProject(ctx.db, ctx.projectId).audio_mode)
  updateShot(ctx.db, shot.id, { imagePrompt: reply.image_prompt, motionPrompt: reply.motion_prompt, sound: reply.sound, utterances: withHow(utterancesOf(shot), reply.lines) }, audio)
}

/** 按顺序把 how 挂回有字的台词，条数对不上时多的丢掉、少的留空。 */
export function withHow(utterances: readonly Utterance[], lines: readonly { how: string }[]): Utterance[] {
  const spoken = utterances.filter((u) => u.text.trim() !== '')
  return utterances.map((u) => {
    const how = (lines[spoken.indexOf(u)]?.how ?? '').trim()
    return how === '' ? { speaker: u.speaker, text: u.text } : { speaker: u.speaker, text: u.text, how }
  })
}
