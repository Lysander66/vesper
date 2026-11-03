import { expect, test } from 'bun:test'

import { summarizeBody } from '../src/runner/send'

test('JSON 里的 base64 与 data URI 换成摘要', () => {
  const b64 = 'A'.repeat(4096)
  const summary = summarizeBody({ data: [{ b64_json: b64 }, { url: `data:image/png;base64,${b64}` }] }) as {
    data: [{ b64_json: string }, { url: string }]
  }
  expect(summary.data[0].b64_json).toBe('…（base64 已省略，4096 字符）')
  expect(summary.data[1].url).toContain('base64 已省略')
})
