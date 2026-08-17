import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { renderSlidePage } from './index.js'
import { applyLayout, LAYOUT_NAMES } from './layouts.js'
import { createMarkdown, renderMarkdown } from './markdown.js'

/** Enough of a slide to show what a layout does with each part of one. */
const BODY = `#### Kicker

## A heading

Some prose with \`code\` and a [link](https://example.com).

- first
- second

> Something said

Attribution

::: right

Content for a second column.
`

const md = createMarkdown()

function layout(name: string): string {
  const source = `---\nlayout: ${name}\n${name.startsWith('image-') ? 'image: ./photo.png\nimageAlt: A photo\n' : ''}---\n\n${BODY}`
  const deck = parseDeck(source, '/deck.md')
  const slide = deck.slides[0]!
  const { html, regions } = renderMarkdown(md, slide.body, (ref) => `/assets/${ref.replace('./', '')}`)

  return applyLayout({
    html,
    regions,
    slide,
    deck,
    ...(name.startsWith('image-') ? { image: '/assets/photo.png' } : {}),
  })
}

describe('what each layout makes of the same slide', () => {
  // One snapshot per layout: the structure is the contract the stylesheet is
  // written against, and a change to either should be seen and agreed to.
  for (const name of LAYOUT_NAMES) {
    it(name, () => {
      expect(layout(name)).toMatchSnapshot()
    })
  }
})

describe('the example deck', () => {
  it('parses to the shape the tests and the stylesheet assume', async () => {
    const file = fileURLToPath(new URL('../../examples/basic.md', import.meta.url))
    const deck = parseDeck(await readFile(file, 'utf8'), file)

    expect(deck.warnings).toEqual([])
    expect(deck.meta.title).toBe('Slide')
    expect(deck.slides).not.toHaveLength(0)
    expect(deck.slides.map((slide) => slide.index)).toEqual(deck.slides.map((_, i) => i + 1))

    // Every layout the deck asks for is one that exists, and every slide it
    // says has notes really has them.
    const layouts = new Set(deck.slides.map((slide) => slide.meta.layout).filter(Boolean))
    for (const name of layouts) expect(LAYOUT_NAMES).toContain(name)
    expect(deck.slides.filter((slide) => slide.notes !== null).length).toBeGreaterThan(0)

    // The shape of the first slide, which the cover layout is written for.
    expect(deck.slides[0]?.meta.layout).toBe('cover')
  })

  it('renders every one of its slides without complaint', async () => {
    const file = fileURLToPath(new URL('../../examples/basic.md', import.meta.url))
    const deck = parseDeck(await readFile(file, 'utf8'), file)

    for (const slide of deck.slides) {
      const html = renderSlidePage({
        deck,
        slide,
        deckId: 'deck',
        resolveAsset: (ref) => ref,
        href: (index) => `/${index}/`,
        assets: { styles: [], modules: [], head: '/head.js' },
      })
      // The one invariant every page has, whatever the slide contains.
      expect(html).toContain(`data-slide="${slide.index}"`)
    }
  })
})
