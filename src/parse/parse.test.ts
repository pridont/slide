import { describe, expect, it } from 'vitest'
import { SlideParseError, parseDeck } from './index.js'

const FILE = '/deck.md'

function bodies(source: string): string[] {
  return parseDeck(source, FILE).slides.map((slide) => slide.body)
}

describe('slide separators', () => {
  it('splits on a blank-preceded `---`', () => {
    expect(bodies('# One\n\n---\n\n# Two\n')).toEqual(['# One', '# Two'])
  })

  it('keeps a single slide when there is no separator', () => {
    expect(bodies('# Only\n\ntext\n')).toEqual(['# Only\n\ntext'])
  })

  it('does not split a setext heading', () => {
    expect(bodies('Title\n---\n\nbody\n')).toEqual(['Title\n---\n\nbody'])
  })

  it('does not split on a thematic break of four or more dashes', () => {
    expect(bodies('# One\n\n----\n\n# Two\n')).toEqual(['# One\n\n----\n\n# Two'])
  })

  it('ignores `---` inside a fenced code block', () => {
    const source = '# One\n\n```yaml\n\n---\n\n```\n\n---\n\n# Two\n'
    expect(bodies(source)).toEqual(['# One\n\n```yaml\n\n---\n\n```', '# Two'])
  })

  it('ignores `---` inside a tilde fence', () => {
    expect(bodies('~~~\n\n---\n\n~~~\n')).toEqual(['~~~\n\n---\n\n~~~'])
  })

  it('ignores `---` inside a multi-line HTML comment', () => {
    const source = '# One\n\n<!--\n\n---\n\n-->\n\n---\n\n# Two\n'
    expect(bodies(source)).toEqual(['# One', '# Two'])
  })

  it('handles CRLF line endings', () => {
    expect(bodies('# One\r\n\r\n---\r\n\r\n# Two\r\n')).toEqual(['# One', '# Two'])
  })

  it('drops empty slides produced by leading and trailing separators', () => {
    expect(bodies('---\n\n# One\n\n---\n')).toEqual(['# One'])
  })

  it('numbers slides from one', () => {
    const deck = parseDeck('a\n\n---\n\nb\n\n---\n\nc\n', FILE)
    expect(deck.slides.map((s) => s.index)).toEqual([1, 2, 3])
  })

  it('records the source line each slide starts on', () => {
    const deck = parseDeck('# One\n\n---\n\n# Two\n', FILE)
    expect(deck.slides.map((s) => s.sourceLine)).toEqual([1, 5])
  })
})

describe('deck frontmatter', () => {
  it('parses the leading block', () => {
    const deck = parseDeck('---\ntitle: Talk\ndescription: About\n---\n\n# One\n', FILE)
    expect(deck.meta).toEqual({ title: 'Talk', description: 'About' })
    expect(deck.slides).toHaveLength(1)
    expect(deck.slides[0]!.body).toBe('# One')
  })

  it('routes slide-level keys in the leading block to slide 1', () => {
    const deck = parseDeck('---\ntitle: Talk\nlayout: cover\n---\n\n# One\n\n---\n\n# Two\n', FILE)
    expect(deck.meta).toEqual({ title: 'Talk' })
    expect(deck.slides[0]!.meta).toEqual({ layout: 'cover' })
    expect(deck.slides[1]!.meta).toEqual({})
  })

  it('rejects an unknown key with a suggestion', () => {
    expect(() => parseDeck('---\nlayuot: cover\n---\n\n# One\n', FILE)).toThrow(/Did you mean "layout"/)
  })

  it('rejects a wrongly typed value', () => {
    expect(() => parseDeck('---\ntitle: 42\n---\n\n# One\n', FILE)).toThrow(
      /"title" must be a string, got number/,
    )
  })

  it('maps YAML errors back to the file line', () => {
    let thrown: unknown
    try {
      // The tab is on file line 4; the block starts on file line 2.
      parseDeck('---\ntitle: Talk\ndescription: x\n\tbad: 3\n---\n\n# One\n', FILE)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SlideParseError)
    expect((thrown as SlideParseError).line).toBe(4)
    expect((thrown as SlideParseError).message).toMatch(/^\/deck\.md:4 invalid YAML/)
  })
})

describe('slide frontmatter', () => {
  it('parses a block after a separator', () => {
    const deck = parseDeck('# One\n\n---\nlayout: cover\nclass: dark\n---\n\n# Two\n', FILE)
    expect(deck.slides[1]!.meta).toEqual({ layout: 'cover', class: 'dark' })
    expect(deck.slides[1]!.body).toBe('# Two')
  })

  it('treats an all-unknown-keys block as content and warns', () => {
    const deck = parseDeck('# One\n\n---\nNote: remember this\n---\n\nbody\n', FILE)
    expect(deck.slides[1]!.body).toBe('Note: remember this\n---\n\nbody')
    expect(deck.warnings).toHaveLength(1)
    expect(deck.warnings[0]!.line).toBe(4)
  })

  it('errors when a known key sits next to an unknown one', () => {
    expect(() => parseDeck('# One\n\n---\nlayout: cover\nlayuot: x\n---\n\n# Two\n', FILE)).toThrow(
      /unknown frontmatter key "layuot"/,
    )
  })

  it('does not read prose separated by a blank line as frontmatter', () => {
    const deck = parseDeck('# One\n\n---\n\n# Two\n\nName: value\n---\n', FILE)
    expect(deck.slides[1]!.meta).toEqual({})
    expect(deck.slides[1]!.body).toBe('# Two\n\nName: value\n---')
  })
})

describe('speaker notes', () => {
  it('extracts a trailing comment', () => {
    const deck = parseDeck('# One\n\n<!-- say hello -->\n', FILE)
    expect(deck.slides[0]!.body).toBe('# One')
    expect(deck.slides[0]!.notes).toBe('say hello')
  })

  it('extracts a multi-line trailing comment', () => {
    const deck = parseDeck('# One\n\n<!--\nfirst\nsecond\n-->\n', FILE)
    expect(deck.slides[0]!.notes).toBe('first\nsecond')
    expect(deck.slides[0]!.body).toBe('# One')
  })

  it('leaves a comment in the middle of a slide alone', () => {
    const deck = parseDeck('# One\n\n<!-- inline -->\n\ntext\n', FILE)
    expect(deck.slides[0]!.notes).toBeNull()
    expect(deck.slides[0]!.body).toBe('# One\n\n<!-- inline -->\n\ntext')
  })

  it('ignores a comment inside a code fence', () => {
    const deck = parseDeck('# One\n\n```html\n<!-- markup -->\n```\n', FILE)
    expect(deck.slides[0]!.notes).toBeNull()
  })

  it('prefers frontmatter notes over a trailing comment', () => {
    const deck = parseDeck('# One\n\n---\nnotes: from meta\n---\n\n# Two\n\n<!-- from comment -->\n', FILE)
    expect(deck.slides[1]!.notes).toBe('from meta')
  })
})
