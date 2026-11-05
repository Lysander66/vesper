<p align="center">
  <img src="docs/logo.svg" width="96" alt="Vesper">
</p>

<h1 align="center">长庚 Vesper</h1>

<p align="center"><b>原文进，成片出。</b></p>

<p align="center">把小说做成 AI 短剧的本地工作流。</p>

<p align="center"><sub>「东有启明，西有长庚」——《诗经·小雅·大东》。拉丁语叫 Vesper；也谐音「长更」，长期更新。</sub></p>

<p align="center"><img src="docs/hero.jpg" width="900" alt="一句话交给 agent，得到一集短剧"></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-black" alt="Bun"></a>
</p>

<p align="center"><a href="./README.md">English</a> · 中文</p>

<p align="center"><a href="https://www.bilibili.com/video/BV1X54b6zEBn"><img src="docs/demo-huarongdao.jpg" width="640" alt="示例作品：《三国演义》华容道"></a><br><sub>示例作品：《三国演义》华容道 · 38 镜，约 4 分钟 · <a href="https://www.bilibili.com/video/BV1X54b6zEBn">在 B 站观看</a> · <a href="https://www.bilibili.com/video/BV1mt4h6BEXK">制作过程</a></sub></p>

## 特点

- **关键节点由人把关**：分集定稿、资产锁定、节拍确认之后才往下走；上游改了，下游产物标为过时，不自动重做。
- **调用记录**：每一次外部调用都有记录，可导出为 cURL。
- **本地运行**：作品、产物和调用记录都存在本机。

## 工作流程

1. **分集**：一份原文切成若干集。
2. **资产**：从原文提取角色、场景、道具，出设定图，人工确认后锁定。
3. **节拍**：把每集原文改编为剧情节拍。
4. **分镜**：节拍拆成镜头，定景别、运镜、时长、出场人物。
5. **逐镜生成**：每一镜出首帧、视频、配音。
6. **合成**：按镜序拼接成这一集。

每一步的提示词与数据流向见[流水线文档](https://lysander66.github.io/vesper/pipeline.html)。提示词都在 [`prompts.ts`](./server/src/pipeline/prompts.ts)，可按需修改。

## 快速开始

需要先安装 Bun 和 `ffmpeg`。

```bash
git clone https://github.com/Lysander66/vesper.git && cd vesper
bun install
bun run dev
```

另开一个终端：

```bash
bun run dev:web
```

打开 http://localhost:5173/settings 添加 API 凭证。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `VESPER_DATA_DIR` | `~/.vesper` | 数据库（`vesper.db`）与生成的文件（`artifacts/`、`films/`） |
| `VESPER_PORT` | `8787` | 服务端口 |
| `VESPER_CALLS_DAYS` | `30` | 外部调用完整请求与响应的保留天数，`0` 为永久保留 |

导出的 cURL 用环境变量 `$VESPER_API_KEY` 代替 API Key。

## 交给 agent 来做

仓库在 [`.agents/skills`](./.agents/skills) 下自带 skill，[Claude Code](https://claude.com/claude-code)、[Codex](https://openai.com/codex)、[pi](https://pi.dev) 等读取该目录的 agent 都能用。服务启动后，把一章交给 agent：

```
把 examples/三国演义-草船借箭.txt 做成第一集
```

它会导入原文并跑完整条流水线，在设定图定稿、分镜审查、样片验收三处停下，等你确认。

## 参与贡献

提交 PR 前运行 `bun run check`（类型检查、lint、knip、测试、构建）。改提示词前先读 [AGENTS.md](./AGENTS.md)。

## 许可证

[Apache-2.0](./LICENSE)
