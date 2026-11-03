/** 环境变量在启动时解析一次，不合法就不启动。 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { z } from 'zod'

export const DATA_DIR_ENV = 'VESPER_DATA_DIR'

const SCHEMA = z.object({
  VESPER_PORT: z.coerce.number().int().positive().max(65535).default(8787),
  /** 往返明细的保留天数，0 表示不清理。 */
  VESPER_CALLS_DAYS: z.coerce.number().int().nonnegative().default(30),
  [DATA_DIR_ENV]: z.string().min(1).default(join(homedir(), '.vesper')),
})

export interface Config {
  readonly port: number
  readonly callsDays: number
  /** 绝对路径：`/api/files` 的越权检查按前缀比对。 */
  readonly dataDir: string
}

function load(): Config {
  const parsed = SCHEMA.safeParse(Bun.env)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`环境变量有问题，先改对再启动：${detail}`)
  }
  return {
    port: parsed.data.VESPER_PORT,
    callsDays: parsed.data.VESPER_CALLS_DAYS,
    dataDir: resolve(parsed.data[DATA_DIR_ENV]),
  }
}

export const config = load()
