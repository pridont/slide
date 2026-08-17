import { SlideParseError } from './errors.js'
import {
  SLIDE_FIELD_NAMES,
  isRecord,
  looksLikeFrontmatter,
  parseYamlBlock,
  partitionLeading,
  validateDeckMeta,
  validateSlideMeta,
} from './meta.js'
import { splitDocument, type RawSlide } from './split.js'
import type { Deck, DeckMeta, ParseWarning, Slide, SlideMeta } from './types.js'

export { SlideParseError } from './errors.js'
export { splitDocument } from './split.js'
export type { Deck, DeckMeta, ParseWarning, Slide, SlideMeta } from './types.js'

export function parseDeck(source: string, file: string): Deck {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const doc = splitDocument(text)
  const warnings: ParseWarning[] = []

  let deckMeta: DeckMeta = {}
  let leadingSlideMeta: SlideMeta = {}

  if (doc.frontmatterText !== null && doc.frontmatterText.trim() !== '') {
    const value = parseYamlBlock(doc.frontmatterText, file, doc.frontmatterLine)
    if (!isRecord(value)) {
      throw new SlideParseError(
        'deck frontmatter must be a mapping of keys to values.',
        file,
        doc.frontmatterLine,
      )
    }
    const parts = partitionLeading(value, file, doc.frontmatterLine)
    deckMeta = validateDeckMeta(parts.deck, file, doc.frontmatterLine)
    leadingSlideMeta = validateSlideMeta(parts.slide, file, doc.frontmatterLine)
  }

  const slides: Slide[] = doc.slides.map((raw, i) => toSlide(raw, i + 1, file, warnings))
  const first = slides[0]
  if (first) {
    // Deck frontmatter doubles as slide 1's; the slide's own keys win.
    slides[0] = { ...first, meta: { ...leadingSlideMeta, ...first.meta } }
  }

  return { file, meta: deckMeta, slides, warnings }
}

function toSlide(raw: RawSlide, index: number, file: string, warnings: ParseWarning[]): Slide {
  let meta: SlideMeta = {}
  let body = raw.body
  let sourceLine = raw.bodyLine

  if (raw.metaText !== null) {
    const interpreted = interpretMeta(raw, file, warnings)
    if (interpreted) {
      meta = interpreted
    } else {
      // Not frontmatter after all — put the block back into the body.
      body = raw.bodyWithMeta
      sourceLine = raw.bodyWithMetaLine
    }
  }

  return { index, meta, body, notes: meta.notes ?? raw.notes, sourceLine }
}

/** Returns null when the block is content rather than frontmatter. */
function interpretMeta(raw: RawSlide, file: string, warnings: ParseWarning[]): SlideMeta | null {
  const text = raw.metaText!
  if (text.trim() === '') return {}

  let value: unknown
  try {
    value = parseYamlBlock(text, file, raw.metaLine)
  } catch (error) {
    if (error instanceof SlideParseError && looksLikeFrontmatter(text)) throw error
    return null
  }

  if (!isRecord(value)) return rejectMeta(raw, text, warnings)

  const keys = Object.keys(value)
  // All keys unknown reads as prose that happens to parse as YAML, not as a
  // frontmatter block of nothing but typos.
  if (keys.length > 0 && !keys.some((key) => SLIDE_FIELD_NAMES.includes(key))) {
    return rejectMeta(raw, text, warnings)
  }

  return validateSlideMeta(value, file, raw.metaLine)
}

function rejectMeta(raw: RawSlide, text: string, warnings: ParseWarning[]): null {
  if (looksLikeFrontmatter(text)) {
    warnings.push({
      message:
        'this block looks like frontmatter but has no recognised keys, so it was rendered as slide content.',
      line: raw.metaLine,
    })
  }
  return null
}
