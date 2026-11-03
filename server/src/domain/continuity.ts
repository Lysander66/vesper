import { CONTINUITY_MODES, type ContinuityMode, type ShotJoin } from '@vesper/shared'

export function isContinuityMode(value: unknown): value is ContinuityMode {
  return typeof value === 'string' && (CONTINUITY_MODES as readonly string[]).includes(value)
}

/** 首帧参考图是否带上一镜末帧：开启衔接、这一镜标了接上一镜、且两镜是同一场景锁定版。 */
export function continuesPrevious(mode: ContinuityMode, join: ShotJoin, previousScene: string | null, scene: string | null): boolean {
  return mode === 'chain' && join === 'continue' && previousScene !== null && previousScene === scene
}
