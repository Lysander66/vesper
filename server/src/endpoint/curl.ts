/** 渲染后的请求转成 cURL。凭证换成 shell 变量，素材换成占位符。 */

import type { CurlExport } from '@vesper/shared'

import { isAssetRef, type AssetRef } from './asset'
import { formEntries, type RenderedRequest } from './render'

export const DEFAULT_ENV_VAR = 'VESPER_API_KEY'

type CurlAsset = CurlExport['assets'][number]

export function toCurl(request: RenderedRequest, options: { apiKey?: string | undefined; envVar?: string | undefined } = {}): CurlExport {
  const envVar = options.envVar ?? DEFAULT_ENV_VAR
  const apiKey = options.apiKey && options.apiKey.length >= 8 ? options.apiKey : undefined
  const quote = (value: string) => shellQuote(value, apiKey, envVar)

  const multipart = request.encoding === 'multipart'
  const assets: CurlAsset[] = []
  const lines = [`curl -X ${request.method} ${quote(request.url)}`]

  for (const [name, value] of Object.entries(request.headers)) {
    // multipart 的边界串由 curl 自己生成，写死的 Content-Type 会盖掉它。
    if (multipart && name.toLowerCase() === 'content-type') continue
    lines.push(`  -H ${quote(`${name}: ${value}`)}`)
  }

  if (request.body !== null && request.body !== undefined) {
    if (multipart) {
      lines.push(...formLines(request.body, quote))
    } else {
      const tokenized = tokenizeAssets(request.body, assets)
      if (!hasHeader(request.headers, 'content-type')) {
        lines.push(`  -H 'Content-Type: application/json'`)
      }
      lines.push(`  --data-raw ${quote(JSON.stringify(tokenized, null, 2))}`)
    }
  }

  const usedEnvVar = apiKey !== undefined && lines.some((line) => line.includes(`"$${envVar}"`))
  return {
    command: lines.join(' \\\n'),
    assets,
    env_var: usedEnvVar ? envVar : null,
  }
}

/** 文本字段用 `--form-string`：值以 @ 或 < 开头时 `-F` 会把它当文件读。 */
function formLines(body: unknown, quote: (value: string) => string): string[] {
  return formEntries(body).map(([key, item]) =>
    typeof item === 'string' ? `  --form-string ${quote(`${key}=${item}`)}` : `  -F ${quote(`${key}=@${item.path};type=${item.mime}`)}`,
  )
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

/** 素材引用换成 `<<PLACEHOLDER>>`，同时收集占位符表。 */
function tokenizeAssets(node: unknown, collected: CurlAsset[]): unknown {
  if (isAssetRef(node)) {
    if (!collected.some((asset) => asset.placeholder === node.placeholder)) {
      collected.push(toCurlAsset(node))
    }
    return `<<${node.placeholder}>>`
  }
  if (Array.isArray(node)) return node.map((item) => tokenizeAssets(item, collected))
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = tokenizeAssets(value, collected)
    }
    return out
  }
  return node
}

function toCurlAsset(ref: AssetRef): CurlAsset {
  // file 素材出现在 JSON 体里说明端点定义写错了，直接报错。
  if (ref.encoding === 'file') {
    throw new Error(`${ref.placeholder} 声明为 file 编码，却出现在 JSON 请求体里`)
  }
  const b64 = `base64 < ${shellQuote(ref.path)} | tr -d '\\n'`
  const fill =
    ref.encoding === 'data_uri'
      ? `${ref.placeholder}="data:${ref.mime};base64,$(${b64})"`
      : `${ref.placeholder}="$(${b64})"`
  return { placeholder: ref.placeholder, path: ref.path, mime: ref.mime, bytes: ref.bytes, fill }
}

/** 单引号里 shell 不展开，JSON 里的 `$` 与反引号都安全；凭证要展开，单独切出来用双引号包。 */
export function shellQuote(value: string, secret?: string, envVar?: string): string {
  if (value === '') return `''`
  const literal = (part: string) => (part === '' ? '' : `'${part.split(`'`).join(`'\\''`)}'`)
  if (!secret || !envVar || !value.includes(secret)) return literal(value)
  return value
    .split(secret)
    .map(literal)
    .join(`"$${envVar}"`)
}
