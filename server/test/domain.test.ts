import { describe, expect, test } from 'bun:test'

import { locateAnchors } from '../src/domain/anchor'
import { overlongShots } from '../src/domain/beats'
import { titleOf } from '../src/domain/import'
import { checkFileSpans } from '../src/domain/spans'
import { downstreamOf, impactOfShotFields, impactOfVersionSwap } from '../src/domain/stale'

describe('一份原文的分集覆盖', () => {
  const span = (label: string, start: number, end: number) => ({ label, start, end })

  test('连续盖满即通过', () => {
    expect(checkFileSpans(100, [span('第1集', 0, 40), span('第2集', 40, 100)])).toBe(null)
  })

  test('开头未覆盖、中间断开或重叠、末集未到文末都报错', () => {
    expect(checkFileSpans(100, [span('第1集', 10, 100)])).not.toBe(null)
    expect(checkFileSpans(100, [span('第1集', 0, 40), span('第2集', 50, 100)])).not.toBe(null)
    expect(checkFileSpans(100, [span('第1集', 0, 50), span('第2集', 40, 100)])).not.toBe(null)
    expect(checkFileSpans(100, [span('第1集', 0, 80)])).not.toBe(null)
  })
})

describe('末句锚点定位', () => {
  const source = '第一句。第二句。第三句。第四句。'

  test('逐字匹配时区间连续、不重叠、末集到文末', () => {
    const result = locateAnchors(source, ['第二句。', '第四句。'])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spans[0]).toEqual({ start: 0, end: 8 })
    expect(result.spans[1]).toEqual({ start: 8, end: source.length })
  })

  test('记下最后一拍末句的实际位置，用于判断回复是否中途停止', () => {
    const result = locateAnchors(source, ['第二句。'])

    expect(result.ok && result.spans[0]).toEqual({ start: 0, end: source.length })
    expect(result.ok && result.reached).toBe(8)
  })

  test('标点全半角与空白不一致也能匹配，下标不偏移', () => {
    const punct = locateAnchors('他说了句话.然后走了。', ['他说了句话。', '然后走了。'])
    const space = locateAnchors('他说 了句话。然后走了。', ['他说 了句话。', '然后走了。'])

    expect(punct.ok && punct.spans[0]!.end).toBe(6)
    expect(space.ok && space.spans[0]!.end).toBe(7)
  })

  test('末句被改写时定位失败，原因里写明是哪一集', () => {
    const result = locateAnchors(source, ['她说了第二句。', '第四句。'])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons[0]).toContain('第 1 集')
  })
})

describe('过时传播', () => {
  test('过时向下游传递：首帧连带视频与合成版，配音只连带合成版', () => {
    expect(downstreamOf('first_frame')).toEqual(['clip', 'film'])
    expect(downstreamOf('voice')).toEqual(['film'])
    expect(downstreamOf('film')).toEqual([])
  })

  test('改哪个字段从哪一件起过时，台词在视频自带声音下连带视频', () => {
    expect(impactOfShotFields(['image_prompt'], 'separate')).toEqual(['first_frame', 'clip', 'film'])
    expect(impactOfShotFields(['camera_move'], 'separate')).toEqual(['clip', 'film'])
    expect(impactOfShotFields(['seconds'], 'separate')).toEqual(['film'])
    expect(impactOfShotFields(['utterances'], 'separate')).toEqual(['voice', 'film'])
    expect(impactOfShotFields(['utterances'], 'native')).toEqual(['clip', 'film'])
    // 情绪只用于写提示词，改了不标过时。
    expect(impactOfShotFields(['mood', 'summary'], 'separate')).toEqual([])
  })

  test('资产换版本只差声音时画面不过时，从出声的那一件起', () => {
    const base = { data: { traits: '白发', voice: '少女音' }, files: [{ role: 'full_body', path: '/a.png' }] }
    const sampled = { ...base, files: [{ role: 'voice_sample', path: '/v.wav' }, ...base.files] }

    expect(impactOfVersionSwap(base, sampled, 'native', 'reference')).toBe('clip')
    // 样本只随参考图模式的视频请求发出去。
    expect(impactOfVersionSwap(base, sampled, 'native', 'first_frame')).toBeNull()
    expect(impactOfVersionSwap(base, sampled, 'separate', 'reference')).toBeNull()
    // 只多了候选，选定的样本没换。
    expect(impactOfVersionSwap(sampled, { ...sampled, files: [...sampled.files, { role: 'voice_sample', path: '/old.wav' }] }, 'native', 'reference')).toBeNull()
    const revoiced = { ...base, data: { ...base.data, voice: '少年音' } }
    expect(impactOfVersionSwap(base, revoiced, 'native', 'first_frame')).toBe('clip')
    expect(impactOfVersionSwap(base, revoiced, 'separate', 'first_frame')).toBe('voice')
    expect(impactOfVersionSwap(base, { ...sampled, data: { ...base.data, traits: '黑发' } }, 'native', 'first_frame')).toBe('first_frame')
    expect(impactOfVersionSwap(base, { ...base, files: [{ role: 'full_body', path: '/b.png' }, ...base.files] }, 'native', 'first_frame')).toBe('first_frame')
    expect(impactOfVersionSwap(base, { ...base }, 'native', 'reference')).toBeNull()
  })
})

describe('导入时的默认集名', () => {
  test('正文首行是章节标题就用它', () => {
    expect(titleOf({ name: '云间旧事-第90章.txt', text: '第90章沧海，桑田\n　　正文' })).toBe('第90章 沧海，桑田')
    expect(titleOf({ name: 'a.txt', text: '\n第十二回 山中奇遇\n正文' })).toBe('第十二回 山中奇遇')
  })

  test('首行不是章节标题时用文件名，去掉章号前的书名', () => {
    expect(titleOf({ name: 'dir/云间旧事-第3章.txt', text: '正文' })).toBe('第3章')
    expect(titleOf({ name: '序章.txt', text: '正文' })).toBe('序章')
  })
})

describe('台词念不完的镜头', () => {
  // 语速 4 字/秒，每句另加 0.3 秒换气。
  test('只报出超过上限的镜头，给出下标与念完的秒数', () => {
    const shots = [['十个字十个字十个字十'], ['二十个字二十个字二十个字二十个字二十个', '二十个字二十个字二十个字二十个字二十个'], []]

    expect(overlongShots(shots, 4, 8)).toEqual([{ index: 1, seconds: 10.1 }])
  })
})
