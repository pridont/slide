import { parse as parseYaml, YAMLParseError } from 'yaml'
import { SlideParseError } from './errors.js'
import { validateFonts } from '../theme/fonts.js'
import { validateTheme } from '../theme/tokens.js'
import { closest } from './suggest.js'
import type { DeckMeta, SlideMeta } from './types.js'

interface FieldSpec {
  readonly type: 'string' | 'object'
  /** When present, the value must be one of these. */
  readonly values?: readonly string[]
}

const DECK_FIELDS: Record<string, FieldSpec> = {
  title: { type: 'string' },
  description: { type: 'string' },
  slug: { type: 'string' },
  aspectRatio: { type: 'string' },
  colorScheme: { type: 'string', values: ['dark', 'light'] },
  theme: { type: 'object' },
  fonts: { type: 'object' },
}

const SLIDE_FIELDS: Record<string, FieldSpec> = {
  layout: { type: 'string' },
  class: { type: 'string' },
  background: { type: 'string' },
  image: { type: 'string' },
  imageAlt: { type: 'string' },
  transition: { type: 'string' },
  notes: { type: 'string' },
}

export const SLIDE_FIELD_NAMES: readonly string[] = Object.keys(SLIDE_FIELDS)

/** Parse a YAML block, remapping error positions onto the source file. */
export function parseYamlBlock(text: string, file: string, startLine: number): unknown {
  try {
    return parseYaml(text)
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const offset = error.linePos?.[0]?.line ?? 1
      throw new SlideParseError(`invalid YAML: ${error.message.split('\n')[0]}`, file, startLine + offset - 1)
    }
    throw error
  }
}

/**
 * True when a rejected YAML block still looks like the author meant it as
 * frontmatter — used to turn a typo into an error rather than into content.
 */
export function looksLikeFrontmatter(text: string): boolean {
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    return /^[A-Za-z_][\w-]*\s*:(\s|$)/.test(line)
  }
  return false
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deck frontmatter doubles as slide 1's frontmatter; route keys by name. */
export function partitionLeading(
  record: Record<string, unknown>,
  file: string,
  line: number,
): { deck: Record<string, unknown>; slide: Record<string, unknown> } {
  const deck: Record<string, unknown> = {}
  const slide: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key in DECK_FIELDS) deck[key] = value
    else if (key in SLIDE_FIELDS) slide[key] = value
    else throw unknownKey(key, [...Object.keys(DECK_FIELDS), ...Object.keys(SLIDE_FIELDS)], file, line)
  }
  return { deck, slide }
}

export function validateDeckMeta(record: Record<string, unknown>, file: string, line: number): DeckMeta {
  const meta = validate(record, DECK_FIELDS, file, line) as DeckMeta & {
    theme?: Record<string, unknown>
    fonts?: Record<string, unknown>
  }
  // Past the generic mapping rule, so a mistyped token errors rather than
  // becoming CSS nobody asked for.
  if (meta.theme) meta.theme = validateTheme(meta.theme, { file, line })
  if (meta.fonts) return { ...meta, fonts: validateFonts(meta.fonts, { file, line }) } as DeckMeta
  return meta as DeckMeta
}

export function validateSlideMeta(record: Record<string, unknown>, file: string, line: number): SlideMeta {
  return validate(record, SLIDE_FIELDS, file, line) as SlideMeta
}

function validate(
  record: Record<string, unknown>,
  fields: Record<string, FieldSpec>,
  file: string,
  line: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    const spec = fields[key]
    if (!spec) throw unknownKey(key, Object.keys(fields), file, line)
    if (value === null || value === undefined) continue

    if (spec.type === 'string' && typeof value !== 'string') {
      throw new SlideParseError(`"${key}" must be a string, got ${describe(value)}.`, file, line)
    }
    if (spec.type === 'object' && !isRecord(value)) {
      throw new SlideParseError(`"${key}" must be a mapping, got ${describe(value)}.`, file, line)
    }
    if (spec.values && !spec.values.includes(value as string)) {
      throw new SlideParseError(
        `"${key}" must be one of ${spec.values.join(', ')}; got "${String(value)}".`,
        file,
        line,
      )
    }

    out[key] = value
  }
  return out
}

function unknownKey(key: string, valid: string[], file: string, line: number): SlideParseError {
  const suggestion = closest(key, valid)
  const hint = suggestion ? `Did you mean "${suggestion}"?` : `Valid keys: ${[...valid].sort().join(', ')}.`
  return new SlideParseError(`unknown frontmatter key "${key}". ${hint}`, file, line)
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list'
  if (value === null) return 'null'
  return typeof value
}
