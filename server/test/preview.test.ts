/** 一镜将发出的内容，发起与预览共用这份计算。 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AssetCategory, EndpointCapabilities, ShotRef } from '@vesper/shared'

import { assetPreview, shotPreview } from '../src/api/views'
import { openDatabase } from '../src/db/schema'
import { chainsFrom, offFrameCast, planClip, planFirstFrame, speakerVoice } from '../src/pipeline/preview'
import { CREATURE_DUTY, LOOK_DUTY, REF_KINDS } from '../src/pipeline/prompts'
import { createAsset } from '../src/repo/assets'
import { createProject, listEpisodesOf } from '../src/repo/projects'
import { currentArtifacts, getShot, recordArtifact, replaceShots, type ShotDraft } from '../src/repo/shots'
import { addAssetFile, createCostume, lockAsset, unlockAsset } from '../src/service/assets'
import { followLatestVersion } from '../src/service/shots'
import { addSources } from '../src/service/sources'

let db: Database
let projectId: string
let episodeId: string

const LOOK: Readonly<Record<AssetCategory, 'full_body' | 'establishing' | 'object'>> = {
  character: 'full_body',
  scene: 'establishing',
  prop: 'object',
}

/** 建一件资产、加一张设定图并锁定，返回镜头引用。 */
function lock(category: AssetCategory, name: string, data: Record<string, unknown> = {}): ShotRef {
  const id = createAsset(db, { projectId, category, name, data })
  addAssetFile(db, id, { role: LOOK[category], path: `/data/${name}.png` })
  return { asset_id: id, version_id: lockAsset(db, id).versionId, name }
}

function draft(patch: Partial<ShotDraft> = {}): ShotDraft {
  return {
    summary: '她推开门',
    scene: '雪落在肩上',
    camera: '平视',
    shotSize: 'medium',
    cameraMove: 'static',
    mood: '',
    joinMode: 'continue',
    clipSource: 'first_frame',
    imagePrompt: '人物站在门口',
    motionPrompt: '缓缓抬头',
    utterances: [],
    seconds: 6,
    cast: [],
    sceneRef: null,
    props: [],
    beatIndex: 0,
    ...patch,
  }
}

function shotsOf(...drafts: readonly ShotDraft[]): string[] {
  return replaceShots(db, episodeId, drafts)
}

beforeEach(() => {
  db = openDatabase(':memory:')
  projectId = createProject(db, { name: '雪夜', style: '日系漫剧风格' })
  const [source] = addSources(db, projectId, [{ name: '雪夜.txt', text: '雪下了一整夜。' }])
  episodeId = listEpisodesOf(db, source!.id)[0]!.id
})

describe('首帧要发什么', () => {
  test('参考图清单的「@图片N」与参考图顺序一致', () => {
    const scene = lock('scene', '雪夜屋檐')
    const lead = lock('character', '林小满', { tier: 'lead' })
    const prop = lock('prop', '油纸伞')
    const [id] = shotsOf(draft({ cast: [lead], sceneRef: scene, props: [prop] }))

    const plan = planFirstFrame(db, getShot(db, id!), { style: '日系漫剧风格', tail: null })

    expect(plan.kept.map((slot) => slot.image)).toEqual([
      '/data/雪夜屋檐.png',
      '/data/林小满.png',
      '/data/油纸伞.png',
    ])
    expect(plan.prompt).toContain('@图片1 是场景「雪夜屋檐」')
    expect(plan.prompt).toContain('@图片2 是人物「林小满」')
    expect(plan.prompt).toContain('@图片3 是道具「油纸伞」')
  })

  test('超过端点上限时从末尾截掉，主角保留、道具去掉', () => {
    const scene = lock('scene', '雪夜屋檐')
    const support = lock('character', '阿岚', { tier: 'support' })
    const lead = lock('character', '林小满', { tier: 'lead' })
    const prop = lock('prop', '油纸伞')
    // cast 里配角在主角前面，截断按角色定位排序。
    const [id] = shotsOf(draft({ cast: [support, lead], sceneRef: scene, props: [prop] }))

    const plan = planFirstFrame(db, getShot(db, id!), { style: '', tail: null, maxRefs: 3 })

    expect(plan.kept.map((slot) => slot.note.name)).toEqual(['雪夜屋檐', '林小满', '阿岚'])
    expect(plan.dropped.map((slot) => slot.note.name)).toEqual(['油纸伞'])
    expect(plan.limit).toBe(3)
    expect(plan.prompt).not.toContain('油纸伞')
  })

  test('接末帧时末帧排第一，场景空镜排最后', () => {
    const scene = lock('scene', '雪夜屋檐')
    const lead = lock('character', '林小满', { tier: 'lead' })
    const [id] = shotsOf(draft({ cast: [lead], sceneRef: scene }))

    const plan = planFirstFrame(db, getShot(db, id!), { style: '', tail: '/data/clip.mp4.tail.jpg' })

    expect(plan.kept.map((slot) => slot.image)).toEqual([
      '/data/clip.mp4.tail.jpg',
      '/data/林小满.png',
      '/data/雪夜屋檐.png',
    ])
    expect(plan.chained).toBe(true)
  })

  test('末帧超出上限时，提示词与不接末帧时相同', () => {
    const lead = lock('character', '林小满', { tier: 'lead' })
    const [id] = shotsOf(draft({ cast: [lead] }))

    const plan = planFirstFrame(db, getShot(db, id!), { style: '', tail: '/data/clip.mp4.tail.jpg', maxRefs: 0 })

    expect(plan.chained).toBe(false)
    expect(plan.prompt).toBe(planFirstFrame(db, getShot(db, id!), { style: '', tail: null, maxRefs: 0 }).prompt)
    expect(plan.dropped.map((slot) => slot.note.kind)).toEqual(['上一镜的末帧', '人物'])
  })

  test('按分镜挑的设定图挂参考图，职责随之变；没有那张时用全身图', () => {
    const id = createAsset(db, { projectId, category: 'character', name: '林小满', data: { tier: 'lead' } })
    addAssetFile(db, id, { role: 'full_body', path: '/data/林小满-全身.png' })
    addAssetFile(db, id, { role: 'portrait', path: '/data/林小满-半身.png' })
    const versionId = lockAsset(db, id).versionId
    const ref = (look: 'portrait' | 'outfit') => ({ asset_id: id, version_id: versionId, name: '林小满', look })
    const [close, missing] = shotsOf(draft({ cast: [ref('portrait')] }), draft({ cast: [ref('outfit')] }))

    const closeUp = planFirstFrame(db, getShot(db, close!), { style: '', tail: null })
    const fallback = planFirstFrame(db, getShot(db, missing!), { style: '', tail: null })

    expect(closeUp.kept.map((slot) => slot.image)).toEqual(['/data/林小满-半身.png'])
    expect(closeUp.prompt).toContain(LOOK_DUTY.portrait!)
    expect(fallback.kept.map((slot) => slot.image)).toEqual(['/data/林小满-全身.png'])
    expect(fallback.prompt).toContain(REF_KINDS.character.duty)
  })

  test('非人形角色的参考图职责不提发型与服装', () => {
    const id = createAsset(db, { projectId, category: 'character', name: '石麟', data: { tier: 'support', form: 'creature' } })
    addAssetFile(db, id, { role: 'full_body', path: '/data/石麟-全身.png' })
    const versionId = lockAsset(db, id).versionId
    const [shot] = shotsOf(draft({ cast: [{ asset_id: id, version_id: versionId, name: '石麟', look: 'full_body' }] }))

    const prompt = planFirstFrame(db, getShot(db, shot!), { style: '', tail: null }).prompt
    expect(prompt).toContain(CREATURE_DUTY.full_body!)
    expect(prompt).not.toContain(REF_KINDS.character.duty)
  })

  test('景别拼在机位前面进首帧提示词', () => {
    const [id] = shotsOf(draft({ shotSize: 'close', camera: '略低机位' }))

    expect(planFirstFrame(db, getShot(db, id!), { style: '', tail: null }).prompt).toContain('近景，略低机位')
  })

  // 视频只收到首帧，首帧里没有的人在视频里长相会对不上。
  test('报出首帧提示词里没写到的出场人物，参考图模式不报', () => {
    const lead = lock('character', '林小满', { tier: 'lead' })
    const support = lock('character', '阿岚', { tier: 'support' })
    const [framed, reference] = shotsOf(
      draft({ cast: [lead, support], imagePrompt: '林小满站在门口，门外一片漆黑' }),
      draft({ cast: [lead, support], imagePrompt: '林小满站在门口，门外一片漆黑', clipSource: 'reference' }),
    )

    expect(offFrameCast(db, getShot(db, framed!))).toEqual(['阿岚'])
    expect(shotPreview(db, getShot(db, framed!)).off_frame).toEqual(['阿岚'])
    expect(offFrameCast(db, getShot(db, reference!))).toEqual([])
  })

  // 台词里的说话人是本体名，出场的是换装。
  test('换装以本体的名字出场，外貌与试音取自本体的锁定版', () => {
    const base = lock('character', '钱大人', { traits: '胖，八字胡', voice: '油滑的中年男声' })
    unlockAsset(db, base.asset_id)
    addAssetFile(db, base.asset_id, { role: 'voice_sample', path: '/data/钱大人.wav' })
    lockAsset(db, base.asset_id)
    const costumeId = createCostume(db, base.asset_id, '官服', '墨绿官服')
    addAssetFile(db, costumeId, { role: 'full_body', path: '/data/官服.png' })
    const costume = { asset_id: costumeId, version_id: lockAsset(db, costumeId).versionId, name: '钱大人·官服' }
    const [id] = shotsOf(draft({ cast: [costume], imagePrompt: '钱大人坐在公案后' }))
    const shot = getShot(db, id!)

    expect(offFrameCast(db, shot)).toEqual([])
    expect(speakerVoice(db, shot, '钱大人')).toEqual({ voice: '油滑的中年男声', sample: '/data/钱大人.wav', registered: true })
    expect(planFirstFrame(db, shot, { style: '', tail: null }).prompt).toContain('钱大人')
  })

  test('本体未锁定时换装不能锁定', () => {
    const base = createAsset(db, { projectId, category: 'character', name: '阿竹' })
    const costumeId = createCostume(db, base, '白发', '素白中衣')
    addAssetFile(db, costumeId, { role: 'full_body', path: '/data/白发.png' })

    expect(() => lockAsset(db, costumeId)).toThrow('先锁定「阿竹」')
  })
})

const VIDEO: EndpointCapabilities = { durations: [5, 10] }

describe('视频要发什么', () => {
  test('单独配音时台词不进视频提示词', () => {
    const [id] = shotsOf(draft({ utterances: [{ speaker: '林小满', text: '别过来' }] }))

    const plan = planClip(db, getShot(db, id!), { audio: 'separate', capabilities: VIDEO })

    expect(plan.prompt).not.toContain('别过来')
    expect(plan.unregisteredSpeakers).toEqual([])
  })

  // 画外说话的人不在出镜角色里。
  test('画外说话人按作品里已锁定的角色（含别名）取音色', () => {
    lock('character', '沈青禾', { tier: 'lead', voice: '少女音，清亮', aliases: ['青禾'] })
    const [id] = shotsOf(draft({ utterances: [{ speaker: '青禾', text: '走' }] }))

    const plan = planClip(db, getShot(db, id!), { audio: 'native', capabilities: VIDEO })

    expect(plan.prompt).toContain('「青禾」（少女音，清亮）')
    expect(plan.unregisteredSpeakers).toEqual([])
  })

  test('视频自带声音时一镜可以有两个说话人，音色写在各自台词前', () => {
    const her = lock('character', '林小满', { tier: 'lead', voice: '少女音，清亮' })
    const him = lock('character', '周岩', { tier: 'support', voice: '中年男声，偏沉' })
    const [id] = shotsOf(
      draft({
        cast: [her, him],
        utterances: [
          { speaker: '林小满', text: '别过来' },
          { speaker: '周岩', text: '晚了' },
        ],
      }),
    )

    const plan = planClip(db, getShot(db, id!), { audio: 'native', capabilities: VIDEO })

    expect(plan.prompt).toContain('「林小满」（少女音，清亮）说：「别过来」')
    expect(plan.prompt).toContain('「周岩」（中年男声，偏沉）说：「晚了」')
    expect(plan.unregisteredSpeakers).toEqual([])
  })

  test('端点声明 H3 写法时才按 H3 拼，并带上这一镜的剧情', () => {
    const [id] = shotsOf(draft())
    const shot = getShot(db, id!)

    expect(planClip(db, shot, { audio: 'native', capabilities: { ...VIDEO, prompt_style: 'h3' } }).prompt).toContain('non_diegetic_music: N/A')
    expect(planClip(db, shot, { audio: 'native', capabilities: VIDEO }).prompt).not.toContain('non_diegetic_music')
    expect(planClip(db, shot, { audio: 'native', capabilities: null }).prompt).not.toContain('non_diegetic_music')
  })
})

describe('参考图模式带哪几段音色样本', () => {
  const H3: EndpointCapabilities = { ...VIDEO, prompt_style: 'h3', max_reference_audios: 3 }
  const REFERENCE = { style: '日系漫剧风格', tail: null }
  const SECONDS: Record<string, number> = { '/data/林小满-2.wav': 4, '/data/周岩.wav': 5, '/data/长样本-甲.wav': 10.4, '/data/长样本-乙.wav': 8 }
  const measure = (path: string) => SECONDS[path] ?? null

  /** 同一个角色可以有多段试音，锁定时最后一段为当前。 */
  function voiced(name: string, samples: readonly string[]): ShotRef {
    const id = createAsset(db, { projectId, category: 'character', name, data: { tier: 'lead', voice: `${name}的嗓音` } })
    addAssetFile(db, id, { role: 'full_body', path: `/data/${name}.png` })
    for (const path of samples) addAssetFile(db, id, { role: 'voice_sample', path })
    return { asset_id: id, version_id: lockAsset(db, id).versionId, name }
  }

  // <Audio N> 的编号与请求里参考音频的顺序必须一致。
  test('按开口先后排，取锁定时的当前样本，提示词编号一致', () => {
    const her = voiced('林小满', ['/data/林小满-1.wav', '/data/林小满-2.wav'])
    const him = voiced('周岩', ['/data/周岩.wav'])
    const [id] = shotsOf(draft({ cast: [her, him], clipSource: 'reference', utterances: [{ speaker: '周岩', text: '晚了' }, { speaker: '林小满', text: '别过来' }] }))

    const plan = planClip(db, getShot(db, id!), { audio: 'native', capabilities: H3, reference: REFERENCE, measure })

    expect(plan.voices).toEqual([
      { name: '周岩', path: '/data/周岩.wav', seconds: 5, trimmed: false },
      { name: '林小满', path: '/data/林小满-2.wav', seconds: 4, trimmed: false },
    ])
    expect(plan.voiceMisses).toEqual([])
    expect(plan.prompt).toContain('周岩 <Subject 2> (S1)（音色取自 <Audio 1>）')
    expect(plan.prompt).toContain('林小满 <Subject 1> (S2)（音色取自 <Audio 2>）')
  })

  test('样本合计超出时长时按人均分，各截前段，两人都带上', () => {
    const a = voiced('甲', ['/data/长样本-甲.wav'])
    const b = voiced('乙', ['/data/长样本-乙.wav'])
    const [id] = shotsOf(draft({ cast: [a, b], clipSource: 'reference', utterances: [{ speaker: '甲', text: '一发' }, { speaker: '乙', text: '一处' }] }))

    const plan = planClip(db, getShot(db, id!), { audio: 'native', capabilities: H3, reference: REFERENCE, measure })

    expect(plan.voices).toEqual([
      { name: '甲', path: '/data/长样本-甲.wav', seconds: 7.5, trimmed: true },
      { name: '乙', path: '/data/长样本-乙.wav', seconds: 7.5, trimmed: true },
    ])
    expect(plan.voiceMisses).toEqual([])
  })

  test('画外说话人与首帧模式都不带', () => {
    const her = voiced('林小满', ['/data/林小满-2.wav'])
    voiced('周岩', ['/data/周岩.wav'])
    const [id] = shotsOf(draft({ cast: [her], utterances: [{ speaker: '周岩', text: '晚了' }, { speaker: '林小满', text: '别过来' }] }))
    const shot = getShot(db, id!)

    expect(planClip(db, shot, { audio: 'native', capabilities: H3, reference: REFERENCE, measure }).voices.map((v) => v.name)).toEqual(['林小满'])
    expect(planClip(db, shot, { audio: 'native', capabilities: H3, measure }).voices).toEqual([])
  })

  test('过短、超出段数或读不出时长的不带并记下原因，过长的截前段带上', () => {
    const her = voiced('林小满', ['/data/林小满-2.wav'])
    const him = voiced('周岩', ['/data/周岩.wav'])
    const [id] = shotsOf(draft({ cast: [her, him], utterances: [{ speaker: '林小满', text: '别过来' }, { speaker: '周岩', text: '晚了' }] }))
    const shot = getShot(db, id!)
    const plan = (capabilities: EndpointCapabilities, seconds: Record<string, number>) =>
      planClip(db, shot, { audio: 'native', capabilities, reference: REFERENCE, measure: (path) => seconds[path] ?? null })

    const tooShort = plan(H3, { '/data/林小满-2.wav': 1, '/data/周岩.wav': 5 })
    expect(tooShort.voices.map((v) => v.name)).toEqual(['周岩'])
    expect(tooShort.voiceMisses).toEqual([{ name: '林小满', reason: '样本 1.0 秒，短于 2 秒' }])
    expect(plan(H3, { '/data/林小满-2.wav': 16, '/data/周岩.wav': 5 }).voices.map((v) => v.seconds)).toEqual([7.5, 5])
    expect(plan({ ...H3, max_reference_audios: 1 }, SECONDS).voiceMisses).toEqual([{ name: '周岩', reason: '接口最多接受 1 段' }])
    expect(plan(H3, {}).voiceMisses.map((m) => m.reason)).toEqual(['读不出样本时长', '读不出样本时长'])
  })
})

describe('资产重新锁定后镜头改用新版', () => {
  test('只补了音色样本时首帧不过时，只有参考图模式的视频过时', () => {
    const her = lock('character', '林小满', { tier: 'lead', voice: '少女音' })
    const ids = shotsOf(draft({ cast: [her], clipSource: 'reference' }), draft({ cast: [her] }))
    const owners = ids.map((id) => ({ kind: 'shot' as const, id }))
    for (const owner of owners) {
      recordArtifact(db, owner, 'first_frame', { path: '/data/f.png' })
      recordArtifact(db, owner, 'clip', { path: '/data/c.mp4' })
    }
    unlockAsset(db, her.asset_id)
    addAssetFile(db, her.asset_id, { role: 'voice_sample', path: '/data/v.wav' })
    lockAsset(db, her.asset_id)

    expect(followLatestVersion(db, her.asset_id)).toBe(2)
    const states = owners.map((owner) => Object.fromEntries(currentArtifacts(db, owner).map((a) => [a.kind, a.state])))
    expect(states).toEqual([
      { first_frame: 'fresh', clip: 'stale' },
      { first_frame: 'fresh', clip: 'fresh' },
    ])
  })
})

describe('接哪一镜', () => {
  test('同一个场景锁定版才接，第一镜与换场景的不接', () => {
    const scene = lock('scene', '雪夜屋檐')
    const other = lock('scene', '灶间')
    const ids = shotsOf(
      draft({ sceneRef: scene }),
      draft({ sceneRef: scene }),
      draft({ sceneRef: other }),
      draft({ sceneRef: other, joinMode: 'cut' }),
    )
    const [first, second, third, fourth] = ids.map((id) => getShot(db, id))

    expect(chainsFrom(db, first!, 'chain')).toBeNull()
    expect(chainsFrom(db, second!, 'chain')?.idx).toBe(0)
    expect(chainsFrom(db, third!, 'chain')).toBeNull()
    // 标了硬切的，场景相同也不接。
    expect(chainsFrom(db, fourth!, 'chain')).toBeNull()
    expect(chainsFrom(db, second!, 'cut')).toBeNull()
  })

  /** 末帧在发起时从上一镜视频抽取，预览要与实际发送一致。 */
  test('上一镜的视频文件不在时不接末帧，提示词与不接时相同', () => {
    const scene = lock('scene', '雪夜屋檐')
    const [first, second] = shotsOf(draft({ sceneRef: scene }), draft({ sceneRef: scene }))
    const alone = shotPreview(db, getShot(db, second!))
    const clip = join(tmpdir(), `vesper-clip-${Date.now()}.mp4`)
    writeFileSync(clip, '')
    recordArtifact(db, { kind: 'shot', id: first! }, 'clip', { path: clip })

    const chained = shotPreview(db, getShot(db, second!))
    rmSync(clip)
    const orphaned = shotPreview(db, getShot(db, second!))

    expect(chained.refs[0]?.kind).toBe('上一镜的末帧')
    expect(chained.first_frame).not.toBe(alone.first_frame)
    expect(orphaned.refs).toEqual(alone.refs)
    expect(orphaned.first_frame).toBe(alone.first_frame)
  })
})

describe('设定图要发什么', () => {
  test('提示词带上画风与这一类的锚点', () => {
    const id = createAsset(db, {
      projectId,
      category: 'scene',
      name: '雪夜屋檐',
      data: { description: '压着白的青瓦', lighting: '月色偏冷' },
    })

    const preview = assetPreview(db, id)

    expect(preview.looks).toHaveLength(1)
    expect(preview.looks[0]!.prompt).toContain('日系漫剧风格')
    expect(preview.looks[0]!.prompt).toContain('压着白的青瓦')
    expect(preview.looks[0]!.prompt).toContain('月色偏冷')
  })

  test('角色的外形、服装与填写的模板参数都进提示词', () => {
    const id = createAsset(db, {
      projectId,
      category: 'character',
      name: '林小满',
      data: { tier: 'lead', traits: '圆脸，齐耳短发', outfit: '红棉袄' },
    })

    const preview = assetPreview(db, id, { promptArgs: { look: { note: '不要出现雪人' } } })

    expect(preview.looks[0]!.prompt).toContain('圆脸，齐耳短发')
    expect(preview.looks[0]!.prompt).toContain('红棉袄')
    expect(preview.looks[0]!.prompt).toContain('不要出现雪人')
    expect(assetPreview(db, id).looks[0]!.prompt).not.toContain('不要出现雪人')
  })
})

describe('改写过的提示词', () => {
  test('镜头的两段提示词分别改写', () => {
    const [id] = shotsOf(draft())

    const preview = shotPreview(db, getShot(db, id!), { promptText: { first_frame: '换成一张空镜' } })

    expect(preview.first_frame).toBe('换成一张空镜')
    expect(preview.clip).toContain('缓缓抬头')
  })

  test('设定图按类型改写，改一张不影响其余', () => {
    const id = createAsset(db, { projectId, category: 'character', name: '林小满', data: { tier: 'lead' } })

    const preview = assetPreview(db, id, { promptText: { look_portrait: '只要一张脸' } })

    expect(preview.looks.find((look) => look.role === 'portrait')!.prompt).toBe('只要一张脸')
    expect(preview.looks.find((look) => look.role === 'full_body')!.prompt).toContain('林小满')
  })
})
