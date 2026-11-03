/** 画幅换算成端点声明过的取值。 */

import { ASPECTS, type Aspect } from '@vesper/shared'

export function isAspect(value: unknown): value is Aspect {
  return typeof value === 'string' && (ASPECTS as readonly string[]).includes(value)
}

/** 只认 `<宽>x<高>`，跳过 "720p" 这类档位写法。 */
export function pickSize(resolutions: readonly string[], aspect: Aspect): string | null {
  const [targetW = 1, targetH = 1] = aspect.split(':').map(Number)
  let best: { size: string; distance: number } | null = null

  for (const item of resolutions) {
    const match = /^(\d+)x(\d+)$/.exec(item.trim())
    if (!match) continue
    const width = Number(match[1])
    const height = Number(match[2])
    if (height === 0) continue
    // 比较对数差，横竖两档到方图等距；交叉相乘保证平局时浮点严格相等。
    const distance = Math.abs(Math.log(width * targetH) - Math.log(height * targetW))
    if (!best || distance < best.distance) best = { size: item, distance }
  }
  return best?.size ?? null
}

/** 端点声明了这个画幅才填，否则不填。 */
export function pickAspectRatio(aspectRatios: readonly string[] | undefined, aspect: Aspect): string | null {
  return aspectRatios?.includes(aspect) === true ? aspect : null
}
