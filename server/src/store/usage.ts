/** 数据目录的占用统计。 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface DiskUsage {
  files: number
  bytes: number
}

/** 目录不存在算 0，部分目录用到时才创建。 */
export function dirUsage(path: string): DiskUsage {
  let files = 0
  let bytes = 0

  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      // 不跟随符号链接，避免算进根外的文件或形成环。
      if (!entry.isFile()) continue
      try {
        bytes += statSync(child).size
        files += 1
      } catch {
        // 扫描期间被删的文件跳过。
      }
    }
  }

  walk(path)
  return { files, bytes }
}

export function fileUsage(path: string): DiskUsage {
  try {
    return { files: 1, bytes: statSync(path).size }
  } catch {
    return { files: 0, bytes: 0 }
  }
}
