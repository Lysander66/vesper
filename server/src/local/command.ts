/** 本地命令（ffmpeg）的执行与记录，每条命令导出为可在终端重跑的一行 shell。 */

import type { OwnerKind } from '@vesper/shared'

import { shellQuote } from '../endpoint/curl'
import { newId } from '../db/id'

import { RECORD_LIMIT, recordScope, type OwnerRef, type RecordFilter } from '../db/records'

import type { Database } from 'bun:sqlite'

/** 输出保留上限，按字符计。保留尾部：报错在最后几行。 */
const KEEP_TAIL_CHARS = 8_000

export interface CommandRow {
  readonly id: string
  readonly owner_kind: OwnerKind | null
  readonly owner_id: string | null
  readonly kind: string
  readonly argv: string
  readonly cwd: string
  readonly exit_code: number | null
  readonly stdout: string | null
  readonly stderr: string | null
  readonly artifacts: string | null
  readonly started_at: string
  readonly duration_ms: number | null
  readonly error: string | null
}

export interface RunCommandInput {
  readonly owner?: OwnerRef | undefined
  readonly kind: string
  readonly argv: readonly string[]
  readonly cwd?: string | undefined
  /** 预期产出的文件。跑完逐个确认存在：退出码为 0 也可能没产出文件。 */
  readonly artifacts?: readonly string[] | undefined
}

export interface CommandOutcome {
  readonly id: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly artifacts: string[]
  /** 可粘进终端重跑的那一行。 */
  readonly sh: string
  readonly error?: string
}

const BARE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/

/** 只给需要的参数加引号，命令才读得下去。 */
export function shellCommand(argv: readonly string[]): string {
  return argv.map((arg) => (BARE_TOKEN.test(arg) ? arg : shellQuote(arg))).join(' ')
}

export class CommandFailure extends Error {
  readonly commandId: string

  constructor(message: string, commandId: string) {
    super(message)
    this.name = 'CommandFailure'
    this.commandId = commandId
  }
}

/** 跑一条本地命令并记录，失败也照样记下。 */
export async function runCommand(db: Database, input: RunCommandInput): Promise<CommandOutcome> {
  const id = newId('cmd')
  const cwd = input.cwd ?? process.cwd()
  const sh = shellCommand(input.argv)
  const startedAt = new Date()
  const started = performance.now()

  db.query(
    `INSERT INTO commands (id, owner_kind, owner_id, kind, argv, cwd, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.owner?.kind ?? null,
    input.owner?.id ?? null,
    input.kind,
    JSON.stringify(input.argv),
    cwd,
    startedAt.toISOString(),
  )

  let exitCode = -1
  let stdout = ''
  let stderr = ''
  let spawnError: string | undefined

  try {
    const proc = Bun.spawn([...input.argv], { cwd, stdout: 'pipe', stderr: 'pipe' })
    ;[stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    exitCode = await proc.exited
  } catch (cause) {
    // 进程没能启动，多半是没装 ffmpeg，与命令执行失败分开报。
    spawnError = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
  }

  const produced: string[] = []
  const missing: string[] = []
  for (const path of input.artifacts ?? []) {
    ;((await Bun.file(path).exists()) ? produced : missing).push(path)
  }

  const error =
    spawnError ??
    (exitCode !== 0
      ? `命令以 ${exitCode} 退出：${tail(stderr) || tail(stdout) || '没有任何输出'}`
      : missing.length > 0
        ? `命令成功退出但预期产物不存在：${missing.join('、')}`
        : undefined)

  db.query(
    `UPDATE commands SET exit_code = ?, stdout = ?, stderr = ?, artifacts = ?, duration_ms = ?, error = ? WHERE id = ?`,
  ).run(
    spawnError ? null : exitCode,
    tail(stdout) || null,
    tail(stderr) || null,
    JSON.stringify(produced),
    Math.round(performance.now() - started),
    error ?? null,
    id,
  )

  return { id, exitCode, stdout, stderr, artifacts: produced, sh, ...(error ? { error } : {}) }
}

export function listCommands(db: Database, filter: RecordFilter): CommandRow[] {
  const { where, args } = recordScope(filter, 'commands')
  return db.query(`SELECT * FROM commands WHERE (${where}) ORDER BY started_at DESC LIMIT ?`).all(...args, filter.limit ?? RECORD_LIMIT) as CommandRow[]
}

function tail(text: string): string {
  if (text.length <= KEEP_TAIL_CHARS) return text
  return `…（前 ${text.length - KEEP_TAIL_CHARS} 字符已截断）\n${text.slice(-KEEP_TAIL_CHARS)}`
}
