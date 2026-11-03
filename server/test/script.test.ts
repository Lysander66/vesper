/** 分镜拆分的台词校验与模型回复解析，不调用模型。 */

import type { Beat } from '@vesper/shared'

import { describe, expect, test } from 'bun:test'

import { assertAllUtterancesUsed, pickUtterances } from '../src/pipeline/script'
import { withHow } from '../src/pipeline/polish'
import { parseReply, ReplyError, z } from '../src/pipeline/reply'
import { Conflict } from '../src/domain/errors'

const BEATS: Beat[] = [
  {
    mode: 'scene',
    summary: '进店',
    utterances: [
      { speaker: '柳三娘', text: '打烊了。' },
      { speaker: '顾舟', text: '我找一个人。' },
    ],
  },
  { mode: 'narration', summary: '雪夜', utterances: [{ speaker: null, text: '雪已经下了三天。' }] },
]

describe('台词引用', () => {
  test('按下标取回节拍里的台词，顺序跟引用一致', () => {
    expect(pickUtterances(BEATS, 0, [1, 0], 0).map((u) => u.text)).toEqual(['我找一个人。', '打烊了。'])
  })

  test('引用不存在的节拍或台词时报出是第几镜', () => {
    expect(() => pickUtterances(BEATS, 5, [0], 2)).toThrow(Conflict)
    expect(() => pickUtterances(BEATS, 5, [0], 2)).toThrow('第 3 镜引用了不存在的节拍 6')
    expect(() => pickUtterances(BEATS, 0, [9], 0)).toThrow('不存在的台词 10')
  })

  test('每条台词恰好引用一次即通过', () => {
    const shots = [
      { beat_index: 0, utterance_indexes: [0, 1] },
      { beat_index: 1, utterance_indexes: [0] },
    ]
    expect(() => assertAllUtterancesUsed(BEATS, shots)).not.toThrow()
  })

  // 漏引用会丢掉已确认的台词，重复引用会念两遍。
  test('漏引用与重复引用都报出是哪句台词', () => {
    const missing = [{ beat_index: 0, utterance_indexes: [0, 0] }, { beat_index: 1, utterance_indexes: [0] }]
    expect(() => assertAllUtterancesUsed(BEATS, missing)).toThrow('没有镜头念')
    expect(() => assertAllUtterancesUsed(BEATS, missing)).toThrow('被多镜重复引用')
    expect(() => assertAllUtterancesUsed(BEATS, missing)).toThrow('打烊了。')
  })
})

describe('模型回复解析', () => {
  const schema = z.object({ count: z.number() })

  test('去掉代码围栏与前后多余文字后取到 JSON', () => {
    expect(parseReply('好的，结果如下：\n```json\n{"count":3}\n```\n希望有帮助', schema, '测试')).toEqual({ count: 3 })
    expect(parseReply('前言 {"count":3} 后记', schema, '测试')).toEqual({ count: 3 })
  })

  test('找不到 JSON、解析失败与结构不符分别报错', () => {
    expect(() => parseReply('模型只回了一句抱歉', schema, '分集')).toThrow(ReplyError)
    expect(() => parseReply('模型只回了一句抱歉', schema, '分集')).toThrow('分集：回复中未找到 JSON')
    expect(() => parseReply('{"count": }', schema, '测试')).toThrow('JSON 解析失败')
    expect(() => parseReply('{"total":3}', schema, '测试')).toThrow('结构不符')
  })

  test('缺字段不补默认值，直接失败', () => {
    const strict = z.object({ shots: z.array(z.object({ image_prompt: z.string() })) })
    expect(() => parseReply('{"shots":[{}]}', strict, '分镜')).toThrow('image_prompt')
  })
})

describe('逐镜精写的说法写回台词', () => {
  test('按开口顺序写回，空台词不占位，条数不齐时不改', () => {
    const lines = [{ speaker: '甲', text: '一' }, { speaker: null, text: ' ' }, { speaker: '乙', text: '二' }]

    expect(withHow(lines, [{ how: '压低' }, { how: '喊出来' }])).toEqual([
      { speaker: '甲', text: '一', how: '压低' },
      { speaker: null, text: ' ' },
      { speaker: '乙', text: '二', how: '喊出来' },
    ])
    expect(withHow(lines, [{ how: '压低' }])[2]).toEqual({ speaker: '乙', text: '二' })
  })
})
