import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SlideParseError } from '../parse/errors.js'
import { THEME_TOKENS, canonicalTokenName, themeDeclarations, validateTheme } from './tokens.js'

const WHERE = { file: '/deck.md', line: 3 }

function declaredInStylesheet(): string[] {
  const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
  const names = new Set<string>()
  for (const match of css.matchAll(/^\s+--slide-([a-z0-9-]+)\s*:/gm)) names.add(match[1]!)
  return [...names].sort()
}

describe('the overridable token list', () => {
  it('is exactly what the stylesheet declares', () => {
    // The list is written out rather than scraped so a typo can be met with a
    // suggestion. This is what keeps the two from drifting.
    expect([...THEME_TOKENS].sort()).toEqual(declaredInStylesheet())
  })
})

describe('token names', () => {
  it('accepts the three spellings of one token', () => {
    expect(canonicalTokenName('colorAccent')).toBe('color-accent')
    expect(canonicalTokenName('color-accent')).toBe('color-accent')
    expect(canonicalTokenName('--slide-color-accent')).toBe('color-accent')
  })

  it('normalises every spelling on the way in', () => {
    const theme = validateTheme({ colorAccent: '#f90', '--slide-font-body': 'Georgia' }, WHERE)
    expect(theme).toEqual({ 'color-accent': '#f90', 'font-body': 'Georgia' })
  })
})

describe('rejecting a bad theme', () => {
  it('names the deck line and suggests a real token', () => {
    expect(() => validateTheme({ colorAcent: '#f90' }, WHERE)).toThrow(/unknown theme token "colorAcent"/)
    expect(() => validateTheme({ colorAcent: '#f90' }, WHERE)).toThrow(/Did you mean "color-accent"\?/)
    expect(() => validateTheme({ colorAcent: '#f90' }, WHERE)).toThrow(SlideParseError)
  })

  it('falls back to describing the set when nothing is close', () => {
    expect(() => validateTheme({ wallpaper: 'blue' }, WHERE)).toThrow(/e\.g\. color-accent/)
  })

  it('points at the config file when that is where the theme came from', () => {
    const error = catchError(() => validateTheme({ nope: '1' }, { config: 'slide.config.ts' }))
    expect(error).not.toBeInstanceOf(SlideParseError)
    expect(error?.message).toContain('slide.config.ts')
  })

  it('refuses a value that is not a scalar', () => {
    expect(() => validateTheme({ 'color-bg': { r: 1 } }, WHERE)).toThrow(/must be a string or a number/)
  })

  it('keeps a number, which is what YAML makes of `font-size: 2.4`', () => {
    expect(validateTheme({ fontSize: 2.4 }, WHERE)).toEqual({ 'font-size': '2.4' })
  })

  it('drops a key set to nothing rather than emitting an empty declaration', () => {
    expect(validateTheme({ colorAccent: null, colorBg: '  ' }, WHERE)).toEqual({})
  })
})

describe('declarations', () => {
  it('cannot be broken out of by a stray brace', () => {
    const theme = validateTheme({ colorBg: 'red} html{display:none' }, WHERE)
    const css = themeDeclarations(theme)
    expect(css).not.toContain('{')
    expect(css).not.toContain('}')
  })

  it('are ordered by name, so the same theme hashes to the same file', () => {
    const a = themeDeclarations(validateTheme({ colorBg: '#000', colorAccent: '#f90' }, WHERE))
    const b = themeDeclarations(validateTheme({ colorAccent: '#f90', colorBg: '#000' }, WHERE))
    expect(a).toBe(b)
    expect(a).toBe('--slide-color-accent:#f90;--slide-color-bg:#000')
  })

  it('are empty for a deck with no theme at all', () => {
    expect(themeDeclarations(undefined)).toBe('')
  })
})

function catchError(run: () => unknown): Error | null {
  try {
    run()
    return null
  } catch (error) {
    return error as Error
  }
}
