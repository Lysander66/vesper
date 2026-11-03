/** 产物文件的读取与上传落盘。路径解析后必须在数据目录内；合成版有几十 MB，所以支持 Range。 */

import { mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { insideRoot, uploadDir } from '../store/paths'
import { BadRequest, query } from './http'

/** 上传文件复制进数据目录：`serveFile` 只认数据目录内的路径。 */
export async function saveUpload(file: File, media: 'image' | 'audio'): Promise<string> {
  if (!file.type.startsWith(`${media}/`)) throw new BadRequest(media === 'image' ? '仅支持图片' : '仅支持音频')
  const dir = uploadDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}${extname(file.name) || (media === 'image' ? '.png' : '.wav')}`)
  await Bun.write(path, file)
  return path
}

export async function serveFile(request: Request): Promise<Response> {
  const path = query(request, 'path')
  if (!path) throw new BadRequest('缺少 path 参数')
  if (!insideRoot(path)) throw new BadRequest('路径不在数据目录内')

  const file = Bun.file(path)
  if (!(await file.exists())) return new Response('文件不存在', { status: 404 })

  const range = request.headers.get('Range')
  const total = file.size
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }

  if (!range) return new Response(file, { headers: { ...headers, 'Content-Length': String(total) } })

  const { start, end } = parseRange(range, total)
  if (start >= total || end < start) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` } })
  }

  const slice = file.slice(start, end + 1)
  return new Response(slice, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
    },
  })
}

/** `bytes=a-b`、`bytes=a-` 与后缀形式 `bytes=-n`；end 超出文件时截到最后一字节。 */
function parseRange(range: string, total: number): { start: number; end: number } {
  const match = /bytes=(\d*)-(\d*)/.exec(range)
  const first = match?.[1] ?? ''
  const last = match?.[2] ?? ''
  if (first === '' && last !== '') return { start: Math.max(0, total - Number(last)), end: total - 1 }
  return { start: Number(first) || 0, end: last === '' ? total - 1 : Math.min(Number(last), total - 1) }
}
