/** 打印各模板实际发出的提示词。样例固定、不连库，输出稳定便于 diff。 */

import { stylePresetOf } from '@vesper/shared'

import {
  assetsPrompt,
  beatsPrompt,
  clipPrompt,
  h3ClipPrompt,
  episodePrompt,
  firstFramePrompt,
  lookPrompt,
  reviewPrompt,
  shotPromptDraft,
  shotsPrompt,
  stylePrompt,
  REF_KINDS,
} from '../pipeline/prompts'

const SOURCE =
  '顾舟推开落马镇客栈的门时，雪已经下了三天。柳三娘在柜台后打着算盘，听见门响也没抬头，'
  + '只说了句「打烊了」。顾舟没走，反手把门顶回原位。他左颊那道旧疤在油灯下泛着白。'
  + '「我找一个人。」他说。算盘停了。'

const CAST = [
  { name: '顾舟', identity: '关外来的刀客' },
  { name: '柳三娘', identity: '客栈掌柜' },
]

const REFS = [
  {
    kind: REF_KINDS.scene.label,
    name: '落马镇客栈',
    anchor: '关外土坯客栈，堂内八张方桌，土炕靠东墙，油灯昏黄',
    duty: REF_KINDS.scene.duty,
  },
  {
    kind: REF_KINDS.character.label,
    name: '顾舟',
    anchor: '二十出头男子，身形瘦高，寸头，眉骨突出，左颊一道旧疤',
    duty: REF_KINDS.character.duty,
  },
  {
    kind: REF_KINDS.character.label,
    name: '柳三娘',
    anchor: '四十上下妇人，圆脸，发髻插木簪，褐色短褂',
    duty: REF_KINDS.character.duty,
  },
]

// 用预设表里真实的一条：画风词逐字进 look 与 first_frame，要看实际长度。
const STYLE = stylePresetOf('古装正剧')!.prompt

const CLIP = {
  motionPrompt: '顾舟背对堂内立在门边。他反手把门顶回原位，风声骤停，肩上的雪簌簌落下',
  cameraMove: '推',
  scene: '客栈门口内侧，冷白雪光从门缝灌入，与堂内暖黄灯光在地面交界',
  castNames: ['顾舟', '柳三娘'],
  seconds: 8,
  sound: '门外风雪呼啸，门一关骤然压低；堂内算盘珠的噼啪声垫在底下',
  speech: { lines: [{ speaker: '顾舟', text: '我找一个人。', how: '压着嗓子，一字一顿' }], voices: { 顾舟: '低沉沙哑' } },
}

const SAMPLES: Readonly<Record<string, () => string>> = {
  episode: () => episodePrompt({ source: SOURCE, targetSeconds: 180 }, { episode_count: '3' }),
  assets: () => assetsPrompt(SOURCE, ['顾舟']),
  beats: () =>
    beatsPrompt({ title: '第一集 · 落马镇', synopsis: '刀客找人，掌柜不认', source: SOURCE, targetSeconds: 180, cast: CAST }),
  shots: () =>
    shotsPrompt({
      beats: [
        { mode: 'narration', summary: '雪下到第三天，落马镇来了个外乡人', source: '', utterances: [{ speaker: null, text: '雪下到第三天，落马镇来了个外乡人。' }] },
        {
          mode: 'scene',
          summary: '顾舟顶着风雪进店，柳三娘不理',
          source:
            '门被推开时带进一股雪粒，顾舟站在门槛上抖了抖斗笠。柳三娘头也不抬，算盘珠子拨得噼啪响。'
            + '「打烊了。」她说。顾舟把斗笠搁在柜台上：「我找一个人。」',
          utterances: [
            { speaker: '柳三娘', text: '打烊了。' },
            { speaker: '顾舟', text: '我找一个人。' },
          ],
        },
      ],
      cast: [
        { name: '顾舟', identity: '关外来的刀客', looks: ['full_body', 'portrait', 'turnaround'], outfit: '灰褐粗布短打，旧羊皮坎肩' },
        { name: '顾舟·夜行衣', identity: '关外来的刀客', looks: ['full_body'], outfit: '黑色紧身夜行衣，蒙面黑巾' },
        { name: '柳三娘', identity: '客栈掌柜', looks: ['full_body'], outfit: '' },
      ],
      sceneNames: ['落马镇客栈'],
      propNames: ['算盘'],
      minSeconds: 4,
      maxSeconds: 10,
      targetSeconds: 180,
      audioMode: 'native',
      focus: 1,
      spentSeconds: 42,
      previous: { summary: '风雪里的落马镇长街，客栈门口挂着一盏灯', shotSize: '远景', camera: '高机位俯拍长街', scene: '落马镇客栈' },
    }),
  review: () =>
    reviewPrompt({
      title: '第一集 · 落马镇',
      previous: [],
      basis: 'beats',
      units: [
        { picture: '顾舟顶着风雪进店，柳三娘不理', utterances: [{ speaker: '柳三娘', text: '打烊了。' }] },
      ],
    }),
  shot_prompt: () =>
    shotPromptDraft({
      episode: { title: '第一集 · 落马镇', synopsis: '刀客找人，掌柜不认' },
      beatSummary: '顾舟顶着风雪进店，柳三娘不理',
      sourceText:
        '门被推开时带进一股雪粒，顾舟站在门槛上抖了抖斗笠。柳三娘头也不抬，算盘珠子拨得噼啪响。'
        + '「打烊了。」她说。顾舟把斗笠搁在柜台上：「我找一个人。」',
      previous: {
        summary: '雪夜街面，客栈灯还亮着',
        camera: '平视，客栈门脸居中',
        ending: '风卷着雪从街面横扫过去，客栈门板被推开一条缝，暖光漏到雪地上。镜头固定',
      },
      next: { summary: '柳三娘抬头打量他', camera: '平视，过肩' },
      shot: {
        summary: '顾舟推门进店',
        scene: '客栈门口内侧，冷白雪光从门缝灌入，与堂内暖黄灯光在地面交界',
        shotSize: '中景',
        camera: '平视，人物居右，门框在前景',
        cameraMove: 'static',
        mood: '从风雪里的疲惫转为进门后的警觉',
        seconds: 6,
        clipSource: 'first_frame',
      },
      utterances: [{ speaker: '顾舟', text: '我找一个人。' }],
      cast: [
        { ...CAST[0]!, traits: REFS[1]!.anchor },
        { ...CAST[1]!, traits: REFS[2]!.anchor },
      ],
      sceneAnchor: '关外土坯客栈，堂内八张方桌，土炕靠东墙，油灯昏黄',
      props: [{ name: '算盘', description: '深色木算盘，十三档' }],
    }),
  look: () => lookPrompt('full_body', '顾舟', [REFS[1]!.anchor], STYLE),
  style: () => stylePrompt(SOURCE),
  first_frame: () =>
    firstFramePrompt({
      style: STYLE,
      shotSize: '中景',
      camera: '平视，人物居右，门框在前景',
      scene: '客栈门口内侧，冷白雪光从门缝灌入，与堂内暖黄灯光在地面交界',
      imagePrompt:
        '顾舟满身落雪跨过门槛，右手按在门板上，身体半侧向堂内。柳三娘从柜台后抬头看他，手里的算盘停住。'
        + '门外是横扫的雪与半掩的门板，堂内两名旅人回头，最近那张方桌上摊着没吃完的面',
      refs: REFS,
    }),
  clip: () => clipPrompt(CLIP),
  // 以下两份是 MiniMax H3 端点实际发出的写法，与上面共用同一处「额外要求」。
  clip_h3: () =>
    h3ClipPrompt({
      ...CLIP,
      speech: {
        lines: [
          { speaker: null, text: '雪下到第三天，落马镇来了个外乡人。' },
          { speaker: '顾舟', text: '我找一个人。', how: '压着嗓子，一字一顿' },
        ],
        voices: { 顾舟: '低沉沙哑' },
      },
    }),
  clip_h3_ref: () =>
    h3ClipPrompt({
      ...CLIP,
      summary: '刀客顾舟风雪夜走进客栈，向掌柜柳三娘打听一个人',
      castNames: ['顾舟'],
      opening: {
        style: STYLE,
        shotSize: '中景',
        camera: '平视，人物居右，门框在前景',
        scene: '客栈门口内侧，冷白雪光从门缝灌入，与堂内暖黄灯光在地面交界',
        imagePrompt: '顾舟满身落雪跨过门槛，右手按在门板上，身体半侧向堂内',
        refs: REFS,
      },
      speech: {
        lines: [
          { speaker: '柳三娘', text: '打烊了。', how: '头也不抬，随口一句' },
          { speaker: '顾舟', text: '我找一个人。', how: '压着嗓子，一字一顿' },
        ],
        voices: { 顾舟: '低沉沙哑', 柳三娘: '中年女声，干脆' },
        samples: ['顾舟'],
      },
    }),
}

// 每行标字数，不自动归类：归类规则会随模板过期。
function show(id: string): void {
  const text = SAMPLES[id]!()
  const lines = text.split('\n')
  console.log(`\n${'━'.repeat(76)}\n${id}　共 ${[...text].length} 字 / ${lines.length} 行\n${'━'.repeat(76)}`)
  for (const line of lines) console.log(`${String([...line].length).padStart(4)} │ ${line}`)
}

const only = process.argv[2]
if (only !== undefined && SAMPLES[only] === undefined) {
  console.error(`没有 ${only}。可选：${Object.keys(SAMPLES).join(' ')}`)
  process.exit(2)
}
for (const id of only === undefined ? Object.keys(SAMPLES) : [only]) show(id)
