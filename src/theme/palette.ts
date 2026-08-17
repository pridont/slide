import { readFileSync } from 'node:fs'
import { resolveTokensStylesheet } from '../build/runtime-entry.js'
import type { Theme } from './tokens.js'

/**
 * The deck's tokens as concrete values.
 *
 * Everything else in the tool hands the browser `var(--slide-…)` and lets the
 * cascade do the work. Diagrams cannot: mermaid derives most of its palette
 * from a handful of roots by lightening and darkening them, which needs a real
 * colour rather than a reference to one. So the token file is read, the `var()`
 * chains are followed, and what comes out is a plain map of resolved values.
 *
 * Read from `tokens.css` rather than restated here so the two cannot drift —
 * the same reason `THEME_TOKENS` is diffed against it in a test.
 */
export type Palette = Readonly<Record<string, string>>

export type ColorScheme = 'dark' | 'light'

/**
 * Per-slide `class: theme-lilac` is deliberately not applied. A diagram's
 * colours are baked when it is rendered, and a slide class lands on the slide's
 * own `<main>` long afterwards; the deck's accent is what a diagram follows.
 */
export function resolvePalette(theme: Theme | undefined, colorScheme: ColorScheme | undefined): Palette {
  const base = { ...tokenFile()[colorScheme === 'light' ? 'light' : 'dark'] }

  for (const [key, value] of Object.entries(theme ?? {})) base[key] = value

  const resolved: Record<string, string> = {}
  for (const key of Object.keys(base)) resolved[key] = follow(key, base, new Set())
  return resolved
}

/** `var(--slide-color-accent)` → `var(--slide-color-apricot)` → `#e6a878`. */
function follow(key: string, tokens: Record<string, string>, seen: Set<string>): string {
  const value = tokens[key]
  if (value === undefined || seen.has(key)) return value ?? ''
  seen.add(key)

  return value.replace(
    /var\(\s*--slide-([\w-]+)\s*(?:,([^)]*))?\)/g,
    (_match, name: string, fallback?: string) =>
      tokens[name] === undefined ? (fallback ?? '').trim() : follow(name, tokens, seen),
  )
}

interface TokenFile {
  readonly dark: Record<string, string>
  readonly light: Record<string, string>
}

let parsed: TokenFile | undefined

function tokenFile(): TokenFile {
  parsed ??= parseTokens(readFileSync(resolveTokensStylesheet(), 'utf8'))
  return parsed
}

/**
 * Only `:root` and `:root.light` are read. The accent classes further down the
 * file are per-slide, which a baked diagram cannot follow anyway.
 */
export function parseTokens(css: string): TokenFile {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

  const dark = declarations(block(withoutComments, ':root'))
  const light = { ...dark, ...declarations(block(withoutComments, ':root.light')) }

  return { dark, light }
}

/** The body of the first rule with exactly this selector. */
function block(css: string, selector: string): string {
  const pattern = new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`)
  return pattern.exec(css)?.[2] ?? ''
}

function declarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const line of body.split(';')) {
    const match = /^\s*--slide-([\w-]+)\s*:\s*([\s\S]+)$/.exec(line)
    if (match?.[1] && match[2]) tokens[match[1]] = match[2].trim()
  }
  return tokens
}
