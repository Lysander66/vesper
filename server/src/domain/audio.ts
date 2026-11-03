import { AUDIO_MODES, type AudioMode } from '@vesper/shared'

export function isAudioMode(value: unknown): value is AudioMode {
  return typeof value === 'string' && (AUDIO_MODES as readonly string[]).includes(value)
}

/** 视频端点不出声时 `native` 改为单独配音。 */
export function resolveAudioMode(wanted: AudioMode, endpointHasAudio: boolean): AudioMode {
  return wanted === 'native' && !endpointHasAudio ? 'separate' : wanted
}
