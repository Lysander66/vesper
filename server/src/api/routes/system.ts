/** 数据目录：位置、占用与在文件管理器中打开。目录只能通过环境变量修改。 */

import type { StorageEntry, StorageView } from '@vesper/shared'

import { BadRequest, body, json, z, type Register } from '../http'
import { DATA_DIR_ENV } from '../../config'
import { artifactsRoot, dataRoot, dbFile, filmsRoot, libraryDir, requestDir, uploadDir, voicesDir } from '../../store/paths'
import { dirUsage, fileUsage } from '../../store/usage'

const REVEAL_KEYS = ['root', 'db', 'artifacts', 'films', 'library', 'voices', 'uploads', 'requests'] as const
type RevealKey = (typeof REVEAL_KEYS)[number]

const ENTRIES: { key: StorageEntry['key']; label: string; purpose: string; path: () => string }[] = [
  { key: 'db', label: 'vesper.db', purpose: '作品、镜头、产物索引', path: dbFile },
  { key: 'artifacts', label: 'artifacts/', purpose: '设定图、首帧图、视频、配音', path: artifactsRoot },
  { key: 'films', label: 'films/', purpose: '合成版', path: filmsRoot },
  { key: 'library', label: 'library/', purpose: '素材库的设定图与试音', path: libraryDir },
  { key: 'voices', label: 'voices/', purpose: '预置音色', path: voicesDir },
  { key: 'uploads', label: 'uploads/', purpose: '手动上传的图片与音频', path: uploadDir },
  { key: 'requests', label: 'requests/', purpose: '导出的请求 JSON', path: requestDir },
]

const OPENERS: Record<string, string[] | undefined> = {
  darwin: ['open'],
  win32: ['explorer'],
  linux: ['xdg-open'],
}

export function registerSystem(on: Register): void {
  on('GET', '/api/system/storage', () => json(storageView()))

  on('POST', '/api/system/reveal', async (request) => {
    const input = await body(request, z.object({ key: z.enum(REVEAL_KEYS) }))
    reveal(input.key)
    return json({ opened: 'yes' })
  })
}

function storageView(): StorageView {
  const entries = ENTRIES.map((entry) => {
    const path = entry.path()
    // db 是单个文件，不按目录统计。
    const usage = entry.key === 'db' ? fileUsage(path) : dirUsage(path)
    return { key: entry.key, label: entry.label, purpose: entry.purpose, path, ...usage }
  })
  return {
    root: dataRoot(),
    env_var: DATA_DIR_ENV,
    entries,
    total_bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  }
}

/** 路径由 key 在服务端解析，不接受客户端给的路径：这一条最终要交给 shell。 */
function reveal(key: RevealKey): void {
  const path = key === 'root' ? dataRoot() : (ENTRIES.find((entry) => entry.key === key)?.path() ?? dataRoot())
  const opener = OPENERS[process.platform]
  if (!opener) throw new BadRequest(`这个平台没法打开文件管理器：${process.platform}`)
  Bun.spawn([...opener, path], { stdout: 'ignore', stderr: 'ignore' })
}
