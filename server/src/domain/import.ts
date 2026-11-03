/** 导入的原文落库前的归一化与默认集名。一个文件存一条。 */

export interface SourceFile {
  readonly name: string
  readonly text: string
}

/** 去 BOM、CRLF 转 LF、NFC。字符下标按归一化后的文本计，只在落库时做一次。 */
export function normalizeSource(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
}

const CHAPTER = /^第[0-9零〇一二两三四五六七八九十百千万]+[章回节卷]/

/** 正文首行是章节标题（「第90章沧海，桑田」）就用它，章号与章名之间补一个空格；否则用文件名，去掉章号前的书名。 */
export function titleOf(file: SourceFile): string {
  const first = file.text.trimStart().split('\n', 1)[0]?.trim() ?? ''
  const heading = CHAPTER.exec(first)
  if (heading !== null && first.length <= 40) {
    const name = first.slice(heading[0].length).trim()
    return name === '' ? heading[0] : `${heading[0]} ${name}`
  }
  const base = file.name.split('/').pop() ?? file.name
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim()
  const chapter = /[-_\s]+(第.+)$/.exec(stem)?.[1]
  return chapter !== undefined && CHAPTER.test(chapter) ? chapter : stem
}

const BY_NAME = new Intl.Collator('zh', { numeric: true })

/** 归一化、丢掉空文件、按文件名排（数字按大小比）。全空时回空数组。 */
export function prepareSources(files: readonly SourceFile[]): SourceFile[] {
  return files
    .map((file) => ({ name: file.name, text: normalizeSource(file.text) }))
    .filter((file) => file.text.trim() !== '')
    .sort((a, b) => BY_NAME.compare(a.name, b.name))
}
