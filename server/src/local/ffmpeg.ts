/** ffmpeg 命令的构造，纯函数。合成只发一条命令，界面上显示的那行粘进终端就能得到同一个 mp4。 */

import type { Aspect } from '@vesper/shared'

export interface Segment {
  readonly video: string
  /** 配音。没有时补等长静音，每段的音轨结构一致。 */
  readonly audio?: string
  /** 用视频自带的音轨，与 `audio` 互斥。视频没有音轨时 ffmpeg 报错。 */
  readonly nativeAudio?: boolean
  readonly seconds: number
  readonly gainDb?: number
  /** 这一段前面的接缝过黑场，不置即硬切。 */
  readonly fadeIn?: boolean
}

export interface AssembleOptions {
  readonly width: number
  readonly height: number
  readonly fps: number
  /** 转场时长。用黑场不用交叉溶解：溶解会让两段重叠，总时长不再等于各段之和。 */
  readonly fadeSeconds: number
  readonly sampleRate: number
}

export const DEFAULT_ASSEMBLE: AssembleOptions = {
  width: 1280,
  height: 720,
  fps: 24,
  fadeSeconds: 0.4,
  sampleRate: 44100,
}

/** 合成版的画框跟作品画幅走，短边 720。 */
export function assembleFrame(aspect: Aspect): AssembleOptions {
  if (aspect === '9:16') return { ...DEFAULT_ASSEMBLE, width: 720, height: 1280 }
  if (aspect === '1:1') return { ...DEFAULT_ASSEMBLE, width: 720, height: 720 }
  return DEFAULT_ASSEMBLE
}

export function assembleArgs(segments: readonly Segment[], output: string, options: AssembleOptions = DEFAULT_ASSEMBLE, ffmpeg = 'ffmpeg'): string[] {
  if (segments.length === 0) throw new Error('没有任何镜头视频，无法合成')

  const { width: w, height: h, fps, sampleRate } = options
  const inputs: string[] = []
  const filters: string[] = []
  const concatInputs: string[] = []

  // 自带音轨的段只占一路输入，所以输入序号逐路递增，不按段下标算。
  let next = 0
  segments.forEach((segment, i) => {
    const d = segment.seconds
    const videoIndex = next++

    inputs.push('-i', segment.video)
    let audioIndex: number
    if (segment.audio) {
      inputs.push('-i', segment.audio)
      audioIndex = next++
    } else if (segment.nativeAudio) {
      audioIndex = videoIndex
    } else {
      inputs.push('-f', 'lavfi', '-t', num(d), '-i', `anullsrc=r=${sampleRate}:cl=stereo`)
      audioIndex = next++
    }

    const fade = fadeFor(d, options.fadeSeconds)
    // 段尾是否淡出看下一段是否过黑场；首尾两端总是淡入淡出。
    const last = i === segments.length - 1
    const fadeIn = fade > 0 && (i === 0 || segment.fadeIn === true)
    const fadeOut = fade > 0 && (last || segments[i + 1]?.fadeIn === true)
    // 声音跟画面同进同退，硬切处不淡音，台词可以跨镜说完。
    const inAt = `st=0:d=${num(fade)}`
    const outAt = `st=${num(d - fade)}:d=${num(fade)}`

    filters.push(
      // 铺满后居中裁掉多出的边，不补黑边：首帧可能是 3:2 这类非目标画幅，补边会让合成版夹进带黑边的段落。
      `[${videoIndex}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
        `crop=${w}:${h},setsar=1,fps=${fps},` +
        // 先定格补长再截断，视频比声明时长短或长都得到确定的时长。
        `tpad=stop_mode=clone:stop_duration=${num(d)},trim=0:${num(d)},setpts=PTS-STARTPTS` +
        (fadeIn ? `,fade=t=in:${inAt}` : '') +
        (fadeOut ? `,fade=t=out:${outAt}` : '') +
        `[v${i}]`,
    )
    filters.push(
      `[${audioIndex}:a]aresample=${sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        (segment.gainDb ? `volume=${num(segment.gainDb)}dB,` : '') +
        // 配音补静音到时长再截，音画不会逐段累积错位。
        `apad,atrim=0:${num(d)},asetpts=PTS-STARTPTS` +
        (fadeIn ? `,afade=t=in:${inAt}` : '') +
        (fadeOut ? `,afade=t=out:${outAt}` : '') +
        `[a${i}]`,
    )
    concatInputs.push(`[v${i}][a${i}]`)
  })

  filters.push(`${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[v][a]`)

  return [
    ffmpeg,
    '-hide_banner',
    // 覆盖已有输出，避免交互式确认挂住进程。
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    // 浏览器与多数播放器不支持 x264 的默认像素格式。
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    // moov 前置，界面里可以边下边播。
    '-movflags',
    '+faststart',
    output,
  ]
}

/** 长边缩到 `maxSide` 以内、转 JPEG 另存。 */
export function compactImageArgs(input: string, output: string, maxSide = 2048, ffmpeg = 'ffmpeg'): string[] {
  const scale = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`
  return [ffmpeg, '-v', 'error', '-y', '-i', input, '-vf', scale, '-q:v', '3', output]
}

/** 截取音频前 `seconds` 秒，转成 mp3 另存。 */
export function trimAudioArgs(input: string, seconds: number, output: string, ffmpeg = 'ffmpeg'): string[] {
  return [ffmpeg, '-v', 'error', '-y', '-i', input, '-t', seconds.toFixed(1), '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output]
}

/** 读视频时长，stdout 输出秒数。 */
export function durationArgs(video: string, ffprobe = 'ffprobe'): string[] {
  return [ffprobe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]
}

export interface Loudness {
  /** 综合响度，LUFS。 */
  readonly integrated: number
  /** 真峰值，dBTP。 */
  readonly truePeak: number
}

/** 有台词镜头的响度范围，LUFS。 */
export const SPEECH_LUFS = { floor: -20, ceiling: -14 } as const
const PEAK_CEILING = -1

/** 测综合响度与真峰值，结果在 stderr 末尾的 JSON 里。 */
export function loudnessArgs(input: string, ffmpeg = 'ffmpeg'): string[] {
  return [ffmpeg, '-hide_banner', '-nostats', '-i', input, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-']
}

/** 全静音时响度是 -inf，返回 null，这一段不调。 */
export function parseLoudness(stderr: string): Loudness | null {
  const start = stderr.lastIndexOf('{')
  if (start < 0) return null
  try {
    const json = JSON.parse(stderr.slice(start, stderr.indexOf('}', start) + 1)) as Record<string, string>
    const integrated = Number(json.input_i)
    const truePeak = Number(json.input_tp)
    return Number.isFinite(integrated) && Number.isFinite(truePeak) ? { integrated, truePeak } : null
  } catch {
    return null
  }
}

/** 超上限的压到上限，有台词且低于下限的抬到下限，峰值压在 -1 dBTP 以下。只有环境声的不抬，避免底噪被放大。 */
export function loudnessGain(measured: Loudness, speech: boolean, range = SPEECH_LUFS): number {
  const { integrated, truePeak } = measured
  let gain = 0
  if (integrated > range.ceiling) gain = range.ceiling - integrated
  else if (speech && integrated < range.floor) gain = range.floor - integrated
  return Math.min(gain, PEAK_CEILING - truePeak)
}

/** 抽末帧给下一镜的首帧当参考图。`-sseof` 从末尾定位，不必先读时长。 */
export function tailFrameArgs(video: string, output: string, ffmpeg = 'ffmpeg'): string[] {
  return [
    ffmpeg,
    '-hide_banner',
    '-y',
    // 倒数 0.2 秒内取一帧，再靠后可能取不到画面。
    '-sseof',
    '-0.2',
    '-i',
    video,
    '-frames:v',
    '1',
    // 不加 -update，ffmpeg 会把单帧输出当成图片序列，对不含 %d 的文件名报错。
    '-update',
    '1',
    '-q:v',
    '2',
    output,
  ]
}

/** 段太短不做转场，否则基本只剩黑场。 */
function fadeFor(seconds: number, fadeSeconds: number): number {
  if (fadeSeconds <= 0) return 0
  return seconds > fadeSeconds * 3 ? fadeSeconds : 0
}

/** 定长小数位，命令里不出现浮点尾数。 */
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
