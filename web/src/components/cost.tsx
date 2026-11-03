import type { Currency, Money, Usage } from '@vesper/shared'

const SYMBOL: Record<Currency, string> = { USD: '$', CNY: '¥' }

export function formatMoney(money: Money): string {
  return (Object.keys(SYMBOL) as Currency[])
    .filter((currency) => money[currency] !== undefined)
    .map((currency) => {
      const amount = money[currency]!
      return amount > 0 && amount < 0.01 ? `<${SYMBOL[currency]}0.01` : `${SYMBOL[currency]}${amount.toFixed(2)}`
    })
    .join(' + ')
}

export function formatUsage(usage: Usage): string {
  switch (usage.kind) {
    case 'tokens':
      return [
        usage.model,
        `输入 ${usage.input}`,
        usage.cache_write_5m + usage.cache_write_1h > 0 ? `缓存写入 ${usage.cache_write_5m + usage.cache_write_1h}` : '',
        usage.cache_read > 0 ? `缓存读取 ${usage.cache_read}` : '',
        `输出 ${usage.output} token`,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'image':
      return `${usage.model} · 输入文本 ${usage.text_input} · 输入图像 ${usage.image_input} · 输出图像 ${usage.image_output} token`
    case 'video':
      return `${usage.model} · ${usage.resolution} · ${usage.seconds}s · 参考图 ${usage.input_images} 张`
    case 'speech':
      return `${usage.model} · ${usage.characters} 字符`
  }
}
