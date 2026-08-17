import { SlideParseError } from '../parse/errors.js'
import { closest } from '../parse/suggest.js'
import type { ThemeSource } from './tokens.js'

/**
 * Deck-supplied webfonts.
 *
 * The default theme asks for no font files at all — it names system faces, so
 * a deck costs zero font requests. A deck that wants its own declares them:
 *
 *     fonts:
 *       Inter: ./fonts/inter.woff2
 *       IBM Plex Mono:
 *         - src: ./fonts/plex-400.woff2
 *         - src: ./fonts/plex-700.woff2
 *           weight: 700
 *     theme:
 *       fontBody: Inter, sans-serif
 *
 * Declaring a family only loads it; pointing a token at it is what uses it.
 * The two are separate because a family can back any token, and a token can
 * name faces the deck did not supply.
 */
export interface FontFace {
  readonly family: string
  /** Markdown-relative reference, resolved through the asset pipeline. */
  readonly src: string
  readonly weight?: string
  readonly style?: string
  readonly display?: string
  readonly unicodeRange?: string
}

const FACE_FIELDS = ['src', 'weight', 'style', 'display', 'unicodeRange'] as const
const STYLES = ['normal', 'italic', 'oblique']
const DISPLAYS = ['auto', 'block', 'swap', 'fallback', 'optional']

const FORMATS: Record<string, string> = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
}

/** Normalise and check a `fonts:` mapping of family name to file, or to faces. */
export function validateFonts(value: Record<string, unknown>, where: ThemeSource): FontFace[] {
  const faces: FontFace[] = []

  for (const [rawFamily, declared] of Object.entries(value)) {
    const family = rawFamily.trim()
    if (family === '') throw fail('a font family needs a name.', where)

    const list = Array.isArray(declared) ? declared : [declared]
    if (list.length === 0) throw fail(`"${family}" lists no font files.`, where)

    for (const entry of list) {
      faces.push(face(family, entry, where))
    }
  }

  return faces
}

function face(family: string, entry: unknown, where: ThemeSource): FontFace {
  // The short form: one file, everything else left to the defaults.
  if (typeof entry === 'string') return { family, src: source(family, entry, where) }

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw fail(`"${family}" must be a file path, or a list of faces with a \`src\` each.`, where)
  }

  const record = entry as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if ((FACE_FIELDS as readonly string[]).includes(key)) continue
    const suggestion = closest(key, FACE_FIELDS)
    const hint = suggestion ? `Did you mean "${suggestion}"?` : `Valid keys: ${FACE_FIELDS.join(', ')}.`
    throw fail(`unknown font key "${key}" under "${family}". ${hint}`, where)
  }

  if (typeof record.src !== 'string') throw fail(`"${family}" needs a \`src\` file path.`, where)

  return {
    family,
    src: source(family, record.src, where),
    ...optional(
      'weight',
      scalar(record.weight, family, 'weight', where)
        ?.replace(/[^\d\s]/g, '')
        .trim(),
    ),
    ...optional('style', keyword(record.style, STYLES, family, 'style', where)),
    ...optional('display', keyword(record.display, DISPLAYS, family, 'display', where)),
    ...optional(
      'unicodeRange',
      scalar(record.unicodeRange, family, 'unicodeRange', where)?.replace(/[^\dA-Fa-f+,\-? ]/g, ''),
    ),
  }
}

function source(family: string, ref: string, where: ThemeSource): string {
  const trimmed = ref.trim()
  if (trimmed === '') throw fail(`"${family}" needs a \`src\` file path.`, where)
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    // A remote face would undo the point of self-hosting: the deck stops
    // working offline, and the fetch is not in the build's control.
    throw fail(`"${family}" points at ${trimmed}. Font files have to be part of the deck.`, where)
  }
  return trimmed
}

function scalar(value: unknown, family: string, key: string, where: ThemeSource): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw fail(`"${family}" has a \`${key}\` that is not a string or a number.`, where)
  }
  return String(value)
}

function keyword(
  value: unknown,
  allowed: readonly string[],
  family: string,
  key: string,
  where: ThemeSource,
): string | undefined {
  const text = scalar(value, family, key, where)
  if (text === undefined) return undefined
  if (!allowed.includes(text)) {
    throw fail(`"${family}" has \`${key}: ${text}\`; it must be one of ${allowed.join(', ')}.`, where)
  }
  return text
}

function optional<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, string>)
}

/**
 * `@font-face` rules, with every `src` already resolved to a public URL.
 *
 * `swap` by default: a slide that waits on a font is a slide that renders
 * late, and the fallback metrics are the author's to live with.
 */
export function fontFaceRules(faces: readonly FontFace[], resolveAsset: (ref: string) => string): string[] {
  return faces.map((face) => {
    const url = resolveAsset(face.src)
    const format = FORMATS[extension(face.src)]

    const parts = [
      `font-family:"${cssString(face.family)}"`,
      `src:url("${cssString(url)}")${format ? ` format("${format}")` : ''}`,
      `font-style:${face.style ?? 'normal'}`,
      `font-weight:${face.weight ?? 'normal'}`,
      `font-display:${face.display ?? 'swap'}`,
      ...(face.unicodeRange ? [`unicode-range:${face.unicodeRange}`] : []),
    ]
    return `@font-face{${parts.join(';')}}`
  })
}

/** Two decks may declare the same face; they may not disagree about it. */
export function faceKey(face: FontFace): string {
  return [
    face.family.toLowerCase(),
    face.weight ?? 'normal',
    face.style ?? 'normal',
    face.unicodeRange ?? '',
  ].join('|')
}

function extension(ref: string): string {
  const path = ref.split(/[?#]/)[0] ?? ''
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

function cssString(value: string): string {
  return value.replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, '')
}

function fail(message: string, where: ThemeSource): Error {
  return 'config' in where
    ? new Error(`slide: ${where.config}: ${message}`)
    : new SlideParseError(message, where.file, where.line)
}
