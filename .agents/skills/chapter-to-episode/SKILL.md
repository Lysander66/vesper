---
name: chapter-to-episode
description: 把本地 txt 里的小说章节做成一集短剧：调长庚 Vesper 后端接口，从导入一路跑到第一集合成版，只在资产确认、生成视频前、第一集合成版出来后三处停下等人确认。用户给出小说或章节文件、想做成一集时使用。
---

# chapter-to-episode

一律走 HTTP 接口，不点界面；浏览器只在需要看画面时打开。服务在 `localhost:8787`，所有调用经同目录的 `api.py`：

```bash
python3 .agents/skills/chapter-to-episode/api.py GET /api/projects/<id>
python3 .agents/skills/chapter-to-episode/api.py POST /api/sources/<id>/plan '{"prompt_args":{"episode":{"episode_count":"3"}}}'
```

调模型的接口返回 202，`api.py` 会等任务结束再输出 `status`、`error`、`warns`、`report`，退出码非 0 就是失败。**`warns` 不为空时任务照样算成功**，但要读完再往下走，比如「N 镜没写出提示词」。

报错先读 `error` 再决定：409 是前置条件不满足或同一对象已有任务在跑，照原因补齐，不要原样重试；`interrupted` 的任务是服务重启打断的，直接重跑。

## 1. 预检

`GET /api/bindings` 要绑定 `text`、`image`、`video` 三类模型；配音方式为 `separate` 时还要有 `tts`，`native` 由视频模型直接出声，不需要。缺哪个就停下告诉用户去设置页配置。

## 2. 导入

```bash
python3 .agents/skills/chapter-to-episode/api.py import <txt 路径> [作品名]
```

返回的作品里记下 `project.id` 和 `sources[0].id`。一个 txt 是一份原文，不自动按章切。

用户启动时说了画幅（`aspect`：`16:9` / `9:16`）、配音方式（`audio_mode`：`native` / `separate`）等，用 `PATCH /api/projects/<id>` 写进去；没说就用默认值。

生成并发数在这一步问用户一次，没说就用 3：视频端点对同时进行的任务有限额，超了会排队或报错，3 路在常见限额内又能明显缩短整集耗时。

单集目标时长（`target_seconds`）没有默认值，每部作品问一次：用户没说时，按原文的台词量与情节段落估一个建议值请用户确认。单镜时长（`shot_min_seconds` / `shot_max_seconds`）取视频端点支持的最短一档起，MiniMax H3 为 4–5 秒：视频生成多长就用多长，没有剪辑这一步。

## 3. 画风

`POST /api/projects/<id>/suggest-style` 取 `picks[0].label`。`style` 字段要存预设的全文，不是名字：

```bash
bun -e "import {stylePresetOf} from './shared/src/styles'; console.log(stylePresetOf('<label>')?.prompt)"
```

再 `PATCH /api/projects/<id> {"style": "<全文>"}`。

## 4. 分集

1. `POST /api/sources/<id>/suggest-episodes` 拿到 `count`
2. `POST /api/sources/<id>/plan`，body 带 `{"prompt_args":{"episode":{"episode_count":"<count>"}}}`，集数必须是字符串
3. `POST /api/sources/<id>/freeze`

之后 `GET /api/projects/<id>` 的 `sources[].episodes[]` 里是各集 id。

## 5. 节拍

每集依次 `POST /api/episodes/<id>/beats`，再 `POST /api/episodes/<id>/beats/confirm`。同一集不能并发，不同集可以。

确认前按台词量和拍数估一下放不放得进 `target_seconds`。偏满时停下问用户：放宽时长，还是删次要情节或台词，并给出建议和理由，说清各自删什么、加多少秒。不要自己判断"还能装下"就往下走：拆分镜时塞不下，只能硬压或截断。

## 6. 资产

`POST /api/projects/<id>/assets/extract {"source_ids": ["<source id>"]}`。放在节拍确认之后，提取时才看得到节拍里开口的人。

## 7. 停点 1：资产确认

`GET /api/projects/<id>` 的 `cast` / `scenes` / `props`，每类一张表列名字和要点。原文没写外貌、年龄、服装的角色单独标出来，建议用户先跑 `/asset-research`。

每个人物核对音色描述（`voice`）：年龄、性别、嗓音质地、说话习惯写清楚，视频按它出声。不给人物挂预置音色（`voice-preset`）当试音：挂了试音，音色描述就不起作用，视频会照示范录音的播音腔念台词。

**下一步开始花钱出图，用户确认前不往下走。** 用户要改的用 `PATCH /api/assets/<id>` 改。

## 8. 设定图与锁定

1. 先给主角和主要场景各出一张（`POST /api/assets/<id>/looks`），给用户看画风与人物，认可了再 `POST /api/projects/<id>/looks` 补其余
2. `POST /api/projects/<id>/assets/lock`：没有图的资产会被跳过，返回的 `skipped` 不为 0 时要查出是哪几个并报给用户
3. 锁定前对照全部人物设定图，看主角能否一眼和同场的人分开（配色、形制），身份与形象是否相符；有问题这时改，不要等出了视频再改

分镜之后再改资产：`POST /api/assets/<id>/unlock` → 改 → 重出图 → `POST /api/assets/<id>/lock` → **`POST /api/assets/<id>/follow`**。分镜钉在拆分镜时的锁定版上，不调 follow 就重做，出来的还是旧形象。follow 会把受影响的镜标成过时，先重做一镜、亲眼确认新形象出现了，再批量往下做。

## 9. 分镜

每集 `POST /api/episodes/<id>/shots/split`，只出镜头结构，一拍一次调用。画面提示词不在这一步写：生成某一镜时（第 12 步）现写，前面的镜不满意，后面的提示词就不白写。

## 10. 审查与问题归类

拆分镜会自动跑一次审查，结果在 `GET /api/episodes/<id>` 的 `episode.review`：`score`、`retelling`、`gaps[]`。审查是没读过原文的模型只看分镜复述剧情，`gaps` 是它看不懂、接不上的地方。

拿同一接口的 `source`（本集原文）、`episode.beats`、`shots[]` 逐条对照，给每处问题归类：

| 类 | 判据 | 改哪儿 |
| --- | --- | --- |
| 本集原文没说 | 本集原文里没交代，前几章也没有 | 改编决定：补成台词或画面，还是保留留白 |
| 前几章交代过 | 本集原文没说，但前几章说过 | 不补前情；剧情离不开的，由本集人物用一句台词带出 |
| 节拍丢了 | 原文有，节拍里没有 | 改节拍 |
| 拆分镜丢了 | 节拍有，分镜的 summary 里没有 | 加镜，或把信息并进相邻一镜 |
| 画面丢了 | summary 里有，image_prompt / motion_prompt / 台词里没有 | 改这一镜的提示词 |

原文靠叙述交代的因果，建议转成人物台词或画面，不转旁白。

## 11. 停点 2：生成视频前

每集报告：
- 审查分数，复述概括成一句
- 问题表：`位置 | 缺什么 | 归哪一类 | 建议`，按对理解的影响排序
- 镜数、总秒数、预计调用次数：`native` 每镜首帧 + 视频两次；`separate` 再加有台词的镜数
- `GET /api/jobs/cost?owner_kind=project&owner_id=<id>` 截至目前的花费

**只出报告，不改节拍和分镜。** 用户决定改哪里：改节拍后回第 5 步重新确认、拆分镜；只改分镜后 `POST /api/episodes/<id>/review` 重审。用户确认前不往下走。

## 12. 生成第一集

逐镜做，不调用整集的 `POST /api/episodes/<id>/produce`：前面不满意，后面出的全要重来。

1. 按镜头顺序，每镜 `POST /api/shots/<id>/produce`：这一镜还没有提示词时先写，再出首帧（参考图模式跳过）、视频
2. 第一镜先只写提示词（`POST /api/shots/<id>/polish`）给用户看，认可了再出图出视频；开头几镜做完再停一次，画风、人物、台词认可了再往下；之后每做完一场报一次
3. 开头几镜认可后，其余镜按用户定的并发数并行跑，每路一个 `POST /api/shots/<id>/produce`。会接上一镜末帧的镜必须等上一镜视频出来再跑：作品 `continuity_mode` 为 `chain`、这一镜 `join_mode` 为 `continue`、且与上一镜是同一场景。把这样连着的几镜编成一条链，链内串行，链与链、单镜之间并行。网络类报错（连接中断、超时、5xx）重试一次，其他报错停下这一路并报给用户
4. 某镜不满意就改这一镜的提示词重出，不往后推
5. 每镜任务跑起来时告诉用户在做第几镜、做到哪一步；界面顶栏「任务」里能看到进度
6. 报错写着「内容审核拒绝」时不原样重试，按这个顺序换：先查这一镜的提示词、资产名与资产描述里有没有血腥、武器伤人、军事行动这类字眼（正面反面都算，「无血迹」也会被拒），改成动作、反应与光影的写法后重出；还被拒，首帧改用参考图模式（`PATCH /api/shots/<id> {"clip_source":"reference"}`）或换绑图像端点。改了哪几个词、换了什么，在汇报里写明
7. 用户要连续看已出的几镜，指给用户集页面的「分镜」页签

## 13. 合成与停点 3

`POST /api/episodes/<id>/assemble`，合成版路径在 `GET /api/episodes/<id>` 的 `film.path`。有过时产物时合成会失败，问用户后带 `{"force":"yes"}` 重跑。

把合成版路径和本集花费交给用户。**用户看过第一集再决定**后面几集是否照此生成，每集走第 12、13 步。
