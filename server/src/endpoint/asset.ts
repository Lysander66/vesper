/** 请求体里的素材引用。记录、导出与实际发送用同一棵树，base64 只在发出前展开。 */

export const ASSET_REF = '$asset' as const

/** `file` 只能作为 multipart 的文件部分上传。 */
export type AssetEncoding = 'data_uri' | 'base64' | 'file'

export interface AssetRef {
  readonly [ASSET_REF]: true
  /** 本地绝对路径，复现这次请求靠它。 */
  readonly path: string
  readonly mime: string
  readonly bytes: number
  readonly encoding: AssetEncoding
  /** cURL 导出时的 shell 变量名，如 `REF_IMAGE_1`。 */
  readonly placeholder: string
}

export function isAssetRef(value: unknown): value is AssetRef {
  return typeof value === 'object' && value !== null && ASSET_REF in value
}

/** 按文件头识别 MIME。扩展名常与实际编码不符，供应商会按格式不符拒收。 */
export function imageMimeFromBytes(content: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => content[i] === b)
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (content.length >= 12 && startsWith(0x52, 0x49, 0x46, 0x46)) {
    const webp = [0x57, 0x45, 0x42, 0x50].every((b, i) => content[8 + i] === b)
    if (webp) return 'image/webp'
  }
  if (content.length >= 12 && [0x66, 0x74, 0x79, 0x70].every((b, i) => content[4 + i] === b)) {
    const brand = String.fromCharCode(...content.slice(8, 12))
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic'
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif'
  }
  return null
}

const EXTENSION_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
}

/** 编码与占位名在发出前由 stampInputs 按端点定义改写，这里给的只是初值。 */
export async function assetRefFromFile(path: string): Promise<AssetRef> {
  const file = Bun.file(path)
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  const mime = imageMimeFromBytes(head) ?? EXTENSION_MIME[ext] ?? 'application/octet-stream'
  return { [ASSET_REF]: true, path, mime, bytes: file.size, encoding: 'data_uri', placeholder: 'ASSET' }
}

/** 引用展开成请求体里的字符串。 */
export async function materialize(ref: AssetRef): Promise<string> {
  if (ref.encoding === 'file') {
    throw new Error(`${ref.placeholder} 声明为 file 编码，只能作为 multipart 文件部分上传，不能展开成字符串`)
  }
  const bytes = await Bun.file(ref.path).bytes()
  const b64 = Buffer.from(bytes).toString('base64')
  return ref.encoding === 'data_uri' ? `data:${ref.mime};base64,${b64}` : b64
}

export async function materializeBytes(ref: AssetRef): Promise<Uint8Array> {
  return Bun.file(ref.path).bytes()
}
