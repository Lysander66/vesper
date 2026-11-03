/** 预置音色。清单与录音都在数据目录里，没下载过就是空的。 */

import type { Database } from 'bun:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { VoicePreset } from '@vesper/shared'

import { Conflict, NotFound } from '../domain/errors'
import { getAsset } from '../repo/assets'
import { voicesDir } from '../store/paths'
import { addAssetFile } from './assets'

export function listVoices(): VoicePreset[] {
  const index = join(voicesDir(), 'index.json')
  if (!existsSync(index)) return []
  return JSON.parse(readFileSync(index, 'utf8')) as VoicePreset[]
}

/** 录音直接作为该角色的当前试音。不复制文件：预置录音不会变。 */
export function applyVoice(db: Database, assetId: string, voiceId: string): void {
  if (getAsset(db, assetId).category !== 'character') throw new Conflict('只有角色有试音')
  const voice = listVoices().find((item) => item.id === voiceId)
  if (voice === undefined) throw new NotFound(`预置音色 ${voiceId}`)
  addAssetFile(db, assetId, { role: 'voice_sample', label: voice.name, path: voice.path })
}
