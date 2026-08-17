import { SlideParseError } from '../parse/errors.js'
import { closest } from '../parse/suggest.js'

/**
 * What a `theme:` block may override: every custom property in tokens.css,
 * without the `--slide-` prefix. Listed rather than scraped so a typo gets a
 * suggestion; `tokens.test.ts` diffs the two so they cannot drift.
 */
export const THEME_TOKENS: readonly string[] = [
  // Raw palette
  'ink-bg',
  'ink-panel',
  'ink-fg',
  'ink-muted',
  'ink-backdrop',
  'paper-bg',
  'paper-panel',
  'paper-fg',
  'paper-muted',
  'paper-backdrop',
  'apricot-base',
  'apricot-lift',
  'lilac-base',
  'lilac-lift',
  'cyan-base',
  'cyan-lift',
  // Semantic colour
  'color-bg',
  'color-panel',
  'color-fg',
  'color-muted',
  'color-backdrop',
  'color-apricot',
  'color-lilac',
  'color-cyan',
  'color-accent',
  'color-accent-contrast',
  'rule',
  'rule-strong',
  // Syntax
  'syn-comment',
  'syn-keyword',
  'syn-function',
  'syn-string',
  'syn-number',
  'syn-class',
  'syn-builtin',
  'syn-property',
  'syn-punct',
  // Type
  'font-body',
  'font-heading',
  'font-mono',
  'font-size',
  'fs-display',
  'fs-h1',
  'fs-h2',
  'fs-h3',
  'fs-small',
  'fs-mono',
  'lh-tight',
  'lh-heading',
  'lh-body',
  'tracking-tight',
  'tracking-mono',
  'tracking-kicker',
  // Space and motion
  'padding',
  'gap',
  'radius-panel',
  'radius-code',
  'radius-pill',
  'transition-duration',
  'transition-easing',
]

const TOKEN_SET = new Set(THEME_TOKENS)

/** Shows the shape of a name without printing all sixty. */
const EXAMPLES = ['color-accent', 'color-bg', 'font-body', 'font-size']

export type Theme = Record<string, string>

/**
 * Normalise and check a `theme:` mapping. Keys come back in canonical short
 * form, so the emitter has one shape to deal with; `where` anchors an unknown
 * key on the source that wrote it.
 */
export function validateTheme(value: Record<string, unknown>, where: ThemeSource): Theme {
  const theme: Theme = {}

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = canonicalTokenName(rawKey)
    if (!TOKEN_SET.has(key)) throw unknownToken(rawKey, key, where)
    if (rawValue === null || rawValue === undefined) continue

    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
      throw fail(`theme token "${rawKey}" must be a string or a number, got ${describe(rawValue)}.`, where)
    }

    // As elsewhere in the generated CSS: strip what could close the
    // declaration and open a rule. A nonsense value is the author's own.
    const text = String(rawValue)
      .replace(/[{};<>]/g, '')
      .trim()
    if (text === '') continue

    theme[key] = text
  }

  return theme
}

/** `colorAccent`, `color-accent` and `--slide-color-accent` all mean the same. */
export function canonicalTokenName(key: string): string {
  return key
    .trim()
    .replace(/^--/, '')
    .replace(/^slide-/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

/** CSS declarations for a theme, in a stable order so the hash is stable. */
export function themeDeclarations(theme: Theme | undefined): string {
  if (!theme) return ''
  return Object.keys(theme)
    .sort()
    .map((key) => `--slide-${key}:${theme[key]!}`)
    .join(';')
}

/** Where a theme came from, so an error can point back at it. */
export type ThemeSource = { readonly file: string; readonly line: number } | { readonly config: string }

function fail(message: string, where: ThemeSource): Error {
  return 'config' in where
    ? new Error(`slide: ${where.config}: ${message}`)
    : new SlideParseError(message, where.file, where.line)
}

function unknownToken(rawKey: string, canonical: string, where: ThemeSource): Error {
  const suggestion = closest(canonical, THEME_TOKENS)
  const hint = suggestion
    ? `Did you mean "${suggestion}"?`
    : `A theme token is one of the ${THEME_TOKENS.length} theme custom properties, e.g. ${EXAMPLES.join(', ')}.`
  return fail(`unknown theme token "${rawKey}". ${hint}`, where)
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list'
  if (value === null) return 'null'
  return typeof value
}
