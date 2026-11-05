/** 提示词里漏了也不报错的部分：措辞好坏验不了，只验该带的内容是否带上。 */

import { describe, expect, test } from 'bun:test'

import { CAMERA_MOVES, CLIP_SOURCES, SHOT_JOINS, SHOT_SIZES, STYLE_GROUPS, stylePresetOf } from '@vesper/shared'

import {
  assetsPrompt,
  beatsPrompt,
  clipPrompt,
  episodePrompt,
  firstFramePrompt,
  h3ClipPrompt,
  lookPrompt,
  PROMPT_TEMPLATES,
  reviewPrompt,
  shotPromptDraft,
  shotsPrompt,
  stylePrompt,
} from '../src/pipeline/prompts'

const BASE = { motionPrompt: '人物缓缓抬头', seconds: 8 }

describe('视频提示词', () => {
  test('怎么说紧贴在台词前，声音段用这一镜自己的', () => {
    const speech = { lines: [{ speaker: '青禾', text: '再等', how: '压低嗓音，经对讲机传出' }], voices: {} }
    const sound = '对讲机电流声最响，远处低频震动垫在底下'

    expect(clipPrompt({ ...BASE, castNames: ['青禾'], speech, sound })).toContain('「青禾」说，压低嗓音，经对讲机传出：「再等」')
    expect(clipPrompt({ ...BASE, sound })).toContain(`声音：${sound}。不加背景音乐。`)
    const h3 = h3ClipPrompt({ ...BASE, castNames: ['青禾'], speech, sound })
    expect(h3).toContain('(S1)，压低嗓音，经对讲机传出， says: <d>[Chinese] 再等</d>')
    expect(h3).toContain(`overall_soundscape: ${sound}。人声只有上面的台词。`)
    expect(h3ClipPrompt(BASE)).toContain('overall_soundscape: 环境声与动作音效贴合画面，没有人声。')
  })

  test('运镜压在动作行开头', () => {
    expect(clipPrompt({ ...BASE, cameraMove: '推' })).toContain('动作：镜头推。')
    expect(clipPrompt(BASE)).toContain('动作：' + BASE.motionPrompt)
  })

  test('视频自带声音下台词逐字进提示词，并带上说话人与音色', () => {
    const prompt = clipPrompt({
      ...BASE,
      speech: { lines: [{ speaker: '阿岚', text: '别过来' }], voices: { 阿岚: '少年音，清亮' } },
    })

    expect(prompt).toContain('「阿岚」（少年音，清亮）说：「别过来」')
  })

  // 一镜里台词与旁白混排时，按句判断说话人。
  test('对白里夹一句旁白，两者各走各的支，不会出现「null」说', () => {
    const prompt = clipPrompt({
      ...BASE,
      speech: {
        lines: [
          { speaker: null, text: '那是三天前' },
          { speaker: '阿岚', text: '别过来' },
        ],
        voices: {},
      },
    })

    expect(prompt).toContain('旁白念：「那是三天前」')
    expect(prompt).toContain('「阿岚」说：「别过来」')
    expect(prompt).not.toContain('null')
  })

  // 参考图模式的 image_prompt 已按景别机位写明取景，视频提示词只拼场景。
  test('参考图模式把取景描述拼进视频提示词，景别机位不另拼', () => {
    const opening = { style: '', scene: '擂台', shotSize: '远景', camera: '低机位，擂台边', imagePrompt: '沈青禾站在擂台中央', refs: [] }
    const prompt = clipPrompt({ ...BASE, opening })

    expect(prompt).toContain('擂台')
    expect(prompt).toContain('沈青禾站在擂台中央')
    expect(prompt).not.toContain('低机位，擂台边')
    expect(prompt).not.toContain('远景')
    expect(prompt).not.toBe(clipPrompt(BASE))
  })

  // 时长只走请求参数时，模型会给多出的时间自己加戏。
  test('这一镜有多长要写进提示词，不能只当请求参数', () => {
    expect(clipPrompt(BASE)).toContain('这一镜 8 秒')
  })

  // 首帧看不出谁在哪，语境要用文字交代；不复述 image_prompt。
  test('画面语境是场景与人物名，没给语境就不留空壳', () => {
    expect(clipPrompt({ ...BASE, scene: '战术室，冷蓝光', castNames: ['沈青禾'] })).toContain('画面：战术室，冷蓝光。画面里是沈青禾\n')
    expect(clipPrompt(BASE)).not.toContain('画面：')
  })

  // 没台词的镜头也要排除字幕，不能只在台词总述里写。
  test('字幕、文字、水印每镜都排除，有台词时也只说一次', () => {
    const speech = { lines: [{ speaker: '阿岚', text: '别过来' }], voices: {} }
    for (const prompt of [clipPrompt(BASE), h3ClipPrompt(BASE)]) expect(prompt).toContain('画面里不要出现字幕、文字或水印。')
    for (const prompt of [clipPrompt({ ...BASE, speech }), h3ClipPrompt({ ...BASE, speech })]) expect(prompt.split('字幕').length - 1).toBe(1)
  })

  test('台词数组是空的就当没有，不留一句空转的指令', () => {
    expect(clipPrompt({ ...BASE, speech: { lines: [], voices: { 阿岚: '少年音' } } })).toBe(clipPrompt(BASE))
  })
})

describe('H3 视频提示词', () => {
  const REFS = [
    { kind: '场景', name: '演武场', anchor: '露天擂台', duty: '提供这个地点的空间结构' },
    { kind: '人物', name: '阿岚', anchor: '少年，白发', duty: '只提供长相' },
    { kind: '人物', name: '青禾', anchor: '少女，短发', duty: '只提供长相' },
  ]
  const OPENING = { style: '日系漫剧', scene: '擂台', camera: '低机位', imagePrompt: '阿岚站在擂台中央，青禾在台下', refs: REFS }

  test('首帧模式照官方锚定首帧，不写秒数、不写一镜到底', () => {
    const prompt = h3ClipPrompt(BASE)

    expect(prompt.startsWith('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.')).toBe(true)
    expect(prompt).toContain('integrated_multimodal_description: [Shot 1] ')
    expect(prompt).toContain('non_diegetic_music: N/A')
    expect(prompt).not.toContain('8 秒')
    expect(prompt).not.toContain('一镜到底')
  })

  test('说话人按头一次开口编号，音色只报一次，台词带语言标记逐字进 <d>', () => {
    const prompt = h3ClipPrompt({
      ...BASE,
      speech: {
        lines: [
          { speaker: '阿岚', text: '别过来' },
          { speaker: null, text: '那是三天前' },
          { speaker: '阿岚', text: '走' },
        ],
        voices: { 阿岚: '少年音，清亮' },
      },
    })

    expect(prompt).toContain('阿岚 (S1)（少年音，清亮） says: <d>[Chinese] 别过来</d>')
    expect(prompt).toContain("旁白 (S2) says in an off-screen voiceover: <d>[Chinese] 那是三天前</d> while the on-screen characters' lips remain completely closed.")
    expect(prompt).toContain('阿岚 (S1) says: <d>[Chinese] 走</d>')
  })

  test('不在出镜角色里的说话人标成画外，画面里的人闭口', () => {
    const prompt = h3ClipPrompt({ ...BASE, castNames: ['阿岚'], speech: { lines: [{ speaker: '青禾', text: '回来' }], voices: {} } })

    expect(prompt).toContain("青禾 (S1) says off-screen: <d>[Chinese] 回来</d> while the on-screen characters' lips remain completely closed.")
  })

  // 花名册顺序与参考图顺序必须一致。
  test('参考图模式六段齐全，Subject 编号与参考图顺序一致，同类职责只说一次', () => {
    const prompt = h3ClipPrompt({ ...BASE, summary: '阿岚登台', opening: OPENING, speech: { lines: [{ speaker: '青禾', text: '小心' }], voices: {} } })

    const sections = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']
    const at = sections.map((section) => prompt.indexOf(`${section}\n`))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(prompt).toContain('<Subject 2> is 人物「阿岚」 in <Picture 2>: 少年，白发')
    expect(prompt).toContain('[reference generation] 阿岚登台')
    expect(prompt).toContain('<Subject 2>: fully_preserved - 只提供长相\n<Subject 3>: fully_preserved\n')
    expect(prompt).toContain('阿岚 <Subject 2> 站在擂台中央，青禾 <Subject 3> 在台下')
    expect(prompt).toContain('青禾 <Subject 3> (S1) says: <d>[Chinese] 小心</d>')
    expect(prompt).toContain('[Shot 1] 擂台。阿岚 <Subject 2> 站在擂台中央')
    expect(prompt).not.toContain('低机位')
    expect(prompt).not.toContain('@图片')
  })

  // <Audio N> 要与请求里第 N 段参考音频对应。
  test('带音色样本时 <Audio N> 绑到说话人的 Subject 上，没带样本的说话人仍用文字音色', () => {
    const speech = { lines: [{ speaker: '青禾', text: '小心' }, { speaker: '阿岚', text: '嗯' }], voices: { 阿岚: '少年音' } }
    const prompt = h3ClipPrompt({ ...BASE, summary: '阿岚登台', opening: OPENING, speech: { ...speech, samples: ['青禾'] } })

    expect(prompt).toContain('<Audio 1> is the voice-timbre reference for <Subject 3> (S1), containing a spoken Chinese vocal layer.\n\nsummary:')
    expect(prompt).toContain('[reference generation + audio reference] 阿岚登台')
    expect(prompt).toContain('<Audio 1>: reference - its vocal timbre guides the dialogue delivery of <Subject 3> without copying the original signal.')
    expect(prompt).toContain('青禾 <Subject 3> (S1)（音色取自 <Audio 1>） says: <d>[Chinese] 小心</d>')
    expect(prompt).toContain('阿岚 <Subject 2> (S2)（少年音） says:')
    expect(h3ClipPrompt({ ...BASE, opening: OPENING, speech: { ...speech, samples: [] } })).toBe(h3ClipPrompt({ ...BASE, opening: OPENING, speech }))
  })

  test('首帧模式不认音色样本', () => {
    const speech = { lines: [{ speaker: '阿岚', text: '走' }], voices: {} }
    expect(h3ClipPrompt({ ...BASE, speech: { ...speech, samples: ['阿岚'] } })).toBe(h3ClipPrompt({ ...BASE, speech }))
  })

  test('台词数组是空的就当没有', () => {
    expect(h3ClipPrompt({ ...BASE, speech: { lines: [], voices: {} } })).toBe(h3ClipPrompt(BASE))
    expect(h3ClipPrompt(BASE)).toContain('没有人声')
  })
})

describe('首帧提示词', () => {
  const FRAME = { style: '日系漫剧', scene: '驾驶舱内', camera: '中景', imagePrompt: '人物坐在操作台前' }
  const TAIL = { kind: '上一镜的末帧', name: '', anchor: '这一镜紧接着它发生' }

  test('花名册里报的顺序就是参考图的顺序，没名字的那张报它是什么', () => {
    const prompt = firstFramePrompt({
      ...FRAME,
      refs: [TAIL, { kind: '人物', name: '阿岚', anchor: '少年，白发' }],
      continues: true,
    })

    expect(prompt).toContain('@图片1 是上一镜的末帧（这一镜紧接着它发生）')
    expect(prompt).toContain('@图片2 是人物「阿岚」（少年，白发）')
  })

  // 设定图是中性平光、纯灰背景，光线与质感要交给画风。
  test('参考图只管长相，光线、色调与质感归画风', () => {
    const prompt = firstFramePrompt({ ...FRAME, refs: [{ kind: '人物', name: '阿岚', anchor: '少年，白发' }] })

    expect(prompt).toContain('光线、色调与质感照开头的画风')
    expect(prompt.indexOf('日系漫剧')).toBeLessThan(prompt.indexOf('参考图'))
  })

  test('同一类的职责只说一次，名字接上参考图编号', () => {
    const prompt = firstFramePrompt({
      ...FRAME,
      imagePrompt: '阿岚看向小满，小满没抬头',
      refs: [
        { kind: '人物', name: '阿岚', anchor: '少年，白发', duty: '只提供长相、发型、服装与配饰' },
        { kind: '人物', name: '小满', anchor: '少女，短发', duty: '只提供长相、发型、服装与配饰' },
      ],
    })

    expect(prompt).toContain('@图片1 是人物「阿岚」（少年，白发），只提供长相、发型、服装与配饰')
    expect(prompt).toContain('@图片2 是人物「小满」（少女，短发）\n')
    // 名字第二次出现不再接编号，同一个人标两次会被当成两个人。
    expect(prompt).toContain('阿岚（@图片1）看向小满（@图片2），小满没抬头')
  })
})

describe('画风推荐提示词', () => {
  // 挑画风看题材，只给名称与用途；模型回的名称要能在预设表里查到。
  test('预设名称全进提示词，画风词本身不进', () => {
    const prompt = stylePrompt('顾舟推开落马镇客栈的门')

    for (const preset of STYLE_GROUPS.flatMap((group) => group.presets)) {
      expect(prompt).toContain(preset.label)
      expect(prompt).not.toContain(preset.prompt)
    }
    expect(prompt).toContain('顾舟推开落马镇客栈的门')
  })

  // 模型只回名称，靠 stylePresetOf 换回画风词，名称必须唯一。
  test('预设名称在全表里唯一，表外的名称查不到', () => {
    const presets = STYLE_GROUPS.flatMap((group) => group.presets)
    const labels = presets.map((preset) => preset.label)

    expect(new Set(labels).size).toBe(labels.length)
    expect(stylePresetOf(presets[0]!.label)).toBe(presets[0]!)
    expect(stylePresetOf('赛博古风')).toBeUndefined()
  })
})

describe('节拍', () => {
  const BEATS = { title: '第一集', synopsis: '', source: '原文正文', targetSeconds: 0, cast: [] }

  test('讲法选哪个就换哪套标准，认不出的取值退回第一项', () => {
    expect(beatsPrompt(BEATS, { mode: 'narrated' })).not.toBe(beatsPrompt(BEATS))
    expect(beatsPrompt(BEATS, { mode: 'x' })).toBe(beatsPrompt(BEATS))
  })

  test('没人开口的动作段写成不带台词的 scene，不配旁白', () => {
    expect(beatsPrompt(BEATS)).toContain('没人开口的动作段写成不带台词的 scene')
  })

  // 统称派给具名人物，这个人就会出现在他不该在的场面里。
  test('原文统称说的话照统称写，不派给具名人物', () => {
    expect(beatsPrompt(BEATS)).toContain('照统称写，不要派给某个有名字的人')
  })

  // 名著改编时把文言对白改成白话，最出彩的原句就没了。
  test('原文对白照原句用，只截取或删句，不改措辞', () => {
    expect(beatsPrompt(BEATS)).toContain('原文里人物说过的话照原句用')
    expect(beatsPrompt(BEATS)).not.toContain('不要书面语长句')
  })

  // 末句是代码定位原文区间的依据，必须逐字抄。
  test('每拍逐字抄末句，供代码定位这一拍的原文段', () => {
    expect(beatsPrompt(BEATS)).toContain('ends_with')
  })

  test('插叙、倒叙、补叙照样写成节拍', () => {
    expect(beatsPrompt(BEATS)).toContain('插叙、倒叙、括号里的补叙也是剧情')
  })
})

describe('镜头提示词精写', () => {
  const DRAFT = {
    episode: { title: '第一集', synopsis: '雪夜夺城' },
    beatSummary: '客栈对峙',
    sourceText: '他掀开斗篷，雪片扑进门内，堂中霎时静了。',
    previous: { summary: '推门而入', camera: '平视', ending: '他跨过门槛，斗篷上的雪落了一地。镜头固定' },
    next: null,
    shot: {
      summary: '亮刀',
      scene: '客栈堂内，油灯昏黄',
      shotSize: '近景',
      camera: '略低机位',
      cameraMove: 'push' as const,
      mood: '从戒备转为杀意',
      seconds: 6,
      clipSource: 'first_frame' as const,
    },
    utterances: [{ speaker: '阿岚', text: '别过来' }],
    cast: [{ name: '阿岚', identity: '镖师', traits: '' }],
    sceneAnchor: '木梁客栈，长条桌，油灯',
    props: [],
  }

  // 只给上下镜的一句概要时，相邻两镜的首帧姿态接不上。
  test('上一镜的动作末态与本镜的景别、运镜、情绪、时长都作为已定项给出', () => {
    const prompt = shotPromptDraft(DRAFT)

    expect(prompt).toContain('上一镜收在：他跨过门槛')
    expect(prompt).toContain('景别构图：近景，略低机位')
    expect(prompt).toContain('运镜：推')
    expect(prompt).toContain('情绪：从戒备转为杀意')
    expect(prompt).toContain('时长：6 秒')
    expect(prompt).toContain('别过来')
  })

  test('原文段进提示词，且写法判据排在材料之前', () => {
    const prompt = shotPromptDraft(DRAFT)

    expect(prompt).toContain('他掀开斗篷')
    expect(prompt.indexOf('image_prompt')).toBeLessThan(prompt.indexOf('他掀开斗篷'))
  })

  test('体量大的主体靠参照物写尺度', () => {
    expect(shotPromptDraft(DRAFT)).toContain('尺度靠画面里大小已知的东西对比出来')
  })

  // 靠声音交代剧情的镜头需要写这一镜自己的声音。
  test('要求写这一镜的声音，有台词时再要每句怎么说', () => {
    const silent = shotPromptDraft({ ...DRAFT, utterances: [] })
    expect(silent).toContain('sound 怎么写')
    expect(silent).not.toContain('lines')

    const spoken = shotPromptDraft(DRAFT)
    expect(spoken).toContain('"lines":[{"how":""}]')
    expect(spoken).toContain('当面说还是经设备传出')
  })

  // 只给名字身份时，非人形角色会被写成人的姿态。
  test('人物给名字、身份与外形', () => {
    expect(shotPromptDraft(DRAFT)).toContain('阿岚（镖师）')
    expect(shotPromptDraft({ ...DRAFT, cast: [{ name: '小白', identity: '器灵', traits: '白色小狗，四条短腿' }] })).toContain(
      '小白（器灵；白色小狗，四条短腿）',
    )
  })

  test('画面来源不同，写法要求跟着换', () => {
    const reference = shotPromptDraft({ ...DRAFT, shot: { ...DRAFT.shot, clipSource: 'reference' as const } })

    expect(reference).not.toBe(shotPromptDraft(DRAFT))
    expect(shotPromptDraft(DRAFT)).toContain('出场人物都要在首帧里认得出来')
    expect(reference).not.toContain('出场人物都要在首帧里认得出来')
    expect(reference).toContain('image_prompt 是开场那一刻的静止画面')
    expect(reference).toContain('动作开始前的那一刻')
    expect(reference).not.toContain('首帧姿态')
    expect(shotPromptDraft(DRAFT)).toContain('image_prompt 是首帧静止画面')
  })

  test('定位失败或手插镜头没有原文段，不留空壳段落', () => {
    expect(shotPromptDraft({ ...DRAFT, sourceText: '' })).not.toContain('原文这一段')
  })

  test('有具名台词才要求写说话时的动作与嗓音，站位与易错处每镜都要', () => {
    expect(shotPromptDraft(DRAFT)).toContain('开口的人边说边做事')
    expect(shotPromptDraft({ ...DRAFT, utterances: [] })).not.toContain('开口的人边说边做事')
    expect(shotPromptDraft({ ...DRAFT, utterances: [] })).toContain('人物位置写成画面方位')
    expect(shotPromptDraft({ ...DRAFT, utterances: [] })).toContain('容易被演错的地方写成画面事实')
  })
})

const SHOTS = {
  beats: [{ mode: 'scene', summary: '对峙', source: '', utterances: [] }],
  cast: [],
  sceneNames: [],
  propNames: [],
  minSeconds: 5,
  maxSeconds: 10,
  targetSeconds: 0,
  spentSeconds: 0,
  audioMode: 'separate',
  focus: 0,
  previous: null,
} as const

describe('分镜提示词', () => {
  // 模型回的值要落在这几列的枚举里，没列出的取值永远不会被选到。
  test('景别、运镜、衔接、画面来源的每个取值都列给模型', () => {
    const prompt = shotsPrompt(SHOTS)

    for (const value of [...SHOT_SIZES, ...CAMERA_MOVES, ...SHOT_JOINS, ...CLIP_SOURCES]) expect(prompt).toContain(value)
  })

  test('中途才入画的人物走参考图模式', () => {
    expect(shotsPrompt(SHOTS)).toContain('人物中途入画的镜')
  })

  test('非人形角色的设定图按它自己的体态取景，不套人物立绘', () => {
    const creature = lookPrompt('full_body', '石麟', ['外貌：四足巨兽'], '', {}, { creature: true })

    expect(creature).toContain('按它自己的体态与重心摆出自然姿势')
    expect(creature).not.toContain('A-pose')
    expect(lookPrompt('portrait', '石麟', [], '', {}, { creature: true })).toContain('头部结构、眼睛')
  })

  // 两身衣服写进一个 outfit 时，全身图会画成两个人。
  test('换装的全身图以本体为参考只换衣服，全身图都写明单人', () => {
    expect(lookPrompt('full_body', '钱大人', ['着装：墨绿官服'], '', {}, { costume: true })).toContain('着装换成上面写的这一身')
    expect(lookPrompt('full_body', '钱大人', [], '')).toContain('单人全身立绘')
    expect(lookPrompt('full_body', '钱大人', [], '')).not.toContain('另一身衣服')
  })

  // 写了默认值时模型几乎全选首帧。
  test('画面来源按镜挑，不设默认', () => {
    const prompt = shotsPrompt(SHOTS)

    expect(prompt).toContain('不偏向哪一种')
    expect(prompt).not.toContain('默认 first_frame')
  })

  // 不写各身穿什么，模型分不出该挑本体还是换装。
  test('有换装的人物写出各身着装，并说明按场次挑一身', () => {
    const cast = [
      { name: '钱大人', identity: '县令', looks: ['full_body' as const], outfit: '紫色蟒纹袍' },
      { name: '钱大人·官服', identity: '县令', looks: ['full_body' as const], outfit: '墨绿官服' },
    ]
    const prompt = shotsPrompt({ ...SHOTS, cast })

    expect(prompt).toContain('钱大人·官服（县令；着装：墨绿官服）')
    expect(prompt).toContain('按这一场穿的那身填 cast')
    expect(shotsPrompt({ ...SHOTS, cast: [{ ...cast[0]!, outfit: '' }] })).not.toContain('名字带「·」')
  })

  // 只给名字时模型分不清对象是人还是物件。
  test('出镜人物带身份，只能从锁定版实际有的设定图里挑参考图', () => {
    const prompt = shotsPrompt({ ...SHOTS, cast: [{ name: '黑甲', identity: '机甲', looks: ['full_body', 'portrait'], outfit: '' }] })

    expect(prompt).toContain('黑甲（机甲）：full_body（全身）、portrait（半身特写）')
  })

  test('原文段附在节拍下，定位失败没有原文时不留空壳', () => {
    const withSource = { ...SHOTS, beats: [{ ...SHOTS.beats[0], source: '他按住刀柄，退了半步。' }] }

    expect(shotsPrompt(withSource)).toContain('原文：他按住刀柄，退了半步。')
    expect(shotsPrompt(SHOTS)).not.toContain('原文：')
  })

  test('一次只拆一拍：其余节拍只给概要，上一拍最后一镜作为衔接', () => {
    const beats = [
      { mode: 'scene', summary: '对峙', source: '', utterances: [{ speaker: '阿岚', text: '让开' }] },
      { mode: 'scene', summary: '出手', source: '他按住刀柄，退了半步。', utterances: [{ speaker: '青禾', text: '小心' }] },
    ] as const
    const previous = { summary: '阿岚拔刀', shotSize: 'close', camera: '低机位', scene: '演武场' }
    const prompt = shotsPrompt({ ...SHOTS, beats, focus: 1, previous })

    expect(prompt).toContain('→ [节拍 1] 展开演：出手')
    expect(prompt).toContain('(0) 青禾：小心')
    expect(prompt).not.toContain('(0) 阿岚：让开')
    expect(prompt).toContain('上一拍最后一镜')
    expect(prompt).toContain('阿岚拔刀')
    expect(shotsPrompt({ ...SHOTS, beats, focus: 0 })).toContain('这是本集第一镜，填 cut')
  })

  // 不限时长时不能编一个预算出来。
  test('给了目标时长才带上，不限时整句省略', () => {
    expect(shotsPrompt({ ...SHOTS, targetSeconds: 90 })).toContain('成片目标约 90 秒')
    // 逐拍调用时要告诉模型余量，每拍才不会都拆得偏长。
    const beats = [...SHOTS.beats, { mode: 'scene', summary: '追逐', source: '', utterances: [] }, { mode: 'scene', summary: '收尾', source: '', utterances: [] }] as const
    expect(shotsPrompt({ ...SHOTS, beats, targetSeconds: 90, focus: 1, spentSeconds: 40 })).toContain('前 1 拍已排约 40 秒，这一拍连同后面 1 拍还剩约 50 秒')
    expect(shotsPrompt({ ...SHOTS, targetSeconds: 90 })).not.toContain('已排约')
    expect(shotsPrompt(SHOTS)).not.toContain('成片目标约')
  })

  test('音轨模式不同，一镜几个说话人的规则跟着换', () => {
    expect(shotsPrompt({ ...SHOTS, audioMode: 'native' })).not.toBe(shotsPrompt(SHOTS))
  })

  // 两段提示词由逐镜精写给出，分镜这一步不要。
  test('分镜只出结构，两段提示词不在这一步要', () => {
    const prompt = shotsPrompt(SHOTS)

    expect(prompt).not.toContain('image_prompt')
    expect(prompt).not.toContain('motion_prompt')
  })
})

describe('发给图像与视频模型的', () => {
  const FRAME = { style: '', scene: '', camera: '', imagePrompt: '', refs: [] }

  // 否定句里的敏感词会原样进请求，同样可能被审核拦下。
  test('过审句不带敏感词', () => {
    for (const prompt of [lookPrompt('object', '军刀', [], ''), firstFramePrompt(FRAME), clipPrompt(BASE), h3ClipPrompt(BASE)]) {
      expect(prompt).not.toMatch(/血|伤口|刺入/)
    }
  })

  test('额外要求进提示词，但不提输出格式', () => {
    const note = { note: '雪再大一点' }
    for (const prompt of [lookPrompt('object', '军刀', [], '', note), firstFramePrompt(FRAME, note), clipPrompt(BASE, note), h3ClipPrompt(BASE, note), h3ClipPrompt({ ...BASE, opening: FRAME }, note)]) {
      expect(prompt).toContain('雪再大一点')
      expect(prompt).not.toContain('输出格式')
    }
  })
})

describe('模板参数', () => {
  const BEATS = { title: '第一集', synopsis: '', source: '原文正文', targetSeconds: 0, cast: [] }

  test('只填必填项时不长出额外的段落，多一行空行都不行', () => {
    expect(episodePrompt({ source: '原文', targetSeconds: 0 }, { episode_count: '2' })).not.toContain('额外要求')
    expect(assetsPrompt('原文')).toBe(assetsPrompt('原文', [], {}))
    expect(assetsPrompt('原文')).not.toContain('人工指定')
    // 道具名逐字进设定图提示词，按外观命名才不带剧情用途。
    expect(assetsPrompt('原文')).toContain('按物件看上去是什么来叫')
    expect(beatsPrompt(BEATS)).not.toContain('人工指定')
  })

  test('额外要求排在原文之前', () => {
    const prompt = beatsPrompt(BEATS, { note: '多给女主一点戏' })

    expect(prompt.indexOf('多给女主一点戏')).toBeGreaterThan(-1)
    expect(prompt.indexOf('多给女主一点戏')).toBeLessThan(prompt.indexOf('原文正文'))
  })

  test('指定集数就按指定的切，非数字或零当没填', () => {
    expect(episodePrompt({ source: '原文', targetSeconds: 0 }, { episode_count: '3' })).toContain('3 集')
    for (const bad of ['', '很多集', '0', '-2']) {
      expect(() => episodePrompt({ source: '原文', targetSeconds: 0 }, { episode_count: bad })).toThrow('需要集数')
    }
  })

  test('定位失败的原因回灌进重试提示词，且排在原文之前', () => {
    const prompt = episodePrompt(
      { source: '原文正文在这里', targetSeconds: 0, failure: ['第 1 集的 ends_with 在原文里不存在'] },
      { episode_count: '2' }
    )

    expect(prompt.indexOf('第 1 集的 ends_with 在原文里不存在')).toBeGreaterThan(-1)
    expect(prompt.indexOf('ends_with 在原文里不存在')).toBeLessThan(prompt.indexOf('原文正文在这里'))
  })

  test('列表参数顿号、逗号、换行都认', () => {
    expect(assetsPrompt('原文', [], { must_include: '金方，太白\n沈三' })).toContain('金方、太白、沈三')
  })

  test('每个模板都收自由补充', () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.params.some((p) => p.key === 'note')).toBe(true)
    }
  })

  // 未抽的类别连字段说明也不给，模型才不会照着填回来。
  test('只抽选中的类别，一个都没选就是三类都抽', () => {
    const only = assetsPrompt('原文', [], { categories: 'character' })
    expect(only).toContain('## 人物（characters）')
    expect(only).not.toContain('## 场景（scenes）')
    expect(only).not.toContain('## 道具（props）')

    const noCharacter = assetsPrompt('原文', [], { categories: 'scene,prop' })
    expect(noCharacter).not.toContain('- tier：')
    expect(noCharacter).toContain('- lighting：')

    // 多选控件取消到一个不剩时回到空串，按三类都抽处理。
    for (const args of [{}, { categories: '' }]) {
      const prompt = assetsPrompt('原文', [], args)
      expect(prompt).toContain('## 人物（characters）')
      expect(prompt).toContain('## 场景（scenes）')
      expect(prompt).toContain('## 道具（props）')
    }
  })
})

test('审查只给观众看得到的，镜号从 1 数', () => {
  const prompt = reviewPrompt({
    title: '第一集',
    previous: [{ title: '序', summaries: ['少年进山'] }],
    basis: 'shots',
    units: [{ picture: '酒楼里先生放下筷子', utterances: [{ speaker: null, text: '洞天崩碎' }] }],
  })

  expect(prompt).toContain('[镜 1] 酒楼里先生放下筷子')
  expect(prompt).toContain('旁白：「洞天崩碎」')
  expect(prompt).toContain('《序》少年进山')
})

// 个数、字数、次数的上限会被模型当指标凑数；功能上必须的数字（逐字抄写长度、配音每句字数）不受限。
test('所有模板都不写数字上限', () => {
  const source = '字'.repeat(2000)
  const frame = { style: '', scene: '擂台', camera: '平视', imagePrompt: '阿岚站着', refs: [{ kind: '人物', name: '阿岚', anchor: '' }] }
  const samples: Readonly<Record<string, readonly string[]>> = {
    episode: [episodePrompt({ source, targetSeconds: 180 }, { episode_count: '3' })],
    assets: [assetsPrompt(source, ['阿岚'])],
    beats: ['drama', 'narrated'].map((mode) => beatsPrompt({ title: '第一集', synopsis: '', source, targetSeconds: 180, cast: [] }, { mode })),
    shots: (['separate', 'native'] as const).map((audioMode) => shotsPrompt({ ...SHOTS, targetSeconds: 180, audioMode })),
    review: [reviewPrompt({ title: '第一集', previous: [], basis: 'beats', units: [{ picture: '', utterances: [] }] })],
    shot_prompt: [
      shotPromptDraft({
        episode: { title: '第一集', synopsis: '' },
        beatSummary: '对峙',
        sourceText: source,
        previous: null,
        next: null,
        shot: { summary: '', scene: '', shotSize: '', camera: '', cameraMove: 'static', mood: '', seconds: 6, clipSource: 'reference' },
        utterances: [{ speaker: '阿岚', text: '走' }],
        cast: [],
        sceneAnchor: '',
        props: [],
      }),
    ],
    look: ['full_body', 'portrait', 'turnaround', 'expressions', 'outfit', 'establishing', 'object'].map((role) => lookPrompt(role, '阿岚', [], '')),
    first_frame: [firstFramePrompt({ ...frame, continues: true })],
    clip: [clipPrompt, h3ClipPrompt].map((compose) => compose({ ...BASE, opening: frame, speech: { lines: [{ speaker: '阿岚', text: '走' }, { speaker: null, text: '三天后' }], voices: {} } })),
  }

  expect(Object.keys(samples).sort()).toEqual(PROMPT_TEMPLATES.map((template) => template.id).sort())
  for (const prompt of [...Object.values(samples).flat(), stylePrompt(source)]) {
    expect(prompt).not.toMatch(/不超过 ?\d|最多 ?\d|至多 ?\d|\d+ ?[个条句字]?以内|\d+ 个节拍/)
  }
})
