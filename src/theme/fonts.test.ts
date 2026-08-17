import { describe, expect, it } from 'vitest'
import { SlideParseError } from '../parse/errors.js'
import { faceKey, fontFaceRules, validateFonts } from './fonts.js'

const WHERE = { file: '/deck.md', line: 3 }
const hashed = (ref: string): string => `/assets/${ref.replace('./', '')}-abc123`

describe('declaring fonts', () => {
  it('takes a family and a file', () => {
    expect(validateFonts({ Inter: './inter.woff2' }, WHERE)).toEqual([
      { family: 'Inter', src: './inter.woff2' },
    ])
  })

  it('takes several faces of one family', () => {
    const faces = validateFonts(
      { Inter: [{ src: './regular.woff2' }, { src: './bold.woff2', weight: 700, style: 'italic' }] },
      WHERE,
    )

    expect(faces).toEqual([
      { family: 'Inter', src: './regular.woff2' },
      { family: 'Inter', src: './bold.woff2', weight: '700', style: 'italic' },
    ])
  })

  it('keeps a variable font’s weight range', () => {
    const [face] = validateFonts({ Inter: [{ src: './var.woff2', weight: '300 800' }] }, WHERE)
    expect(face?.weight).toBe('300 800')
  })

  it('refuses a face with no file', () => {
    expect(() => validateFonts({ Inter: [{ weight: 700 }] }, WHERE)).toThrow(/needs a `src` file path/)
  })

  it('suggests a real key for a mistyped one', () => {
    expect(() => validateFonts({ Inter: [{ src: './a.woff2', wieght: 700 }] }, WHERE)).toThrow(
      /unknown font key "wieght" under "Inter"\. Did you mean "weight"\?/,
    )
  })

  it('rejects a style or display outside the set', () => {
    expect(() => validateFonts({ Inter: [{ src: './a.woff2', style: 'slanted' }] }, WHERE)).toThrow(
      /must be one of normal, italic, oblique/,
    )
    expect(() => validateFonts({ Inter: [{ src: './a.woff2', display: 'eventually' }] }, WHERE)).toThrow(
      /must be one of auto, block, swap, fallback, optional/,
    )
  })

  it('refuses a face hosted somewhere else', () => {
    // The point of the feature is a deck that keeps working offline; a remote
    // URL is also outside anything the build can hash or check.
    expect(() => validateFonts({ Inter: 'https://fonts.example/inter.woff2' }, WHERE)).toThrow(
      /Font files have to be part of the deck/,
    )
  })

  it('anchors an error on the deck line that declared it', () => {
    expect(() => validateFonts({ Inter: 42 }, WHERE)).toThrow(SlideParseError)
    expect(() => validateFonts({ Inter: 42 }, WHERE)).toThrow(/deck\.md:3/)
  })
})

describe('the rules they turn into', () => {
  it('resolves the file and names the format', () => {
    const [rule] = fontFaceRules(validateFonts({ Inter: './inter.woff2' }, WHERE), hashed)

    expect(rule).toBe(
      '@font-face{font-family:"Inter";src:url("/assets/inter.woff2-abc123") format("woff2");' +
        'font-style:normal;font-weight:normal;font-display:swap}',
    )
  })

  it('defaults display to swap, so a slide never waits on a font', () => {
    const [rule] = fontFaceRules(
      validateFonts({ Inter: [{ src: './a.ttf', display: 'block' }] }, WHERE),
      hashed,
    )
    expect(rule).toContain('font-display:block')
    expect(rule).toContain('format("truetype")')
  })

  it('cannot be broken out of by a family name', () => {
    const faces = validateFonts({ 'Ev"il}html{display:none': './a.woff2' }, WHERE)
    const [rule] = fontFaceRules(faces, hashed)

    expect(rule).toContain('font-family:"Ev\\"il}html{display:none"')
    // The brace is inside a string, so the rule still closes where it should.
    expect(rule?.endsWith('font-display:swap}')).toBe(true)
  })

  it('treats weight and style as what makes two faces different', () => {
    const [regular, bold] = validateFonts(
      { Inter: [{ src: './a.woff2' }, { src: './b.woff2', weight: 700 }] },
      WHERE,
    )

    expect(faceKey(regular!)).not.toBe(faceKey(bold!))
    expect(faceKey(regular!)).toBe(faceKey({ family: 'inter', src: './elsewhere.woff2' }))
  })
})
