<p align="center">
  <img src="docs/logo.svg" width="96" alt="Vesper">
</p>

<h1 align="center">长庚 Vesper</h1>

<p align="center"><b>Chapters in, episodes out.</b></p>

<p align="center">A local workflow that turns novel chapters into AI short drama episodes.</p>

<p align="center"><sub>「东有启明，西有长庚」——《诗经·小雅·大东》。拉丁语叫 Vesper；也谐音「长更」，长期更新。</sub></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-black" alt="Bun"></a>
</p>

<p align="center">English · <a href="./README.zh-CN.md">中文</a></p>

<!-- TODO(Lysander): demo video goes here once a public-domain sample episode is recorded -->

## Highlights

- **Human in the loop.** Episode splits, assets, and beats each need your sign-off before anything downstream runs; upstream edits mark downstream outputs as stale instead of silently redoing them.
- **Call records.** Every external call is logged and can be exported as cURL.
- **Local first.** Projects, outputs, and call logs are stored on your machine.

## How it works

1. **Episodes**: split the source text into episodes.
2. **Assets**: extract characters, scenes, and props, generate reference sheets, and lock them after review.
3. **Beats**: adapt an episode into story beats.
4. **Shots**: break beats into shots with framing, camera movement, duration, and cast.
5. **Generation**: a first frame, a video clip, and voice for each shot.
6. **Assembly**: concatenate the shots into the episode.

See [pipeline](https://lysander66.github.io/vesper/pipeline.html) for each step's prompts and data flow. All prompts live in [`prompts.ts`](./server/src/pipeline/prompts.ts); adjust them as needed.

## Getting started

**Prerequisites:** Bun and `ffmpeg`.

```bash
git clone https://github.com/Lysander66/vesper.git && cd vesper
bun install
bun run dev
```

In a second terminal:

```bash
bun run dev:web
```

Open http://localhost:5173/settings and add your API credentials.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VESPER_DATA_DIR` | `~/.vesper` | Database (`vesper.db`) and generated files (`artifacts/`, `films/`) |
| `VESPER_PORT` | `8787` | Server port |
| `VESPER_CALLS_DAYS` | `30` | Days to keep raw request and response bodies; `0` keeps them forever |

Exported cURL commands read the API key from `$VESPER_API_KEY`.

## Driving it with an agent

The repo ships agent skills under [`.agents/skills`](./.agents/skills), usable from [Claude Code](https://claude.com/claude-code), [Codex](https://openai.com/codex), [pi](https://pi.dev), or any agent that reads that directory. With the server running, hand the agent a chapter:

```
Make the first episode from ~/novels/chapter-1.txt
```

It imports the text and runs the whole pipeline, pausing for your review once assets are extracted, before any video is generated, and after the first episode is assembled.

## Contributing

Run `bun run check` (typecheck, lint, knip, tests, build) before sending a pull request. When changing prompts, read [AGENTS.md](./AGENTS.md) first.

## License

[Apache-2.0](./LICENSE)
