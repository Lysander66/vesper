/** 数据目录布局。全部放在同一个根下，`/api/files` 只放行根内的路径。 */

import { mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { config } from '../config'

export function dataRoot(): string {
  return config.dataDir
}

/** SQLite 不会创建父目录，启动时先建好根目录。 */
export function ensureDataRoot(): string {
  const root = dataRoot()
  mkdirSync(root, { recursive: true })
  return root
}

export function dbFile(): string {
  return join(dataRoot(), 'vesper.db')
}

/** 一部作品的生成产物，文件名按 jobId 命名。 */
export function artifactDir(projectId: string): string {
  return join(artifactsRoot(), projectId)
}

export function artifactsRoot(): string {
  return join(dataRoot(), 'artifacts')
}

export function filmDir(projectId: string): string {
  return join(filmsRoot(), projectId)
}

export function filmsRoot(): string {
  return join(dataRoot(), 'films')
}

/** 素材库的图和音色样本。存入时从作品复制，作品删除后仍在。 */
export function libraryDir(): string {
  return join(dataRoot(), 'library')
}

/** 预置音色的录音与清单，角色选用时直接引用这里的文件。 */
export function voicesDir(): string {
  return join(dataRoot(), 'voices')
}

export function uploadDir(): string {
  return join(dataRoot(), 'uploads')
}

/** 导出的请求 JSON，供 tools/send.ts 手动重发。 */
export function requestDir(): string {
  return join(dataRoot(), 'requests')
}

export function insideRoot(path: string): boolean {
  const root = dataRoot()
  const target = resolve(path)
  return target === root || target.startsWith(root + sep)
}
