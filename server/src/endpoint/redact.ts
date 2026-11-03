/** 凭证遮蔽，写盘与打印前都要经过。本次的 key 精确替换，响应里回显的其他凭证按格式匹配。 */

const MASK = '****'
const KEEP_TAIL = 4

/** URL 上常见的凭证型查询参数。只遮值，保留参数名。 */
const SENSITIVE_QUERY_KEYS = [
  'key',
  'api_key',
  'apikey',
  'access_token',
  'token',
  'signature',
  'sign',
  'x-tos-signature',
  'x-amz-signature',
  'authorization',
]

const SENSITIVE_QUERY_RE = new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS.join('|')})=)([^&#\\s]+)`, 'gi')

const BEARER_RE = /\b(Bearer|Basic|Token)\s+([A-Za-z0-9\-._~+/=]{8,})/gi

/** 带固定前缀的 key，不持有原文也能认出。 */
const PREFIXED_KEY_RE = /\b((?:sk|xai|gsk|pk|rk|api)-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g

/** 这些请求头整值遮蔽。 */
const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key', 'cookie', 'set-cookie', 'proxy-authorization'])

/** 认证方案前缀保留，导出的 cURL 才能重放。 */
const SCHEME_RE = /^(Bearer|Basic|Token)\s+(\S.*)$/i

/** `****` 加尾 4 位，认得出是哪一把 key。 */
export function maskSecret(secret: string): string {
  if (!secret) return secret
  return secret.length > KEEP_TAIL ? `${MASK}${secret.slice(-KEEP_TAIL)}` : MASK
}

export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const secret of secrets) {
    // 短串会误伤正文，精确替换只对够长的凭证生效。
    if (secret.length >= 8) out = out.split(secret).join(maskSecret(secret))
  }
  out = out.replace(SENSITIVE_QUERY_RE, (_m, prefix: string, value: string) => `${prefix}${maskSecret(value)}`)
  out = out.replace(BEARER_RE, (_m, scheme: string, value: string) => `${scheme} ${maskSecret(value)}`)
  out = out.replace(PREFIXED_KEY_RE, (m) => maskSecret(m))
  return out
}

function maskHeaderValue(value: string): string {
  const scheme = SCHEME_RE.exec(value)
  return scheme ? `${scheme[1]} ${maskSecret(scheme[2]!)}` : maskSecret(value)
}

export function redactHeaders(headers: Readonly<Record<string, string>>, secrets: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? maskHeaderValue(value) : redactText(value, secrets)
  }
  return out
}

/** 只处理字符串叶子，对象的键不动。 */
export function redactJson(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, secrets)
  if (Array.isArray(value)) return value.map((item) => redactJson(item, secrets))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? maskHeaderValue(String(item)) : redactJson(item, secrets)
    }
    return out
  }
  return value
}
