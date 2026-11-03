import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_FILE_ROLE_LABEL, CAMERA_MOVES, CAMERA_MOVE_LABEL, CLIP_SOURCES, PROMPT_IDS, SHOT_JOINS, SHOT_SIZES, SHOT_SIZE_LABEL, STYLE_GROUPS, episodeCountOf, type AssetFileRole, type AudioMode, type CameraMove, type ClipSource, type PromptId, type PromptParam, type PromptTemplate, type Utterance } from '@vesper/shared'

export const DEFAULT_STYLE = '国风 3D 动画，东方建筑与服饰考究，柔和体积光，水墨化的远景，统一色调，画面干净无文字无水印'

// ——— 模板参数 ———

export { PROMPT_IDS, type PromptId }

/** 传进模板的值一律是字符串，怎么解释由模板自己定（`list` 要分词，`number` 要转数）。 */
export type PromptArgs = Readonly<Record<string, string>>

const NOTE_PARAM: PromptParam = {
  key: 'note',
  kind: 'text',
  label: '其他',
  hint: '额外要求',
}

/** 逗号、顿号、换行都算分隔符：人不会记得该用哪个。 */
function listOf(args: PromptArgs, key: string): string[] {
  return (args[key] ?? '')
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** 单选参数不在候选里（含没填）时取第一项。 */
function selectOf(args: PromptArgs, param: PromptParam): string {
  const options = param.options ?? []
  const value = (args[param.key] ?? '').trim()
  return options.some((o) => o.value === value) ? value : (options[0]?.value ?? '')
}

/** 写明补充优先于前文规则、不改输出格式；图像与视频模板没有输出格式，不带后半句。 */
function noteOf(args: PromptArgs, media = false): string {
  const note = (args.note ?? '').trim()
  if (note === '') return ''
  return media ? `额外要求（和上面的规则冲突时，以这里为准）：\n${note}` : `额外要求（和上面的规则冲突时，以这里为准，输出格式照旧）：\n${note}`
}

// ——— 分集 ———

export const EPISODE_SYSTEM =
  '你是短剧编剧，负责把长篇原文切成若干集。只输出 JSON，不要解释，不要围栏之外的任何文字。'

export interface EpisodePromptInput {
  readonly source: string
  /** 0 表示不限，不给时长参照。 */
  readonly targetSeconds: number
  /** 上一轮末句定位失败的原因，逐条交给模型一次改完。 */
  readonly failure?: readonly string[]
}

const EPISODE_PARAMS: readonly PromptParam[] = [
  { key: 'episode_count', kind: 'number', label: '切成几集', hint: '不填就不切' },
  NOTE_PARAM,
]

export function episodePrompt(input: EpisodePromptInput, args: PromptArgs = {}): string {
  const wanted = episodeCountOf(args.episode_count)
  if (wanted === 0) throw new Error('分集提示词需要集数')
  return [
    '把下面的原文切成若干集短剧。',
    `切成恰好 ${wanted} 集，这是人工指定的。在剧情转折处切开，尽量让每集有头有尾。`,
    input.targetSeconds > 0 ? `成片每集约 ${input.targetSeconds} 秒，这是改编后的长度，和把原文念一遍要多久无关。` : '',
    '',
    '切分要求：',
    '- 每集在情节转折或悬念处收尾，不要切在一句话中间',
    '- 按原文顺序切，不要跳过、重排或改写任何段落',
    '- `ends_with` 必须从原文中**逐字抄写**该集最后一句（含标点，15–40 字），不能改写或省略',
    '- 尤其不要把人名换成代词，也不要合并或删减句中的任何字',
    '',
    '输出 JSON：',
    '{"episodes":[{"title":"本集标题","synopsis":"一句话剧情概要","ends_with":"逐字抄写的本集末句"}]}',
    '',
    retryOf(input.failure ?? []),
    '',
    // 交代放在原文之前，放在几千字原文之后模型容易忽略。
    noteOf(args),
    '',
    '原文：',
    input.source,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function retryOf(failure: readonly string[]): string {
  if (failure.length === 0) return ''
  return ['上一轮的 ends_with 没能在原文里定位，逐条修正后重新输出：', ...failure.map((line) => `- ${line}`)].join('\n')
}

export const SUGGEST_SYSTEM = '你是短剧编剧，只判断一份原文该切成几集。只输出 JSON，不要解释。'

export interface SuggestPromptInput {
  readonly source: string
  /** 0 表示不限。 */
  readonly targetSeconds: number
  /** 原文逐字念完的秒数，给模型一个体量参照。 */
  readonly narratedSeconds: number
}

/** 只问集数。不进 `PROMPT_TEMPLATES`，输出就是人要填的那个数。 */
export function suggestPrompt(input: SuggestPromptInput): string {
  return [
    '判断下面这份原文该切成几集短剧，给出集数和一句话理由。',
    `原文逐字念完约 ${Math.round(input.narratedSeconds / 60)} 分钟。`,
    input.targetSeconds > 0
      ? `成片每集约 ${input.targetSeconds} 秒，但改编会大幅压缩，别拿念白时长直接除。`
      : '未设单集目标时长，按剧情段落判断。',
    '',
    '判断依据：',
    '- 数原文里有几个完整的剧情起落，每个起落一集',
    '- 一集要有自己的开场、推进与收束，切得太碎会让每集只剩半件事',
    '- 只有一个起落就回 1，说明这份原文本来就是一集，不必切',
    '',
    '输出 JSON：',
    '{"count":3,"reason":"三段：夺城、追击、塔内对峙，各自收束"}',
    '',
    '原文：',
    input.source,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export const STYLE_SYSTEM = '你是短剧美术指导，只从给定的画风清单里挑，不自己造词。只输出 JSON，不要解释。'

/** 只从预设里挑：自由写的画风词逐字进设定图，「浅景深」这类词会把背景虚掉。不进 `PROMPT_TEMPLATES`。 */
export function stylePrompt(source: string): string {
  return [
    '从下面的画风清单里挑 2–3 条最配这个故事的，给出名称和一句话理由。',
    '',
    '清单（只能从这里面挑，名称逐字抄写）：',
    // 给 `fits` 而不给 `prompt`：画风词描述的是笔触光影，模型据此判断不了是否合题材。
    ...STYLE_GROUPS.flatMap((group) => [
      `${group.group}`,
      ...group.presets.map((preset) => `- ${preset.label}：适合${preset.fits}`),
    ]),
    '',
    '挑选依据：',
    '- 题材与年代先对上：古装不配赛博朋克，现代都市不配工笔重彩',
    '- 再看情绪与节奏：同一个题材里，悬疑压暗、日常给亮、打斗给强对比',
    '- 挑出来的几条要各走一个方向，别都在同一组里',
    '- 理由里说清是原文哪一处让你这么挑的，不要写「画面精美」这种放哪儿都成立的话',
    '',
    '输出 JSON：',
    '{"picks":[{"label":"古装正剧","reason":"关外客栈、雪夜寻人，写实质感比动画更压得住"}]}',
    '',
    '原文开头：',
    source,
  ].join('\n')
}

// ——— 资产提取 ———

/** 看它能不能单独画成一张设定图，不看有没有名字。 */
export const ASSETS_SYSTEM =
  '你是美术指导，从原文中挑出需要固定形象、会在多个镜头里反复出现的人物、场景与道具。只输出 JSON，不要解释。'

/** 提取的三类，value 与 assets 表的 category 一致。 */
const ASSET_CATEGORY_OPTIONS = ASSET_CATEGORIES.map((value) => ({ value, label: ASSET_CATEGORY_LABEL[value] }))

const ASSETS_PARAMS: readonly PromptParam[] = [
  {
    key: 'categories',
    kind: 'choice',
    label: '提取哪几类',
    hint: '不选就三类都要，只新增不删',
    options: ASSET_CATEGORY_OPTIONS,
  },
  { key: 'must_include', kind: 'list', label: '包含', hint: '林小雨、沈砚' },
  { key: 'exclude', kind: 'list', label: '排除', hint: '说书人、路人甲' },
  NOTE_PARAM,
]

export function assetsPrompt(source: string, onScreen: readonly string[] = [], args: PromptArgs = {}, known: readonly string[] = []): string {
  const picked = listOf(args, 'categories')
  const want = (category: string) => picked.length === 0 || picked.includes(category)
  const wantedNames = ASSET_CATEGORY_OPTIONS.filter((item) => want(item.value)).map((item) => item.label)

  const mustInclude = listOf(args, 'must_include')
  const exclude = listOf(args, 'exclude')
  const manual = [
    mustInclude.length > 0 ? `- 一定要提取：${mustInclude.join('、')}。出现次数再少也要提取，放进它所属的那一类` : '',
    exclude.length > 0 ? `- 不要提取：${exclude.join('、')}。出现次数再多也不提取，三类里都不要出现` : '',
  ].filter((line) => line !== '')

  // 没选的类别整段不出现，留着规则模型仍会填几个回来。
  const forCategory = (category: string, lines: readonly string[]) => (want(category) ? lines.join('\n') : '')

  return [
    `从下面的原文中挑出**需要固定形象**的${wantedNames.join('、')}。`,
    '',
    '怎么判断要不要提取：这个名字指的是一个固定的具体对象，**会真的出现在画面里**，能画成一张设定图，在后面的镜头里反复使用。',
    '要不要提取，看它在剧情里起不起作用，不看出现几次：戏份少但推动剧情的要提取，出现多但与剧情无关的不用提取。',
    '每多一样，后续每一镜就多一张要管的参考图，也多一笔生成费用，不要凑数。',
    '',
    forCategory('character', [
      '## 人物（characters）',
      '- 要提取：主角，以及画面里要认出脸的配角；推动剧情、反复出场的怪兽、机甲、灵兽这类非人形角色也算',
      '- 不用提取：无名路人、群像（「围观群众」「学生们」）、泛指（「敌人」「守卫」）、只当背景的载具',
      '- tier：lead 为主角与核心对手，support 为其余要认出脸的',
      '- 提取几个由剧情定。没提取的人物照样可以说台词，只是长相不会前后统一',
      onScreen.length > 0
        ? [
            `已定稿的改编剧本里，这些名字会开口说话：${onScreen.join('、')}。`,
            '其中指具体某个人的**都要提取**，哪怕原文里只出现一两次，因为他们会真的出现在画面上。',
            '泛指与群像（如「某某队员」「众人」）仍然不用提取。',
          ].join('\n')
        : '',
      '',
    ]),
    forCategory('scene', [
      '## 场景（scenes）',
      '- 要提取：剧情会反复回到、观众需要认出「又回到了这个地方」的固定空间',
      '- 不用提取：只路过一次的地方、泛指的环境（「走廊」「街上」）、纯天空纯海面这类无结构的背景',
      '- **一个场景只装一个镜头拍得下的连续空间**。通道、厅堂、台阶、殿内要分成四个场景；',
      '  合成一个「金字塔内部」来写，画出来会是上下两半拼起来的图',
      '- 提取几处由剧情定。没提取的地方照样能拍，按那一镜的环境描述现画',
      '',
    ]),
    forCategory('prop', [
      '## 道具（props）',
      '- 要提取：推动剧情、并且在多个镜头里出现的关键物件，比如主角的武器、贯穿全篇的信物、关键装置',
      '- 不用提取：一次性的消耗品、背景陈设、泛指的器物（「枪」「杯子」）',
      '- 提取几件由剧情定，拿不准就不提取',
      '',
    ]),
    manual.length > 0 ? ['## 人工指定（和上面的规则冲突时，以这里为准）', ...manual, ''].join('\n') : '',
    // 入库按名字去重，换了叫法就会重复入库，所以要求沿用已有名字。
    known.length > 0 ? ['## 已经提取过的（换个叫法也算同一个，不要再输出）', known.join('、'), ''].join('\n') : '',
    '## 字段',
    '外观类的描述都要过图像模型的内容审核：血迹、伤口、尸骸、利器刺入人体这类字眼会让这张设定图直接被拒。'
      + '同样的东西改用形制、材质、颜色、磨损、光泽来写。',
    forCategory('character', [
      '人物：',
      '- name：正式称呼，取原文中最常用的那个；aliases：原文中出现过的其他称呼',
      '- tier：lead 或 support',
      '- form：human 为人形，creature 为怪兽、机甲这类非人形',
      '- identity：身份与人物关系，一两句',
      '- traits：**外貌辨识特征**，只写画得出来的东西（年龄段、发型发色、眼睛、体型、显著特征）。不要写性格',
      // 非人形只写体型与甲壳时，头部画得很小、看不清眼睛。
      '- 非人形的 traits 写清体态（几足、站姿、尺度）和脸：眼睛、口部与头部轮廓，outfit 留空',
      '- 性别、年龄这类原文写明的，照原文写，traits 和 voice 都不能跟它矛盾；原文没写的才自己补',
      // 同一件东西在角色与道具两处各写一遍，两条描述会各画各的。
      '- outfit：默认着装，写清款式与颜色。只写穿戴在身上的衣物与配饰，',
      '  手里拿的武器和随身物件不写，它们归到道具里；两处各写一遍，会画成两件不同的东西',
      '- outfit 只写一身：剧中换了一身明显不同的衣服（便服换官服、常服换嫁衣），出场最多的那身写进 outfit，',
      '  其余每身写进 costumes：name 是这身装扮的叫法（「官服」），outfit 照上面的写法。只是加件外衣、摘了帽子不算换装',
      '- voice：音色描述，如「少年音，清亮，语速偏快」',
      '- appearances：在原文中出现的大致次数',
      '',
    ]),
    forCategory('scene', [
      '场景：',
      '- name：这个地方的称呼；aliases：其他叫法',
      '- description：空间本身——结构、材质、陈设、尺度。只写画得出来的，',
      '  且只写**这一处**：出现「…与…交替」「深处还有…」就说明该拆成两个场景',
      '- lighting：默认的光线与时段，如「冷白顶光，全息投影的蓝光，无自然光」',
      '- appearances：在原文中出现的大致次数',
      '',
    ]),
    forCategory('prop', [
      '道具：',
      '- name：按物件看上去是什么来叫；只在剧情里才有的叫法写进 aliases',
      '- description：外观——形制、材质、颜色、尺寸感、显著细节',
      '- holder：归谁所有或谁在用；没有明确归属就留空',
      '- appearances：在原文中出现的大致次数',
      '',
    ]),
    picked.length > 0 && picked.length < ASSET_CATEGORY_OPTIONS.length
      ? `这次只提取${wantedNames.join('、')}，其余类别给空数组，哪怕原文里确实有。`
      : '',
    '输出 JSON（某一类没有就给空数组）：',
    '{"characters":[{"name":"","aliases":[],"tier":"lead","form":"human","identity":"","traits":"","outfit":"","costumes":[],"voice":"","appearances":0}],' +
      '"scenes":[{"name":"","aliases":[],"description":"","lighting":"","appearances":0}],' +
      '"props":[{"name":"","aliases":[],"description":"","holder":"","appearances":0}]}',
    '',
    noteOf(args),
    '',
    '原文：',
    source,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// ——— 叙事节拍 ———

export const BEATS_SYSTEM =
  '你是短剧编剧，把小说章节改编成短剧的叙事节拍。改编短剧本来就要删减原文。只输出 JSON，不要解释。'

export interface BeatsPromptInput {
  readonly title: string
  readonly synopsis: string
  readonly source: string
  /** 0 表示不限，此时节拍数完全由剧情决定。 */
  readonly targetSeconds: number
  readonly cast: readonly { name: string; identity: string }[]
}

/** 两种讲法各有标准；旁白占比没有经验值，写成比例只会让模型凑数。 */
const BEATS_MODE_PARAM: PromptParam = {
  key: 'mode',
  kind: 'select',
  label: '讲法',
  options: [
    { value: 'drama', label: '剧情' },
    { value: 'narrated', label: '解说' },
  ],
}

const BEATS_PARAMS: readonly PromptParam[] = [
  BEATS_MODE_PARAM,
  { key: 'must_keep', kind: 'list', label: '要演' },
  { key: 'drop', kind: 'list', label: '不要' },
  NOTE_PARAM,
]

export function beatsPrompt(input: BeatsPromptInput, args: PromptArgs = {}): string {
  const mustKeep = listOf(args, 'must_keep')
  const drop = listOf(args, 'drop')
  const manual = [
    mustKeep.length > 0 ? `- 一定要展开成 scene 演出来：${mustKeep.join('、')}。不要缩成 narration，也不要删` : '',
    drop.length > 0 ? `- 直接删掉的：${drop.join('、')}。不要出现在任何节拍里，旁白里也不要提` : '',
  ].filter((line) => line !== '')
  const narrated = selectOf(args, BEATS_MODE_PARAM) === 'narrated'

  return [
    `把下面的原文改编成一集短剧的叙事节拍，本集标题《${input.title}》。`,
    input.synopsis ? `本集要讲的是：${input.synopsis}` : '',
    input.targetSeconds > 0 ? `成片目标约 ${input.targetSeconds} 秒，按这个长度取舍详略；看得懂比压到这个长度要紧。` : '',
    '',
    '每个节拍二选一：',
    '- scene：展开演。有具体的人或物在具体的地方做具体的事；有人开口才配台词，画面自己说得清的动作与场面可以一句台词也没有',
    '- narration：一句旁白带过。只有旁白，没有角色台词；只用在画面交代不了的地方',
    '',
    '改编范围（这几条要严格遵守）：',
    '- 只改编下面给出的这一段原文。不要续写它之后的剧情，也不要把别处的情节挪进来',
    '- 原文没交代的事实（年份、人物关系、谁做过什么）一律不要自己补。宁可少一个节拍，也不要编',
    '',
    '看得懂（最要紧）：',
    '- 观众只看这一集，没读过原文。节拍连起来读，要能说出谁、想要什么、为什么这么做、结果怎样',
    '- 原文里交代身份、世界规则、前因的台词优先留；只表态度、抒情绪的台词可以压',
    '- 剧情离不开的设定和心理活动，转成角色说出口的台词，尽量用原文的话；只渲染气氛的才删',
    '- 插叙、倒叙、括号里的补叙也是剧情，不当附注略过；交代真相或改变前文理解的，照样写成节拍',
    '',
    // 不写节拍数区间或 scene 与 narration 的配比，模型会当指标凑数。
    narrated ? '本集的讲法是解说：' : '本集的讲法是剧情：',
    narrated
      ? '- 旁白是主线，把剧情讲清楚；scene 只留爆点与情绪顶点\n- 角色对白短，一句顶一句，不铺长对话'
      : '- 冲突、对峙、反转、抉择一律展开成 scene，靠对白与表演推进\n- 旁白只补画面交代不了的：时间跳转、前情。地点、来者、动作看得出来就不用旁白说，也不替角色说他们该说的话',
    '- 节拍数由剧情定：一拍讲一件事，讲完就收。时长不够就少几拍，别编内容去填',
    '- 最后一个节拍收在本集最有张力的地方',
    '',
    '哪些展开成 scene：',
    '- 正面冲突、对峙、反转揭晓的那一刻',
    '- 主角做出选择、说出关键台词的那一刻',
    '',
    '哪些压成 narration：',
    '- 赶路、过场、重复回合（三次同类战斗合成一句「她一路杀了过去」）',
    '',
    '哪些整段删掉：',
    '- 与剧情无关的心理活动、内心独白，这些拍不出来',
    '- 与本集主线无关的支线',
    '- 围观议论、弹幕、点评类段落：最多留一条最有信息量的，其余全删',
    '',
    manual.length > 0 ? ['人工指定（和上面的详略规则冲突时，以这里为准）：', ...manual].join('\n') : '',
    '',
    '台词要求：',
    '- 口语，一句一口气能念完；不要书面语长句',
    '- text 里只写要念出来的字，不要写「某某说道」「他冷冷地说」这类叙述',
    // 只写「旁白填 null」时，模型会把主角台词也标成 null，音色就挑错了。
    '- speaker 填说话人的名字。只有旁白（第三人称的画外解说）才填 null',
    '- speaker 只填一个人：几个人齐声说的，填领头的那一个；衙役、百姓这类没有名字的群演照原样写',
    '- 原文只有动作描写、但改编时要让角色开口的场合，照样把台词归到那个角色名下，不要算成旁白',
    '- 整拍只剩旁白就说明它其实是 narration；没人开口的动作段写成不带台词的 scene，不要为它配旁白',
    input.cast.length > 0
      ? `- 下列人物有设定图，名字要写对：${input.cast.map((c) => c.name).join('、')}。其他人物也可以说话，直接写名字即可`
      : '',
    '',
    '原文定位：',
    '- 每个节拍给出 ends_with：从原文中**逐字抄写**这一拍所改编内容的最后一句（含标点，10–40 字），不能改写或省略',
    '- 按原文顺序定位；被整段删掉的内容归进它前面那一拍的区间，不单独定位',
    '',
    '输出 JSON：',
    '{"beats":[{"mode":"scene","summary":"这个节拍发生了什么，一句话","ends_with":"逐字抄写的本拍末句","utterances":[{"speaker":"角色名或null","text":"要念的台词"}]}]}',
    '',
    noteOf(args),
    '',
    '原文：',
    input.source,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// ——— 分镜 ———

export const SHOTS_SYSTEM =
  '你是导演兼分镜师，把已经定稿的叙事节拍拆成镜头表。台词已定稿，你定每一镜怎么拍：景别、运镜、情绪、与上一镜怎么接，'
  + '并分配台词。每镜的画面提示词由后一步逐镜单独写，这一步不要写。只输出 JSON，不要解释。'

export interface ShotsPromptInput {
  /** 已确认的节拍，台词只给下标供引用。source 是这一拍的原文段，定位失败给空串。 */
  readonly beats: readonly {
    mode: string
    summary: string
    source: string
    utterances: readonly { speaker: string | null; text: string }[]
  }[]
  /** 可出镜的已锁定人物，以及各自锁定版里有的设定图，模型只能从中挑。 */
  /** outfit 只在这个人有不止一身装扮时给，其余给空串。 */
  readonly cast: readonly { name: string; identity: string; looks: readonly AssetFileRole[]; outfit: string }[]
  /** 已锁定的场景与道具，没有时相应段落整段省略。 */
  readonly sceneNames: readonly string[]
  readonly propNames: readonly string[]
  readonly minSeconds: number
  readonly maxSeconds: number
  /** 整集合成版的目标时长，0 表示不限，只作参考。 */
  readonly targetSeconds: number
  /** 前几拍已拆出的秒数，逐拍调用时模型靠它掌握余量。 */
  readonly spentSeconds: number
  /** 视频自带声音时视频模型能演对话，一镜不必只有一个说话人。 */
  readonly audioMode: AudioMode
  /** 本次只拆哪一拍，其余节拍只给概要。 */
  readonly focus: number
  /** 上一拍拆出的最后一镜，景别、机位、场景要和它接上。本集第一拍给 null。 */
  readonly previous: { readonly summary: string; readonly shotSize: string; readonly camera: string; readonly scene: string } | null
}

/** 一次只拆一拍：整集一起拆时回复过长，一处格式错整集作废。 */
export function shotsPrompt(input: ShotsPromptInput, args: PromptArgs = {}): string {
  const focus = input.beats[input.focus]
  if (focus === undefined) throw new Error(`没有节拍 ${input.focus}`)
  const outline = input.beats.map((beat, i) => `${i === input.focus ? '→' : ' '} [节拍 ${i}] ${beat.mode === 'scene' ? '展开演' : '旁白带过'}：${beat.summary}`)
  const hasSource = focus.source.trim() !== ''
  const previous = input.previous
  return [
    `把节拍 ${input.focus} 拆成镜头，每镜 ${input.minSeconds}–${input.maxSeconds} 秒。只拆这一拍，其余节拍只是让你知道前后发生了什么。`,
    '',
    '拆镜规则：',
    // 限死总时长会压掉模型对详略的判断，所以只给参考、只拦拆得过碎。
    input.targetSeconds > 0
      ? `- 整集成片目标约 ${input.targetSeconds} 秒、共 ${input.beats.length} 拍，这只是参考，剧情需要时可以超。`
        + '排出来明显偏长的话，多半是镜头拆得太碎：把画面上没有新动作的镜头合并掉，别靠缩短每镜时长来凑'
      : '',
    input.targetSeconds > 0 && input.focus > 0
      ? `- 前 ${input.focus} 拍已排约 ${Math.round(input.spentSeconds)} 秒，这一拍连同后面 ${input.beats.length - input.focus - 1} 拍还剩约 ${Math.max(Math.round(input.targetSeconds - input.spentSeconds), 0)} 秒，按剩下的拍数掂量这一拍拆几镜`
      : '',
    '- **一镜拍一个完整的动作，或一段完整的表演**。拆几镜由画面里有几个动作决定，不由有几句台词决定',
    hasSource ? '- 节拍下面附的「原文」是这一拍改编自的段落：有几个动作、环境和神态长什么样，以它为准' : '',
    '- 一个节拍里只发生一件事，就只给一镜，哪怕它有好几句台词',
    // 只有单独配音要求一镜一人，配音按镜定音色。
    input.audioMode === 'native'
      ? '- **一镜可以有多个说话人**。一来一回的短对话，只要发生在同一个空间、同一个连续动作里，'
        + '就放进同一镜，别拆成正反打，每多一镜就要多生成一次视频'
      : '- **一镜只能有一个说话人**。两个人来回对话，就拆成两镜正反打',
    '- 旁白、画外音、以及「一边做事一边说」的闲话，说话的人**不必出现在画面里**，'
      + '可以拍他手上的动作、对方的反应或环境，不要整集都是人对着镜头说话',
    '- **推动剧情的动作要拍到做这件事的人**：谁放下筷子、谁拔刀，观众得认得出是他。'
      + '只拍手或物件时，前后镜要让人看出这是谁的手',
    '- **交代剧情的关键台词，画面里要有说话人或听话人的脸**。说话人在机位另一侧，就拆一镜给他，或让运镜落到他身上',
    '- 推镜、拉镜要写明从什么景别到什么景别；要看清表情的动作（回头、变脸）不给全景',
    '- 不要为了凑满时长而编造动作；也不要把时长平均分配',
    '',
    // 不给标准时每镜都是中景加轻微推进；写成「每 N 镜一个特写」又会被当指标。
    '镜头语言：',
    '- **景别跟着这一镜要给的信息走**：交代地点与局势用远景，演动作与人物关系用中景，'
      + '给情绪、决断、关键物件用近景或特写',
    '- **只在注意力转移、压力加大或要揭开什么的时候换景别**，别为了每拍都有变化而换；也别一到情绪升级就条件反射地推近',
    '- **相邻两镜景别、角度、人物关系都一样，这次切镜就等于白切**：换个景别，或者合回一镜',
    '- **特写不只是拍脸**：手上的动作、眼睛、刀刃、对方的反应，常常比正脸信息更多',
    '- **默认镜头不动。** 运镜要有理由，比如跟着移动的人、从局部揭开全局、逼近制造压迫。'
      + '没有理由就固定机位，让人物在画框里动。一镜只做一个运动，不要又推又摇',
    '- **情绪最强的地方反而要静**：对峙、下决心、说出关键那一句时，镜头停住；'
      + '运动留给赶路、打斗和转场',
    '- **情绪写成弧线**：「从戒备转为动摇」比「紧张」有用：一镜之内有变化，画面才有戏',
    '- **画框里不能只有人**：前景放点东西（门框、桌沿、别人的肩背），背景交代这是哪儿。'
      + '人物占满画框只在极近特写里成立，连着几镜都这么拍，观众就不知道故事发生在什么地方',
    '- **人物占画框的比例跟着景别走**：近景与特写才允许人物占大半画框，中景以上要给环境留出位置。'
      + '对话戏别连着几镜都是人物占满画面的正反打，中间穿插环境、手上的动作、旁观者的反应，这场对话才不会只剩一张张脸',
    '',
    '台词分配：',
    '- 台词已经定稿，你不能改写、增删或合并。只能用 `utterance_indexes` 引用节拍内的台词下标',
    hasSource ? '- 原文里的对白是改编前的素材，不算台词：要念的只有节拍下编号的那些，不要从原文里另加' : '',
    '- 同一节拍内的每条台词必须被引用**恰好一次**，不能漏、不能重复引用',
    input.audioMode === 'native'
      ? '- **连续几句可以引用到同一镜**：同一个人连说几句，或两个人一来一回，'
        + '只要讲的是同一件事、画面上也是同一个连续动作'
      : '- **同一个说话人的连续几句可以引用到同一镜**：只要这几句讲的是同一件事、画面上也是同一个动作',
    '- 这一镜没有声音就给空数组',
    '',
    '有设定图的资产怎么引用：',
    input.cast.length > 0
      ? [
          `- 可出镜的有设定图的人物：${input.cast.map((c) => c.name).join('、')}。cast 里只能填这些名字，写别的名字会被拒绝。没有设定图的人物出镜时 cast 留空，少给近景特写：没有参考图，每一镜画出来的脸都会不一样`,
          '- 每个出镜人物挑一张设定图当这一镜的参考图（look）：特写与对话挑半身特写，全身动作挑全身，'
            + '背面或侧面挑三视图，要看清衣着细节挑服装细节。各人只能从下面列出的里挑：',
          ...input.cast.map((c) => {
            const about = [c.identity, c.outfit === '' ? '' : `着装：${c.outfit}`].filter((s) => s !== '').join('；')
            return `  ${about === '' ? c.name : `${c.name}（${about}）`}：${c.looks.map((l) => `${l}（${ASSET_FILE_ROLE_LABEL[l]}）`).join('、')}`
          }),
          input.cast.some((c) => c.outfit !== '')
            ? '- 名字带「·」的是同一人物的另一身装扮：按这一场穿的那身填 cast，同一人物一镜只填一身'
            : '',
        ].join('\n')
      : '- cast 一律给空数组',
    input.sceneNames.length > 0
      ? [
          `- 有设定图的场景：${input.sceneNames.join('、')}。这一镜确实发生在其中某处就把名字填进 scene_ref，否则留空串`,
          '- **连续几镜在同一处，就逐镜都填**，不要只在头一镜填：留空的那几镜背景由模型自己编，'
            + '相邻两镜的同一个地方会长得不一样',
          '- 只有完全看不出所在地的极近特写与插入镜头才留空串',
        ].join('\n')
      : '- scene_ref 一律给空串',
    input.propNames.length > 0
      ? `- 有设定图的道具：${input.propNames.join('、')}。只有该物件**真的出现在这一镜画面里**时才填进 props，提到但没拍到不算`
      : '- props 一律给空数组',
    input.cast.length > 0 || input.propNames.length > 0
      ? '- 屏幕上、倒影里、画像里拍得到的有设定图的人物或道具，也照样填进 cast 或 props：不填就没有参考图，模型只能按名字猜它长什么样'
      : '',
    '',
    '每镜给出：',
    '- summary：这一镜讲什么，一句话',
    '- scene：这一镜**镜头里看得见的那部分环境**与光线，画得出来的描述。'
      + '填了 scene_ref 就不用再抄一遍场景设定里的整体结构，但要写清这一镜取到了其中哪一角、什么光',
    `- shot_size：景别，${SHOT_SIZES.map((s) => `${s}（${SHOT_SIZE_LABEL[s]}）`).join(' / ')} 之一`,
    '- camera：**机位 + 构图**，如「平视，人物居左，门框在前景」「略低机位，过肩」。'
      + '构图写主体在画框里的位置与前后景关系。**只写静止画面里看得出来的东西**，景别在 shot_size 里，运镜在 camera_move 里',
    `- camera_move：运镜，${CAMERA_MOVES.map((m) => `${m}（${CAMERA_MOVE_LABEL[m]}）`).join(' / ')} 之一。一镜只做一个运动，没理由就 static`,
    '- mood：这一镜的情绪弧线，一句话，写成「从 A 转为 B」；没有变化就写这一镜的情绪基调',
    // 接不接由这一镜自己说明：空镜接上一镜带人的末帧，模型多半把人画回来。
    `- join：与上一镜怎么接，${SHOT_JOINS.join(' / ')} 之一。`
      + 'continue = 紧接着上一镜发生，上一镜末帧会当这一镜的参考图，只在同一个场景、机位相近、起终状态相接时用；'
      + 'cut = 各自成镜，硬切，换场景、换机位、空镜与建立镜都用它；'
      + 'fade = 过黑场，只用在幕与集的边界。'
      + (previous === null ? '这是本集第一镜，填 cut' : '第一镜按它和上一拍最后一镜的关系填'),
    `- clip_source：视频的画面从哪来，${CLIP_SOURCES.join(' / ')} 之一，按这一镜要什么来挑，不偏向哪一种。`
      + 'first_frame = 先出一张首帧定死开场构图，视频从它往下演：适合站位、空间关系、场景与道具细节要准的镜；'
      + 'reference = 人物、场景的设定图直接给视频模型，开场构图由它自己定：适合动作与运镜为主的镜、人物中途入画的镜、'
      + '有台词要用角色试音的镜。first_frame 模式下视频模型只认首帧里的人，也带不上试音',
    '- scene 与 camera 要过图像模型的内容审核：血迹、伤口、利器刺入人体'
      + '这类字眼会让整镜被拒，同样的冲突改用动作、反应与光影来写',
    '- utterance_indexes：本镜要念的台词在该节拍内的下标数组',
    // 只给区间时模型贴着下限写；档位用语义描述，上限是作品参数。
    `- seconds：本镜时长，数字。按这一镜的动作与台词要多久定：一个简短动作 ${input.minSeconds} 秒就够；`
      + `对白偏长或表演需要停留时加一两秒；`
      + `只有画面里有连续动作、或运镜确实需要这么长时，才用到接近 ${input.maxSeconds} 秒`,
    '- 有台词的镜头要留够念完的时间。但**不要为了填满时长而人为增加动作**',
    '- cast：本镜出场的有设定图的人物，每项 {"name","look"}，没有就给空数组',
    '- scene_ref：本镜所在的有设定图的场景名，单个字符串；不适用就给空串',
    '- props：本镜画面里出现的有设定图的道具名字数组，没有就给空数组',
    '',
    '输出 JSON：',
    '{"shots":[{"summary":"","scene":"","shot_size":"medium","camera":"","camera_move":"static",' +
      '"mood":"","join":"cut","clip_source":"first_frame","utterance_indexes":[0],"seconds":4,"cast":[{"name":"","look":"full_body"}],"scene_ref":"","props":[]}]}',
    '',
    noteOf(args),
    '',
    '本集节拍（→ 是这次要拆的）：',
    ...outline,
    '',
    `要拆的节拍 ${input.focus}：${focus.mode === 'scene' ? '展开演' : '旁白带过'}：${focus.summary}`,
    ...focus.utterances.map((line, j) => `  (${j}) ${line.speaker ?? '旁白'}：${line.text}`),
    ...(hasSource ? [`  原文：${focus.source.trim()}`] : []),
    previous === null
      ? ''
      : `上一拍最后一镜（这一拍的第一镜要和它接得上，景别与机位别重复）：${previous.summary}；${[previous.shotSize, previous.camera].filter((s) => s !== '').join('，')}${previous.scene === '' ? '' : `；在${previous.scene}`}`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// ——— 逐镜提示词精写 ———

export const SHOT_PROMPT_SYSTEM =
  '你是分镜画师兼提示词作者，为一个镜头写给图像与视频生成模型直接使用的正文。只输出 JSON，不要解释。'

export interface ShotPromptInput {
  readonly episode: { readonly title: string; readonly synopsis: string }
  /** 手工插入的镜头没有节拍，给空串。 */
  readonly beatSummary: string
  /** 这一拍对应的原文段，神态、环境、动作细节都从这里取。定位失败给空串。 */
  readonly sourceText: string
  /** 上一镜的动作末态（它的 motion_prompt），这一镜要接得上。精写按镜序跑，轮到本镜时它已写回。 */
  readonly previous: { readonly summary: string; readonly camera: string; readonly ending: string } | null
  readonly next: { readonly summary: string; readonly camera: string } | null
  readonly shot: {
    readonly summary: string
    readonly scene: string
    /** 景别中文名，与 camera 拼成一句取景。 */
    readonly shotSize: string
    readonly camera: string
    readonly cameraMove: CameraMove
    readonly mood: string
    readonly seconds: number
    /** reference 模式没有首帧图，image_prompt 就是视频模型拿到的唯一取景描述。 */
    readonly clipSource: ClipSource
  }
  readonly utterances: readonly Utterance[]
  /** traits 只用来让动作合乎体型，非人形角色只给名字时会被写成人的手势。 */
  readonly cast: readonly { readonly name: string; readonly identity: string; readonly traits: string }[]
  /** 场景设定的文字描述；没挂场景给空串。 */
  readonly sceneAnchor: string
  readonly props: readonly { readonly name: string; readonly description: string }[]
}

function castLine(c: ShotPromptInput['cast'][number]): string {
  const about = [c.identity, c.traits].filter((s) => s.trim() !== '').join('；')
  return about === '' ? c.name : `${c.name}（${about}）`
}

export function shotPromptDraft(input: ShotPromptInput, args: PromptArgs = {}): string {
  const { shot } = input
  const line = (label: string, value: string) => (value.trim() === '' ? '' : `- ${label}：${value}`)
  const speech = input.utterances.filter((u) => u.text.trim() !== '')
  // 参考图模式没有首帧，按「开场」写，image_prompt 才是动作开始前的那一刻。
  const opening = shot.clipSource === 'reference' ? '开场' : '首帧'
  return [
    `为下面这一镜写成品提示词：image_prompt 是${shot.clipSource === 'reference' ? '开场那一刻的' : '首帧'}静止画面，motion_prompt 是这一镜从${opening}起的运动过程，sound 是这一镜听得到的声音。`,
    '这几段都会一字不改地发给生成模型，要写成完整的描述，别写成概要。',
    '',
    '这一镜（已定稿，不能改）：',
    line('本集', `《${input.episode.title}》，${input.episode.synopsis}`),
    line('所属节拍', input.beatSummary),
    line('这一镜讲', shot.summary),
    line('景别构图', `${[shot.shotSize, shot.camera].filter((s) => s.trim() !== '').join('，')}；image_prompt 按这个取景写，不要换景别`),
    line('运镜', `${CAMERA_MOVE_LABEL[shot.cameraMove]}；motion_prompt 的镜头运动只做这一个`),
    line('情绪', `${shot.mood}；写成画得出来的变化，不写形容词`),
    line('环境', shot.scene),
    line('场景设定', input.sceneAnchor),
    `- 时长：${shot.seconds} 秒`,
    input.previous ? line('上一镜', `${input.previous.summary}（${input.previous.camera}）`) : '- 这是本集第一镜',
    input.previous ? line('上一镜收在', `${input.previous.ending}；这一镜的${opening}姿态与站位要接得上它`) : '',
    input.next ? line('下一镜', `${input.next.summary}（${input.next.camera}）`) : '',
    '',
    input.cast.length > 0
      ? `出场人物：${input.cast.map(castLine).join('；')}。`
        + '都有设定图做参考：直接写名字，不要再描述长相、发型与服装；动作要合乎各自的体型与形态，非人形的不要写成人的手势与坐姿'
      : '',
    input.props.length > 0 ? `画面里的道具：${input.props.map((p) => `${p.name}（${p.description}）`).join('；')}` : '',
    speech.length > 0
      ? `这一镜有台词：${speech.map((u) => `${u.speaker ?? '旁白'}说「${u.text}」`).join('；')}。`
        + '台词原文由系统另行拼接，image_prompt、motion_prompt、sound 里都不要抄'
      : '',
    '',
    'image_prompt 怎么写：',
    '- 按「谁 + 在做什么 + 对着谁或什么 + 位置关系 + 表情与身体反应 + 前景与背景」组织成连贯的一段',
    '- 主体优先：人物与动作写清楚，环境只作陪衬，写身边一两件东西、背景一句远景就够。原文里现成的环境与神态细节优先用',
    '- 人物占画框的比例按景别来：近景特写才占大半画框，中景以上要给环境留出位置',
    '- 情绪写成画得出来的：瞳孔、肩线、脚步，不写「他很害怕」',
    '- 这一镜推动剧情的动作是谁做的，画面里要认得出他：至少露出身形或侧脸，不要只剩一只手或一件物件',
    '- 体量远大于人的主体，尺度靠画面里大小已知的东西对比出来：写清它到楼层、车辆或人影的哪个位置；让它的局部撑出画框，比把全身缩进画框更显大',
    speech.some((u) => (u.speaker ?? '') !== '') ? '- 这一镜的台词要认得出是谁说的、对谁说的：说话人或听话人至少一方露脸，不要只拍背影' : '',
    input.shot.clipSource === 'reference'
      ? '- 这一镜没有首帧图，视频模型只按这段取景：写明机位站在哪、朝着哪、前景是什么、主体在画框什么位置；写的是动作开始前的那一刻，不写动作进行到一半的瞬间'
      : '',
    input.shot.clipSource === 'first_frame' && input.cast.length > 0
      ? '- 出场人物都要在首帧里认得出来，至少露出身形或侧脸：视频模型只认首帧里的人，首帧里没有的人到视频里会换一副长相'
      : '',
    '- 反例（过短）：「她站在门口发呆。」这句没有环境、没有前后景，模型只能把人怼到镜头前',
    '',
    'motion_prompt 怎么写：',
    '- 第一句先说清主体与局面：谁、正对着谁或什么、在做什么，然后才是动作',
    `- ${shot.seconds} 秒里的过程：从${opening}的姿态起，动作怎么起、怎么进行、收在哪个姿态或反应上`,
    '- 一段连贯的过程，中间不留空档：前一个动作收在哪，下一个就从哪起，不要列成几个各自独立的片段',
    '- 镜头运动按上面定好的运镜写，写清跟着什么动；固定就写「镜头固定」。一镜只做一个运动，不要又推又摇',
    '- 「缓缓」「轻微」「慢慢」这类幅度词只留给真正要控制幅度的那个动作，不要每句都挂',
    // 站着念台词是视频模型最常见的问题；怎么说归 lines，这里只管身体。
    speech.some((u) => (u.speaker ?? '') !== '')
      ? '- 开口的人边说边做事：写清说话时手上、身上在做什么，说话与动作同时进行'
      : '',
    '- 人物位置写成画面方位：谁在画面左、谁在右，谁从哪一侧入画、停在哪里',
    '- 这一镜容易被演错的地方写成画面事实：动作做到哪一步为止、物件始终在哪（「外衣只套上一半」「茶杯始终在桌上」）',
    '',
    'sound 怎么写：',
    '- 这一镜听得到什么，按主次写成一两句：哪个声音最响、哪些垫在底下',
    '- 要靠某个声音交代剧情的，写清什么声音、从哪里传来、什么时候响起或断掉',
    speech.length > 0 ? '- 台词经对讲机这类设备传出的，写上设备本身的声音' : '',
    '- 不写音乐，不写台词',
    '',
    speech.length > 0 ? 'lines 怎么写：' : '',
    speech.length > 0 ? '- 按上面台词的顺序每句一条 how：音量、语速、嗓音的质地（压低、发颤、拖长、一字一顿、喊出来），当面说还是经设备传出' : '',
    speech.length > 0 ? '- 写听得出来的声音，不写情绪形容词；合乎说话人的身份与此刻的处境' : '',
    '',
    '两段都要过图像与视频模型的内容审核：血迹、伤口、利器刺入人体这类字眼会让整镜被拒，改用动作、反应与光影写。',
    '画风由系统另外加上，不要写画风、艺术家名或「高清」「杰作」这类词。',
    '',
    input.sourceText.trim() !== ''
      ? ['原文这一段是这么写的（细节可取用，但只写本镜拍到的，不要把别的镜头的内容写进来）：', input.sourceText].join('\n')
      : '',
    '',
    '输出 JSON：',
    speech.length > 0 ? '{"image_prompt":"","motion_prompt":"","sound":"","lines":[{"how":""}]}' : '{"image_prompt":"","motion_prompt":"","sound":""}',
    '',
    noteOf(args),
  ]
    .filter((item) => item !== '')
    .join('\n')
}

// ——— 审查 ———

export const REVIEW_SYSTEM =
  '你是第一次看这部短剧的观众，没读过原著。只根据给你的内容复述剧情，指出看不懂、接不上的地方。只输出 JSON，不要解释。'

export interface ReviewPromptInput {
  readonly title: string
  /** 前几集的节拍概要。观众看过前几集，但没读过原著。 */
  readonly previous: readonly { readonly title: string; readonly summaries: readonly string[] }[]
  readonly basis: 'beats' | 'shots'
  /** 节拍时 picture 为空；分镜时是观众看得到的画面与动作。 */
  readonly units: readonly { readonly picture: string; readonly utterances: readonly Utterance[] }[]
}

export function reviewPrompt(input: ReviewPromptInput, args: PromptArgs = {}): string {
  const unit = input.basis === 'shots' ? '镜' : '节拍'
  const body = input.units.flatMap((u, i) => [
    `[${unit} ${i + 1}] ${u.picture}`.trimEnd(),
    ...u.utterances.map((line) => `  ${line.speaker ?? '旁白'}：「${line.text}」`),
  ])
  return [
    `下面是短剧《${input.title}》这一集的${input.basis === 'shots' ? '分镜：每镜是观众看到的画面、动作和听到的台词' : '叙事节拍'}。`,
    '只凭下面给的内容理解。即使你认得这部作品，也当作没看过，不要用原著知识补全。',
    '',
    '要做的：',
    '- retelling：复述这一集讲了什么，包括谁、想要什么、为什么这么做、发生了什么、结局意味着什么。看不出来的地方直说看不出来，不要猜着补',
    `- gaps：每一处看不懂或接不上的地方。at 写在哪（如「${unit} 3」「${unit} 5 到 ${unit} 6 之间」），missing 写缺了什么：身份、动机、因果、物件、时间地点，一句话说清`,
    '- score：1–10，只评剧情看不看得懂，不评画面好坏、文笔、人物塑造',
    '- 没有台词的打斗、氛围镜本身不算缺，只看它前后剧情接不接得上',
    '',
    '输出 JSON：',
    `{"retelling":"","gaps":[{"at":"${unit} 3","missing":""}],"score":6}`,
    '',
    noteOf(args),
    '',
    input.previous.length > 0
      ? ['前几集（观众看过）：', ...input.previous.map((ep) => `《${ep.title}》${ep.summaries.join('；')}`), ''].join('\n')
      : '',
    '本集：',
    ...body,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// ——— 图像提示词（代码拼装） ———

/** 各设定图的取景要求。后续所有画面都照它画，所以背景与光线必须干净可控。 */
const LOOK_SHOTS: Readonly<Record<string, string>> = {
  // 中性平光：戏剧光的设定图在图生视频里更容易前后不像同一人。
  full_body: '单人全身立绘，A-pose 站姿，正面，纯灰色背景，中性平光，无戏剧光影与投影，完整露出鞋子与发梢',
  portrait: '胸部以上特写，正面，中性表情，纯灰色背景，中性平光，无戏剧光影',
  expressions: '同一人物的九格表情集，3×3 网格排列，纯灰色背景，中性平光，每格胸像（喜、怒、惊、悲、冷静、微笑、疑惑、痛苦、坚决）',
  turnaround: '同一人物的三视图，从左到右依次为正面、侧面、背面全身，A-pose，纯灰色背景，中性平光，三者等高对齐',
  outfit: '服装细节图，平铺展示该人物的默认着装，主要配件逐件摆开，无人物，纯灰色背景，中性平光',
  establishing:
    '场景空镜，固定机位广角建立镜头，画面内不要出现任何人物或生物；'
    + '分出前景、中景、后景三层，交代出入口的位置、地面与墙面的材质、主要陈设各自的固定相对位置，空间结构连续可复用',
  object: '单件物品的产品图，物件居中占满画面，纯灰色背景，均匀柔光，无人物无手持',
}

/** 非人形的取景：A-pose 立绘、胸像按人设计，套在怪兽身上会画成人形站立。 */
const CREATURE_SHOTS: Readonly<Record<string, string>> = {
  full_body: '生物设定图，三分之四侧面，按它自己的体态与重心摆出自然姿势，整只完整入画，纯灰色背景，中性平光，无戏剧光影与投影',
  portrait: '头部特写，三分之四侧面，眼睛、口部与头部结构清楚，纯灰色背景，中性平光',
  turnaround: '同一生物的三视图，从左到右依次为正面、侧面、背面，按它自己的体态摆放，纯灰色背景，中性平光，三者等高对齐',
}

const CREATURE_KEPT = '参考图是这个生物的设定图：头部结构、眼睛、体表与配色保持不变，只按上面的取景重画。'

const WEARER_KEPT = '参考图是这个人物的全身设定图：五官、发型、服装配色与身材比例保持不变，只按上面的取景重画。'

/** 以全身图为参考改图时列明保留项，五官与配色才不随取景改变。服装图只保留衣服，写了保留五官模型会连人一起画。 */
const DERIVED_KEPT: Readonly<Record<string, string>> = {
  portrait: WEARER_KEPT,
  expressions: WEARER_KEPT,
  turnaround: WEARER_KEPT,
  outfit: '参考图是这个人物的全身设定图：只取其中的着装，款式、配色与配件保持不变，按上面的取景平铺重画。',
}

/** 换装的全身图以本体的全身图为参考：人不变，只换衣服。 */
const COSTUME_KEPT = '参考图是这个人物穿另一身衣服的全身设定图：五官、发型与身材比例保持不变，着装换成上面写的这一身。'

/** `anchors` 逐字拼入、不改写，改写就等于换了一个对象。 */
export function lookPrompt(role: string, name: string, anchors: readonly string[], style: string, args: PromptArgs = {}, options: { costume?: boolean; creature?: boolean } = {}): string {
  const { costume = false, creature = false } = options
  const framing = (creature ? CREATURE_SHOTS[role] : undefined) ?? LOOK_SHOTS[role] ?? '全身立绘，纯灰色背景'
  const kept = costume ? COSTUME_KEPT : creature && role !== 'full_body' ? CREATURE_KEPT : (DERIVED_KEPT[role] ?? '')
  return [
    style,
    framing,
    `对象：${name}`,
    ...anchors,
    kept,
    '画面内不要出现任何文字、水印、边框或多余人物。',
    // 用正向写法过审：否定句里的敏感词本身会原样进请求，也可能反被画出来。
    '用形制、材质与光影表现这个对象，画面干净克制。',
    noteOf(args, true),
  ]
    .filter((line) => line.trim() !== '')
    .join('\n')
}

/** 参考图花名册里的一条，顺序与实际发出的参考图一致。 */
export interface FirstFrameRef {
  readonly kind: string
  /** 末帧这类没有名字的参考图给空串。 */
  readonly name: string
  /** 锁定版的文本锚点，只用来分辨这一张是什么。 */
  readonly anchor: string
  /** 这一张负责画面的哪一部分。末帧留空，它另有一句交代。 */
  readonly duty?: string | undefined
}

/** 中文名与职责放在一起定义，分成两张表容易对不上。 */
export const REF_KINDS = {
  character: { label: '人物', duty: '只提供长相、发型、服装与配饰' },
  scene: { label: '场景', duty: '提供这个地点的空间结构、陈设位置与材质' },
  prop: { label: '道具', duty: '提供这件物品的外观与材质' },
} as const

/** 挑到的不是全身立绘时，花名册按这一张实际是什么说职责。没列的角色位沿用 REF_KINDS。 */
export const LOOK_DUTY: Readonly<Partial<Record<AssetFileRole, string>>> = {
  portrait: '只提供长相、发型、面部特征与上身服装',
  turnaround: '提供体态、侧面与背面的轮廓，以及服装',
  outfit: '只提供服装、配饰与材质，图里的平铺摆法不要带进画面',
}

/** 非人形角色的职责：人物那句里的发型、服装说的是不存在的东西。 */
export const CREATURE_DUTY: Readonly<Partial<Record<AssetFileRole, string>>> = {
  full_body: '只提供体态、头部结构、体表与配色',
  portrait: '只提供头部结构、眼睛与口部',
  turnaround: '提供体态与侧面、背面的轮廓',
}

export interface FirstFrameInput {
  readonly style: string
  readonly scene: string
  /** 景别中文名，拼在 camera 前面成为一整句取景。 */
  readonly shotSize?: string | undefined
  readonly camera: string
  readonly imagePrompt: string
  readonly refs: readonly FirstFrameRef[]
  /** 参考图里有上一镜的末帧。它在 `refs` 里仍占自己那一条。 */
  readonly continues?: boolean
}

/** 参考图定长相、描述定取景；不写「以参考图为准」这类优先级话术。 */
export function firstFramePrompt(input: FirstFrameInput, args: PromptArgs = {}): string {
  const lines = framingLines(input)
  lines.push('用姿态、反应与光影表现冲突，画面干净克制。')
  lines.push('画面内不要出现任何文字、字幕或水印。')
  lines.push(noteOf(args, true))
  return lines.filter((line) => line.trim() !== '').join('\n')
}

/** 画风、参考图花名册与取景。首帧出图与参考图出视频共用，后者没有首帧，开场画面只能靠这一段定。 */
function framingLines(input: FirstFrameInput): string[] {
  const lines = [input.style]
  if (input.refs.length > 0) {
    lines.push('参考图（只管长相与外观；这一镜怎么取景看下面的描述，光线、色调与质感照开头的画风）：')
    const duties = dutiesOnce(input.refs)
    lines.push(
      ...input.refs.map((ref, i) => {
        const anchor = ref.anchor === '' ? '' : `（${ref.anchor}）`
        return `- @图片${i + 1} 是${whoOf(ref)}${anchor}${duties[i] === '' ? '' : `，${duties[i]}`}`
      }),
    )
    lines.push('画框里拍到哪一部分、主体多大、站在画框什么位置、背景里有什么，一律按下面的描述来。')
    if (input.refs.some((ref) => ref.kind === REF_KINDS.character.label)) {
      lines.push('人物参考图是纯灰背景的设定图：把人物放进这一镜的环境里，按下面描述的动作与朝向重新摆放，光线与色温和环境一致。')
    }
  }
  lines.push([[input.shotSize ?? '', input.camera].filter((s) => s.trim() !== '').join('，'), input.scene].filter((s) => s.trim() !== '').join('。'))
  lines.push(numberNames(input.imagePrompt, input.refs, (n) => `（@图片${n}）`))
  if (input.continues === true) {
    lines.push(
      '这一镜紧接着上一镜发生：沿用末帧里的光线、色调与空间位置关系，只按上面的描述推进动作与机位，不要重新布置场景。',
    )
  }
  return lines
}

function whoOf(ref: FirstFrameRef): string {
  return ref.name === '' ? ref.kind : `${ref.kind}「${ref.name}」`
}

/** 职责只在这一类首次出现时写，几个人物各写一遍会让参考图段比画面描述还长。 */
function dutiesOnce(refs: readonly FirstFrameRef[]): string[] {
  const said = new Set<string>()
  return refs.map((ref) => {
    if (ref.duty === undefined || ref.duty === '' || said.has(ref.kind)) return ''
    said.add(ref.kind)
    return ref.duty
  })
}

/** 名字首次出现处标上参考图编号，让图跟着描述走。 */
function numberNames(text: string, refs: readonly FirstFrameRef[], tag: (n: number) => string): string {
  const index = new Map(refs.flatMap((ref, i) => (ref.name === '' ? [] : [[ref.name, i + 1] as const])))
  if (index.size === 0) return text
  // 长名排前面：「小满」不该抢在「林小满」之前匹配上。
  const names = [...index.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  const seen = new Set<string>()
  return text.replace(pattern, (name) => {
    if (seen.has(name)) return name
    seen.add(name)
    return `${name}${tag(index.get(name)!)}`
  })
}

export interface ClipInput {
  readonly motionPrompt: string
  /** 运镜中文名。压在动作行开头，让模型先看到镜头该不该动。 */
  readonly cameraMove?: string | undefined
  /** 一句话剧情，只有 H3 参考图模式的 summary 段用。 */
  readonly summary?: string | undefined
  /** 这一镜的环境与光线，视频模型的画面语境。 */
  readonly scene?: string | undefined
  /** 出镜人物的名字。外观由首帧图确定，文字再写一遍会与图冲突。 */
  readonly castNames?: readonly string[] | undefined
  /** 不走首帧、直接喂参考图时给：开场画面由这一段定。 */
  readonly opening?: FirstFrameInput | undefined
  /** 请求参数已带时长，提示词里也要写明，模型才不会自行补动作。 */
  readonly seconds: number
  /** 这一镜的声音，由逐镜精写给出。只有视频自带声音时填，空串时用通用的一句。 */
  readonly sound?: string | undefined
  /** 只有视频自带声音时填：单独配音时再给台词，会和配音叠成两层人声。 */
  readonly speech?:
    | {
        readonly lines: readonly Utterance[]
        /** 说话人名字 → 音色描述，取自角色设定。没有音色描述的角色不进这张表。 */
        readonly voices: Readonly<Record<string, string>>
        /** 作品里没有已锁定角色的说话人，在不在画面里说不准。 */
        readonly unregistered?: readonly string[] | undefined
        /** 随请求带了音色样本的说话人，第 N 个对应 `<Audio N>`，顺序与请求里的参考音频一致。只有 H3 参考图模式用。 */
        readonly samples?: readonly string[] | undefined
      }
    | undefined
}

/** 画面语境加运动过程。不复述 image_prompt 与 mood，camera 也不单独拼：首帧模式下机位由首帧决定，参考图模式下取景段里已有。 */
export function clipPrompt(input: ClipInput, args: PromptArgs = {}): string {
  const names = (input.castNames ?? []).filter((n) => n.trim() !== '')
  const opening = input.opening
  const context = [
    opening === undefined ? (input.scene ?? '') : '',
    names.length === 0 ? '' : `画面里是${names.join('、')}`,
  ]
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join('。')
  const [camera, layout] = opening === undefined ? ['首帧的这一侧', '首帧已定下的'] : ['上面描述的机位这一侧', '上面描述的']
  const lines = [
    // 参考图模式的 image_prompt 已按景别与机位写明取景，这里不再重复。
    ...(opening === undefined ? [] : framingLines({ ...opening, shotSize: '', camera: '' })),
    context === '' ? '' : `画面：${context}`,
    input.motionPrompt.trim() === '' ? '' : `动作：${input.cameraMove === undefined || input.cameraMove === '' ? '' : `镜头${input.cameraMove}。`}${input.motionPrompt}`,
    opening === undefined ? '保持首帧的人物长相、服装与画风不变。' : '人物长相与服装全程和参考图保持一致，画风保持不变。',
    // H3 单图输入默认会切镜；「保持长相服装画风」管不到空间关系，越轴要单独写。
    `一镜到底，不切镜。摄像机始终在${camera}，保持摄影轴线连续，保持${layout}室内外与前后景关系。`,
    `这一镜 ${input.seconds} 秒，把上面的动作演成完整的过程：有起势、有进行、有收住；`
      + '动作用不完这个长度就放慢节奏或延长停顿，人物全程留在画面内。',
    '用动作与镜头语言表现冲突，画面干净克制。',
    (input.sound ?? '').trim() === '' ? '声音只保留人物对白、环境声与动作音效，不加背景音乐。' : `声音：${sentence(input.sound!)}不加背景音乐。`,
    '画面里不要出现字幕、文字或水印。',
  ]

  const speech = input.speech
  if (speech && speech.lines.length > 0) {
    // 台词用自然语言，不用厂商私有标记（认不出会被念出来）。
    const who = speakersIn(speech, input.castNames)
    // 音色紧跟台词，单列时模型要自己对回说话人。
    const voiceOf = (name: string) => {
      const voice = (speech.voices[name] ?? '').trim()
      return voice === '' ? '' : `（${voice}）`
    }
    for (const line of speech.lines) {
      const name = who.named(line)
      // 怎么说紧贴台词：隔着一段动作写，模型照音色的默认念法说。
      const how = (line.how ?? '').trim() === '' ? '' : `，${line.how!.trim()}`
      if (name === '') lines.push(`旁白念${how}：「${line.text}」`)
      else if (who.offFrame(name)) lines.push(`画外传来「${name}」${voiceOf(name)}的声音${how}：「${line.text}」（${name}不在画面里）`)
      else lines.push(`「${name}」${voiceOf(name)}说${how}：「${line.text}」`)
    }
    lines.push(...speechRules(speech, who))
  }

  lines.push(noteOf(args, true))
  return lines.filter((l) => l.trim() !== '').join('\n')
}

interface Speakers {
  readonly named: (line: Utterance) => string
  readonly inCast: (name: string) => boolean
  readonly unsure: (name: string) => boolean
  readonly offFrame: (name: string) => boolean
}

/** 逐句判断说话人：一镜可能有两个人或夹一句旁白。 */
function speakersIn(speech: NonNullable<ClipInput['speech']>, cast: ClipInput['castNames']): Speakers {
  const named = (line: Utterance) => (line.speaker ?? '').trim()
  // 不按动作描述匹配名字：「望向某某」里有名字，不代表他在画面里。
  const inCast = (name: string) => cast === undefined || cast.some((c) => c.includes(name) || name.includes(c))
  // 有设定图的角色在画面里就会进 cast，不在 cast 即在画外；没有设定图的进不了 cast，交给模型按画面判断。
  const unsure = (name: string) => !inCast(name) && (speech.unregistered ?? []).includes(name)
  const offFrame = (name: string) => !inCast(name) && !unsure(name)
  return { named, inCast, unsure, offFrame }
}

/** 台词之后的总述：谁开口、谁对口型。 */
function speechRules(speech: NonNullable<ClipInput['speech']>, who: Speakers): string[] {
  const rules: string[] = []
  if (speech.lines.filter((line) => who.named(line) !== '').length > 1) {
    rules.push('这是一段对白，按上面的顺序依次说完，一句说完下一句再开口，不同说话人的声音要分得开，不要让同一个人把所有台词都念了。')
  }
  const speakers = [...new Set(speech.lines.map(who.named).filter((name) => name !== ''))]
  const narrated = speech.lines.some((line) => who.named(line) === '')
  const outside = narrated || speakers.some(who.offFrame)
  const undecided = speakers.filter(who.unsure)
  if (speakers.length === 0) {
    rules.push('这几句是旁白，逐字念出即可；画面里不要因此多出一个说话的人，不要有人对口型。')
  } else if (speakers.every(who.inCast) && !narrated) {
    rules.push('台词必须逐字念出，口型与之对上；不要加旁白或其他人声。')
  } else if (speakers.every(who.offFrame)) {
    rules.push('这几句都是画外的声音，逐字念出即可；画面里的人不开口、不对口型，只做听到这些话的反应。')
  } else {
    rules.push([
      '台词逐字念出，画面里的角色开口时对上口型；',
      outside ? '画外的声音只出声，画面里不要有人对它口型；' : '',
      undecided.length === 0 ? '' : `${undecided.map((name) => `「${name}」`).join('')}在画面里就由本人开口，不在就只出声，画面里的其他人不替其对口型；`,
      '不要加其他人声。',
    ].join(''))
  }
  return rules
}

/** MiniMax H3 官方写法（https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing）：英文骨架与标记，内容用中文。[Shot 1] 不带切换时间点即不切镜，时长只走请求参数。 */
export function h3ClipPrompt(input: ClipInput, args: PromptArgs = {}): string {
  const opening = input.opening
  const refs = opening?.refs ?? []
  const subjects = new Map(refs.flatMap((ref, i) => (ref.name === '' ? [] : [[ref.name, i + 1] as const])))
  const names = (input.castNames ?? []).filter((n) => n.trim() !== '')
  const camera = opening === undefined ? '首帧的这一侧' : '描述的机位这一侧'
  const story = [
    opening === undefined ? '保持首帧的人物长相、服装、位置与画风不变。' : '',
    input.cameraMove === undefined || input.cameraMove === '' ? '' : `镜头${input.cameraMove}。`,
    opening === undefined && (input.scene ?? '').trim() !== '' ? `${input.scene!.trim()}。` : '',
    names.length === 0 ? '' : `画面里是${names.join('、')}。`,
    input.motionPrompt.trim() === '' ? '' : sentence(input.motionPrompt),
    `摄像机始终在${camera}，保持摄影轴线连续与前后景关系。`,
  ]

  const speech = input.speech
  const ids = new Map<string, number>()
  const samples = opening === undefined ? [] : (speech?.samples ?? [])
  if (speech && speech.lines.length > 0) {
    const who = speakersIn(speech, input.castNames)
    const closed = " while the on-screen characters' lips remain completely closed."
    for (const line of speech.lines) {
      // 旁白以空串占一个编号：画外人声同样要有稳定的 (Sx)。
      const name = who.named(line)
      const quote = `<d>[Chinese] ${line.text}</d>`
      const how = (line.how ?? '').trim() === '' ? '' : `，${line.how!.trim()}，`
      // 音色只在头一次开口时给：同一个 (Sx) 之后就认得出是谁。
      const fresh = !ids.has(name)
      if (fresh) ids.set(name, ids.size + 1)
      const id = `(S${ids.get(name)})`
      if (name === '') {
        story.push(`旁白 ${id}${how} says in an off-screen voiceover: ${quote}${closed}`)
        continue
      }
      const audio = samples.indexOf(name) + 1
      const voice = !fresh ? '' : audio > 0 ? `音色取自 <Audio ${audio}>` : (speech.voices[name] ?? '').trim()
      const subject = subjects.get(name)
      const speaker = `${name}${subject === undefined ? '' : ` <Subject ${subject}>`} ${id}${voice === '' ? '' : `（${voice}）`}${how}`
      story.push(who.offFrame(name) ? `${speaker} says off-screen: ${quote}${closed}` : `${speaker} says: ${quote}`)
    }
    story.push(...speechRules(speech, who))
  }
  story.push('用动作与镜头语言表现冲突，画面干净克制。画面里不要出现字幕、文字或水印。')
  const note = noteOf(args, true)
  const heard = speech && speech.lines.length > 0 ? '人声只有上面的台词。' : '没有人声。'
  const soundscape = (input.sound ?? '').trim() === '' ? `环境声与动作音效贴合画面，${heard}` : `${sentence(input.sound!)}${heard}`
  const body = joinMixed(story)

  if (opening === undefined) {
    return [
      'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
      [`integrated_multimodal_description: [Shot 1] ${body}`, note].filter((s) => s !== '').join('\n'),
      `overall_soundscape: ${soundscape}`,
      'non_diegetic_music: N/A',
    ].join('\n\n')
  }

  const duties = dutiesOnce(refs)
  // 参考图模式的 image_prompt 已按景别与机位写明取景，这里只拼场景。
  const framing = opening.scene
  const retention = refs.map((ref, i) => {
    if (ref.duty === undefined || ref.duty === '') return `<Subject ${i + 1}>: partially_preserved - 这一镜紧接着它发生，沿用其中的光线、色调与空间位置关系，只按下面的描述推进动作与机位，不要重新布置场景。`
    return `<Subject ${i + 1}>: fully_preserved${duties[i] === '' ? '' : ` - ${duties[i]}`}`
  })
  const voices = samples.map((name, i) => ({ audio: i + 1, subject: subjects.get(name)!, id: ids.get(name)! }))
  retention.push(...voices.map((v) => `<Audio ${v.audio}>: reference - its vocal timbre guides the dialogue delivery of <Subject ${v.subject}> without copying the original signal.`))
  if (refs.some((ref) => ref.kind === REF_KINDS.character.label)) {
    retention.push('人物参考图是纯灰背景的设定图：把人物放进这一镜的环境里，按描述的动作与朝向重新摆放，光线与色温和环境一致。')
  }
  return [
    [
      'subject_definitions:',
      ...refs.map((ref, i) => `<Subject ${i + 1}> is ${whoOf(ref)} in <Picture ${i + 1}>${ref.anchor === '' ? '' : `: ${ref.anchor}`}`),
      ...voices.map((v) => `<Audio ${v.audio}> is the voice-timbre reference for <Subject ${v.subject}> (S${v.id}), containing a spoken Chinese vocal layer.`),
    ],
    ['summary:', `${voices.length === 0 ? '[reference generation]' : '[reference generation + audio reference]'} ${(input.summary ?? '').trim()}`.trim()],
    ['retention_analysis:', ...retention],
    [
      'detailed_description:',
      opening.style,
      `[Shot 1] ${joinMixed([sentence(framing), sentence(numberNames(opening.imagePrompt, refs, (n) => ` <Subject ${n}> `)), body])}`,
      note,
    ],
    ['overall_soundscape:', soundscape],
    ['non_diegetic_music:', 'N/A'],
  ]
    .map((section) => section.filter((line) => line.trim() !== '').join('\n'))
    .join('\n\n')
}

/** 中文句之间直接接，与英文标记相邻处留一个空格，「closed.顾舟」才不会连成一个词。 */
function joinMixed(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .reduce((joined, part) => (joined === '' ? part : /[\x21-\x7e]$/.test(joined) || /^[\x21-\x7e]/.test(part) ? `${joined} ${part}` : joined + part), '')
}

/** 拼进一整段时补上句号，精写出的句子常不带收尾标点。 */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  return /[。！？.!?」]$/.test(trimmed) ? trimmed : `${trimmed}。`
}

/** 模板自述：参数由模板声明，界面照着生成输入框。没有可调参数的只留一句自由补充。 */
export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  { id: 'episode', title: '分集', purpose: '把原文按剧情切成若干集，每集末句逐字抄出，用来在原文里找准切分位置', params: EPISODE_PARAMS },
  { id: 'assets', title: '从原文提取', purpose: '挑出需要固定形象、会在多个镜头里反复出现的人物、场景与道具', params: ASSETS_PARAMS },
  { id: 'beats', title: '写节拍', purpose: '把一集原文改编成叙事节拍，定下哪些展开演、哪些一句带过', params: BEATS_PARAMS },
  { id: 'shots', title: '拆分镜', purpose: '把已确认的节拍拆成镜头表，分配画面与台词', params: [NOTE_PARAM] },
  { id: 'review', title: '审查', purpose: '只看节拍或分镜复述剧情，列出看不懂、接不上的地方', params: [NOTE_PARAM] },
  { id: 'shot_prompt', title: '镜头提示词', purpose: '按本镜上下文与原文细节，写好首帧与视频提示词', params: [NOTE_PARAM] },
  { id: 'look', title: '设定图', purpose: '按资产描述画出设定图，之后每一镜都照它画', params: [NOTE_PARAM] },
  { id: 'first_frame', title: '首帧', purpose: '按分镜描述与参考图画出这一镜的第一帧', params: [NOTE_PARAM] },
  { id: 'clip', title: '视频', purpose: '从首帧出发生成这一镜的运动', params: [NOTE_PARAM] },
]
