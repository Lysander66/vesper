---
name: asset-research
description: 给长庚 Vesper 作品的角色、场景、道具查资料补设定（百科、原著），核对后写回资产。长篇只导入几章、人物外貌原文里没写时用。可自己联网查，也可生成 prompt 让用户拿去网页版 ChatGPT 查。用户手动调用，如 /asset-research proj-xxx
---

# asset-research

提取资产只看导入的那几章。长篇中段的人物，外貌、年龄、服装原文往往一笔不写，模型只能照身份去猜。这个 skill 只做一件事：查资料，给出建议值，**人确认后才写回**。

## 1. 拉资产

服务在 `localhost:8787`，python 访问要绕开系统代理：`urllib.request.build_opener(urllib.request.ProxyHandler({}))`。

- `GET /api/projects/<id>`：`cast` / `scenes` / `props` 三组，每项有 `id`、`name`、`state`（`draft` / `locked`）、`data`
- 原文：同一接口顶层的 `sources`，每份的 `name` 通常就是章节名（如「第134章」），**查资料以这个时点为准**：同一个人第 60 章和第 600 章不是一个样子

问用户书名、作者；`sources` 的名字看不出章节时，再问导入的是哪几章。

## 2. 查：两条路，问用户走哪条

**A. 自己查**：派 general-purpose subagent 查，原始网页留在 subagent 里，主对话只收结果。WebFetch 失败就改用浏览器。

**B. 交给 ChatGPT**：按下面的模板生成 prompt，写到 `/tmp/asset-research/<项目 id>/prompt.md`，再用 `pbcopy` 复制。等用户把 ChatGPT 回的 JSON 贴回来。

两条路的输出格式相同，都走第 3 步。

### prompt 模板（两条路共用）

```
请联网查《<书名>》（<作者>）的人物和设定，给我拍短剧用的定妆描述。
时间点：原著第 <起> 至 <止> 章前后。人物的年龄、外貌、服装都以这个时点为准，不要写后期的样子。
来源优先级：原著正文 > 百度百科 / 萌娘百科 / 维基等百科 > 影视、动画改编（只作参考，并注明）。

下面是现有设定（JSON）。逐条核对并补全，只改有依据的字段：
<资产 JSON：id、name、category 和 data 里的可改字段>

输出一个 JSON 数组，不要其他文字：
[{"id": "...", "name": "...", "<字段>": "<建议值>", "sources": ["URL 或 原著第几章"], "notes": "拿不准的地方、有几种说法的地方"}]

字段写法：
- 角色：identity 身份一句；traits 年龄、体型、脸、发型、标志性特征，要写能画出来的；outfit 这个时点穿什么；voice 音色语速；aliases 别称
- 场景：description 空间结构、标志物、材质；lighting 常见的时段和光线
- 道具：description 形制、尺寸、材质、颜色；holder 归谁
- 查不到的字段不要输出，不要编造
- 同一人物如果有变身、法相、白头这类形态变化，traits 只写该时点的常态；其他形态写进 notes，说明从哪一章开始出现
```

## 3. 对照，给人看

每个资产只列有变化的字段，列成表：`资产 | 字段 | 现值 | 建议值 | 出处`。不改的字段不列。

同时标出下面几种情况，留给用户决定：
- **有多种说法**：notes 里写了的
- **形态变化**：建议另建一个资产（如角色化身的另一形态），还是只写常态
- **未成年角色**：服装里不要出现贴身、湿透、透这类字眼
- **已锁定的资产**：改完要重新出图、重新锁定，否则分镜仍然引用旧的定妆图

## 4. 写回（用户点头之后）

- `PATCH /api/assets/<id>`：只发要改的字段。可改字段有 aliases、tier、identity、traits、outfit、voice、description、lighting、holder
- 已锁定的资产直接 PATCH 会被拒（409）：先 `POST /api/assets/<id>/unlock` 再 PATCH；重新出图、重新锁定后，`POST /api/assets/<id>/follow` 让镜头改用新版本
- 新建形态资产：`POST /api/projects/<id>/assets {name, category, data}`
- 写完列一下改了哪几个，哪些已锁定、需要重新出图。**出图要花钱**，问过用户再做

不改原文，不动节拍和分镜。
