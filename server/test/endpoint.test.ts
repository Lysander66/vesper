import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assetRefFromFile } from '../src/endpoint/asset'
import { toCurl } from '../src/endpoint/curl'
import { buildContext, renderSection } from '../src/endpoint/render'
import { stampInputs } from '../src/runner/execute'
import { DROP, renderValue } from '../src/endpoint/template'
import { parseDefinition, type EndpointDefinition } from '../src/endpoint/types'
import { assertContainsAsset, MissingAssetError } from '../src/endpoint/verify'

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

let workdir: string
let firstFrame: string
let definition: EndpointDefinition

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'vesper-'))
  firstFrame = join(workdir, 'first.png')
  const bytes = new Uint8Array(64)
  bytes.set(PNG_HEADER)
  await Bun.write(firstFrame, bytes)
  definition = parseDefinition(await Bun.file(join(import.meta.dir, '../endpoints/minimax-h3.json')).json())
})

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true })
})

describe('模板渲染', () => {
  test('取不到值的字段与 $when 为假的对象整块删掉', () => {
    expect(renderValue({ a: '{{ missing }}', b: 1 }, {})).toEqual({ b: 1 })

    const node = { $when: 'inputs.first_frame', type: 'image_url' }
    expect(renderValue(node, { inputs: {} })).toBe(DROP)
    expect(renderValue(node, { inputs: { first_frame: 'x' } })).toEqual({ type: 'image_url' })
  })
})

describe('端到端渲染', () => {
  async function submitContent(withAssets: boolean) {
    const inputs = withAssets ? { first_frame: await assetRefFromFile(firstFrame) } : {}
    const ctx = buildContext(
      { api_key: 'sk-secret-value-1234', base_url: 'https://api.minimax.cn', model: 'MiniMax-H3', prompt: '镜头缓慢推近，少女抬头' },
      inputs,
      definition.defaults,
    )
    return (renderSection(definition, 'submit', ctx)!.body as { content: Array<Record<string, unknown>> }).content
  }

  test('提交节把首帧渲染到正确位置，缺席时整块消失', async () => {
    const content = await submitContent(true)
    expect(content.map((c) => c.role)).toEqual([undefined, 'first_frame'])
    expect(content[0]).toEqual({ type: 'text', text: '镜头缓慢推近，少女抬头' })

    expect(await submitContent(false)).toHaveLength(1)
  })

  // 发起方按来源名传素材，图在前、音频在后，各自保持顺序。
  test('参考图模式的图与音色样本按来源名落到 reference_image / reference_audio', async () => {
    const voice = join(workdir, 'voice.wav')
    await Bun.write(voice, new Uint8Array(64))
    const inputs = stampInputs(
      {
        reference_images: [await assetRefFromFile(firstFrame)],
        reference_audio_files: [await assetRefFromFile(voice), await assetRefFromFile(voice)],
      },
      definition,
    )
    const ctx = buildContext({ api_key: 'sk-secret-value-1234', base_url: 'https://api.minimax.cn', prompt: '两人对话' }, inputs, definition.defaults)
    const content = (renderSection(definition, 'submit', ctx)!.body as { content: Array<Record<string, unknown>> }).content

    expect(content.map((c) => [c.type, c.role])).toEqual([
      ['text', undefined],
      ['image_url', 'reference_image'],
      ['audio_url', 'reference_audio'],
      ['audio_url', 'reference_audio'],
    ])
    expect(() => assertContainsAsset(content, voice, '音色样本')).not.toThrow()
  })

  test('发送前断言首帧进了请求体', async () => {
    const withFrame = await submitContent(true)
    const withoutFrame = await submitContent(false)

    expect(() => assertContainsAsset(withFrame, firstFrame, '首帧')).not.toThrow()
    expect(() => assertContainsAsset(withoutFrame, firstFrame, '首帧')).toThrow(MissingAssetError)
  })
})

describe('cURL 导出', () => {
  test('multipart 的文本字段用 --form-string，值以 @ 开头也不会被当成文件', async () => {
    const image = await assetRefFromFile(firstFrame)
    const { command } = toCurl({ method: 'POST', url: 'https://example.com/v1', headers: {}, body: { prompt: '@角色站在门口', image }, encoding: 'multipart' })

    expect(command).toContain(`--form-string 'prompt=@角色站在门口'`)
    expect(command).toContain(`-F 'image=@${firstFrame};type=image/png'`)
  })
})
