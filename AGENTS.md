# 长庚 Vesper

## Editing prompts

Read the "怎么改提示词" section of `docs/pipeline.html` first; it lists the formats that must not change.

1. Save the full text before the change: `bun run server/src/tools/dump-prompts.ts <template id> > /tmp/before.txt`
2. Edit `server/src/pipeline/prompts.ts`.
3. Dump again, diff, and read the result end to end: `bun run server/src/tools/dump-prompts.ts <template id> > /tmp/after.txt && diff /tmp/before.txt /tmp/after.txt`
4. Update the matching section of `docs/pipeline.html` so it is identical to the dump output.
5. Add an assertion in `server/test/prompts.test.ts` or `server/test/preview.test.ts`, then run `bun run check`.

Problems invisible in code — repeated sentences, wrappers outweighing the scene description, stray punctuation at join points — only show up in the full text. A new rule without an assertion is easily lost in the next edit. Image quality problems almost always trace back to `shotPromptDraft`; the first-frame and video templates only wrap what it writes.

## Writing prompts

- **General rules only.** Genre-specific cases are endless; each one adds noise for every other genre, and hard "must / never" rules push the model too far. Leave specifics to the user-filled include / exclude fields.
- **No numeric limits.** Caps on counts, lengths, or repetitions force the model to rank and pad. Keep only numbers that are functionally required.
- **For image and video models, describe what is in the frame positively.** Never write sensitive words, negated or not; content moderation may reject either. Excluding a whole category of elements (text, watermarks, subtitles, background music) may be stated directly.

## Code

- **Comments describe the present.** Code, comments, and docs carry no change history; that belongs to git.
- **`server/src/db/schema.ts` holds only the current schema.** Changes to existing databases go in SQL files under `script/`, run by hand; no migration code.

## Trial runs

- **One shot at a time, never a whole batch.** A shot's prompt, first frame, and video are made and reviewed before moving to the next; assembly comes last. If an early shot is wrong, everything generated after it is wasted. Shot breakdown produces only structure and may cover a whole episode.
- **Same for reference sheets.** Generate a few key assets first; produce the rest once the art style and characters are approved.

## UI copy

UI text is Chinese: professional, idiomatic, concise written language. Avoiding jargon does not mean going colloquial; standard industry terms stay.

## Editing this file

State principles only; no examples.
