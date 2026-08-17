import { scanLines, type LineInfo } from './scan.js'

/**
 * Splits a markdown document into deck frontmatter + raw slide chunks.
 *
 * Rules (documented for authors):
 *  - A slide separator is a line of exactly `---`, preceded by a blank line.
 *    The blank-line requirement is what keeps a setext `H2` (`Title\n---`)
 *    from silently becoming a slide break.
 *  - `----` or longer is a thematic break, never a separator.
 *  - A `---` inside a code fence or an HTML comment is never a separator.
 *  - Deck frontmatter is the leading `---` ... `---` block of the file.
 *  - Per-slide frontmatter is a YAML block directly after a separator,
 *    terminated by its own `---` line.
 */

export interface RawSlide {
  /** Raw YAML text, or null when the slide has no frontmatter block. */
  readonly metaText: string | null
  /** 1-based line of the first YAML line. 0 when there is no frontmatter. */
  readonly metaLine: number
  /** Markdown body, with frontmatter and speaker notes removed. */
  readonly body: string
  /** 1-based line the body starts on. */
  readonly bodyLine: number
  /**
   * The body as it would read if the frontmatter candidate were *not*
   * frontmatter — used to recover when the YAML turns out to be content
   * (a setext heading, say). Identical to `body` when `metaText` is null.
   */
  readonly bodyWithMeta: string
  /** 1-based line `bodyWithMeta` starts on. */
  readonly bodyWithMetaLine: number
  /** Speaker notes from a trailing HTML comment. */
  readonly notes: string | null
}

export interface SplitDocument {
  readonly frontmatterText: string | null
  /** 1-based line of the first YAML line. 0 when there is no frontmatter. */
  readonly frontmatterLine: number
  readonly slides: RawSlide[]
}

const SEPARATOR_RE = /^---[ \t]*$/

function isStructural(line: LineInfo): boolean {
  return !line.inFence && !line.inComment
}

function isSeparatorLine(line: LineInfo): boolean {
  return isStructural(line) && SEPARATOR_RE.test(line.text)
}

function joinText(lines: LineInfo[], start: number, end: number): string {
  const out: string[] = []
  for (let i = start; i < end; i++) out.push(lines[i]!.text)
  return out.join('\n')
}

export function splitDocument(source: string): SplitDocument {
  const lines = scanLines(source)

  let cursor = 0
  let frontmatterText: string | null = null
  let frontmatterLine = 0

  // Phase A — leading deck frontmatter. Handled separately from slide
  // separators because its closing `---` is *not* blank-preceded.
  let first = 0
  while (first < lines.length && lines[first]!.blank) first++
  if (first < lines.length && isSeparatorLine(lines[first]!)) {
    // Same contiguity rule as per-slide frontmatter: a blank line means this
    // `---` was a separator introducing an empty first slide, not a fence.
    for (let j = first + 1; j < lines.length; j++) {
      const line = lines[j]!
      if (line.blank || !isStructural(line)) break
      if (!SEPARATOR_RE.test(line.text)) continue
      frontmatterText = joinText(lines, first + 1, j)
      frontmatterLine = first + 2
      cursor = j + 1
      break
    }
  }

  // Phase B — cut the rest into chunks.
  const cuts: number[] = []
  for (let i = cursor; i < lines.length; i++) {
    if (!isSeparatorLine(lines[i]!)) continue
    const prev = i > 0 ? lines[i - 1] : undefined
    if (i === cursor || prev?.blank) cuts.push(i)
  }

  const ranges: Array<[number, number]> = []
  let start = cursor
  for (const cut of cuts) {
    ranges.push([start, cut])
    start = cut + 1
  }
  ranges.push([start, lines.length])

  const slides: RawSlide[] = []
  for (const [from, to] of ranges) {
    const slide = extractSlide(lines, from, to)
    if (slide.bodyWithMeta === '' && slide.notes === null) continue
    slides.push(slide)
  }

  return { frontmatterText, frontmatterLine, slides }
}

function extractSlide(lines: LineInfo[], from: number, to: number): RawSlide {
  let head = from
  while (head < to && lines[head]!.blank) head++

  // Speaker notes sit at the tail, independent of any frontmatter at the head.
  let tail = to
  while (tail > head && lines[tail - 1]!.blank) tail--
  const notes = extractNotes(lines, head, tail)
  tail = notes.bodyEnd
  while (tail > head && lines[tail - 1]!.blank) tail--

  // Phase C — per-slide frontmatter: a contiguous non-blank YAML block up to
  // the first structural `---`. Contiguity is what keeps prose that happens to
  // parse as YAML (`# Heading` + `Key: value` + a setext `---`) out of it.
  let terminator = -1
  for (let j = head; j < tail; j++) {
    const line = lines[j]!
    if (line.blank || !isStructural(line)) break
    if (SEPARATOR_RE.test(line.text)) {
      terminator = j
      break
    }
  }

  let metaText: string | null = null
  let metaLine = 0
  let bodyStart = head
  if (terminator !== -1) {
    metaText = joinText(lines, head, terminator)
    metaLine = head + 1
    bodyStart = terminator + 1
    while (bodyStart < tail && lines[bodyStart]!.blank) bodyStart++
  }

  return {
    metaText,
    metaLine,
    body: joinText(lines, bodyStart, tail),
    bodyLine: bodyStart + 1,
    bodyWithMeta: joinText(lines, head, tail),
    bodyWithMetaLine: head + 1,
    notes: notes.text,
  }
}

/** Speaker notes = the HTML comment that closes out the slide body. */
function extractNotes(
  lines: LineInfo[],
  start: number,
  end: number,
): { text: string | null; bodyEnd: number } {
  const none = { text: null, bodyEnd: end }

  let last = end - 1
  while (last >= start && lines[last]!.blank) last--
  if (last < start) return none

  const closing = lines[last]!
  if (closing.inFence || !closing.inComment) return none
  if (!closing.text.trimEnd().endsWith('-->')) return none

  let open = last
  while (open >= start) {
    const line = lines[open]!
    if (line.inFence || !line.inComment) return none
    if (line.text.trimStart().startsWith('<!--')) break
    open--
  }
  if (open < start) return none

  const raw = joinText(lines, open, last + 1).trim()
  const text = raw.slice('<!--'.length, -'-->'.length).trim()
  return { text: text === '' ? null : text, bodyEnd: open }
}
