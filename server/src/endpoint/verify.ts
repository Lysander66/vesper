/** 发请求前断言素材进了请求体。字段名对不上时 `$when` 会删掉整块，请求照样成功，但已不是图生视频。 */

import { isAssetRef } from './asset'

export class MissingAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingAssetError'
  }
}

export function containsAsset(body: unknown, path: string): boolean {
  if (isAssetRef(body)) return body.path === path
  if (Array.isArray(body)) return body.some((item) => containsAsset(item, path))
  if (body !== null && typeof body === 'object') {
    return Object.values(body as Record<string, unknown>).some((value) => containsAsset(value, path))
  }
  return false
}

export function assertContainsAsset(body: unknown, path: string, what: string): void {
  if (containsAsset(body, path)) return
  throw new MissingAssetError(
    `${what}没有进入请求体（${path}）。多半是端点定义里 inputs 的来源名或模板字段名对不上，` +
      '导致条件字段被整块丢弃——这次调用会退化成不带图的生成，已拦下。',
  )
}
