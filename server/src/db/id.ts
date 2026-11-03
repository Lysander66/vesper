/** 全库主键的生成。放在 db 层，records 与 command 也要发 ID。 */

/** 每张表一个前缀。 */
export type IdPrefix =
  | 'proj'
  | 'src'
  | 'ep'
  | 'epv'
  | 'shot'
  | 'art'
  | 'asset'
  | 'av'
  | 'run'
  | 'job'
  | 'cmd'
  | 'cred'
  | 'endpoint'
  | 'binding'

/** 带前缀的短 ID，如 `job-1a2b3c4d5e6f`。 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}
