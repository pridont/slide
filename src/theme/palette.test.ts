import { describe, expect, it } from 'vitest'
import { mermaidThemeVariables } from './mermaid.js'
import { parseTokens, resolvePalette } from './palette.js'

describe('resolving the palette', () => {
  it('follows a var() chain to a real colour', () => {
    // A diagram is handed colours, not references: mermaid derives most of its
    // palette by lightening and darkening the roots, which var() cannot do.
    const palette = resolvePalette(undefined, 'dark')

    expect(palette['color-accent']).toMatch(/^#[0-9a-f]{6}$/i)
    expect(palette['color-accent']).toBe(palette['color-apricot'])
    expect(palette['color-bg']).toBe(palette['ink-bg'])
  })

  it('swaps the derived tokens for the light scheme', () => {
    const dark = resolvePalette(undefined, 'dark')
    const light = resolvePalette(undefined, 'light')

    expect(light['color-bg']).toBe(light['paper-bg'])
    expect(light['color-bg']).not.toBe(dark['color-bg'])
    expect(light['color-accent']).toBe(light['apricot-base'])
  })

  it('feeds a raw palette override through to the tokens derived from it', () => {
    // The same reason the generated rules land on <html>: override a raw token
    // and everything deriving from it has to follow.
    const palette = resolvePalette({ 'paper-bg': '#fff3e0' }, 'light')

    expect(palette['color-bg']).toBe('#fff3e0')
  })

  it('takes a semantic override as written', () => {
    expect(resolvePalette({ 'color-accent': '#123456' }, 'dark')['color-accent']).toBe('#123456')
  })

  it('reads only :root and :root.light', () => {
    const { dark, light } = parseTokens(
      ':root{--slide-a:1;--slide-b:var(--slide-a)}\n' +
        ':root.light{--slide-a:2}\n' +
        // Per-slide accent classes cannot reach a diagram baked at build time.
        '.theme-lilac{--slide-a:3}',
    )

    expect(dark).toEqual({ a: '1', b: 'var(--slide-a)' })
    expect(light['a']).toBe('2')
  })
})

describe('the mermaid theme map', () => {
  it('points mermaid at the deck tokens for every root it derives from', () => {
    const palette = resolvePalette(undefined, 'dark')
    const variables = mermaidThemeVariables(palette)

    expect(variables.primaryColor).toBe(palette['color-panel'])
    expect(variables.primaryTextColor).toBe(palette['color-fg'])
    expect(variables.primaryBorderColor).toBe(palette['color-accent'])
    expect(variables.lineColor).toBe(palette['color-muted'])
  })

  it('never paints a background — the slide already did', () => {
    expect(mermaidThemeVariables(resolvePalette(undefined, 'dark')).background).toBe('transparent')
  })

  it('uses the accent trio as the categorical series, at full strength', () => {
    const palette = resolvePalette(undefined, 'dark')
    const variables = mermaidThemeVariables(palette)

    expect(variables.pie1).toBe(palette['color-apricot'])
    expect(variables.pie2).toBe(palette['color-lilac'])
    expect(variables.pie3).toBe(palette['color-cyan'])
    expect(variables.pie4).toBe(palette['color-apricot'])
    // Mermaid washes slices out to 0.7 by default, undoing the contrast the
    // accents were tuned for.
    expect(variables.pieOpacity).toBe('1')
  })

  it('changes with the deck', () => {
    const recoloured = mermaidThemeVariables(resolvePalette({ 'color-accent': '#123456' }, 'dark'))

    expect(recoloured.primaryBorderColor).toBe('#123456')
  })
})
