/** 轮询策略：退避间隔、总时限与瞬时失败次数分别设定。 */

import type { HttpOutcome } from './send'

export interface PollPolicy {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly factor: number
  /** 抖动比例 0–1：实际等待在 `[base*(1-jitter), base]` 内取值，错开多个任务的轮询。 */
  readonly jitter: number
  /** 从提交成功算起，整个任务允许跑多久。 */
  readonly overallTimeoutMs: number
  readonly requestTimeoutMs: number
  /** 允许连续瞬时失败的次数，成功轮询一次后归零。 */
  readonly maxTransientFailures: number
}

export const DEFAULT_POLL_POLICY: PollPolicy = {
  initialDelayMs: 2_000,
  maxDelayMs: 30_000,
  factor: 1.6,
  jitter: 0.2,
  overallTimeoutMs: 20 * 60 * 1_000,
  requestTimeoutMs: 60_000,
  maxTransientFailures: 5,
}

/** 产物可能有几十 MB，单次超时要长。 */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1_000

/** 提交请求体里有兆级 base64，供应商可能过一两分钟才回应。 */
export const SUBMIT_TIMEOUT_MS = 5 * 60 * 1_000

export function delayFor(attempt: number, policy: PollPolicy, random: () => number = Math.random): number {
  const base = Math.min(policy.initialDelayMs * policy.factor ** attempt, policy.maxDelayMs)
  return Math.round(base * (1 - policy.jitter * random()))
}

/** 4xx 里只有 408 与 429 值得重试。 */
export function isTransient(outcome: HttpOutcome): boolean {
  if (outcome.transport) return true
  const code = outcome.statusCode
  if (code === undefined) return true
  return code >= 500 || code === 408 || code === 429
}

export interface Clock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason as Error)
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal?.reason as Error)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}
