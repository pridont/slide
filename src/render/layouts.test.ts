import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { renderSlidePage } from './index.js'

const FILE = '/deck.md'

function slide(source: string, templates?: Record<string, string>): string {
  const deck = parseDeck(source, FILE)
  return renderSlidePage({
    deck,
    slide: deck.slides[0]!,
    resolveAsset: (ref) => `/assets/${ref.replace('./', '')}-hashed`,
    href: (index) => `/${index}/`,
    assets: { styles: [], scripts: [] },
    ...(templates ? { templates } : {}),
  })
}

function main(html: string): string {
  return /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? ''
}

describe('the layouts that only restyle', () => {
  it('name themselves on the slide element', () => {
    for (const name of ['center', 'section', 'quote', 'cover']) {
      expect(slide(`---\nlayout: ${name}\n---\n\n# One\n`)).toContain(`class="slide layout-${name}"`)
    }
  })

  it('keep a slide class beside the layout class', () => {
    expect(slide('---\nlayout: center\nclass: theme-lilac\n---\n\n# One\n')).toContain(
      'class="slide layout-center theme-lilac"',
    )
  })

  it('leave the content where it was', () => {
    expect(slide('---\nlayout: quote\n---\n\n> Something said\n\nSomeone\n')).toContain('<blockquote>')
  })
})

describe('two columns', () => {
  it('splits at `::: right`, with no closing fence needed', () => {
    const html = main(slide('---\nlayout: two-cols\n---\n\n# Left\n\n::: right\n\n# Right\n'))

    expect(html).toContain('class="slide-content slide-cols"')
    expect(html.indexOf('<h1>Left</h1>')).toBeLessThan(html.indexOf('<h1>Right</h1>'))
    // Each column is its own box, so the grid has two cells rather than six.
    expect(html.match(/class="slide-col"/g)).toHaveLength(2)
  })

  it('closes the region when the author does, and carries on in the first column', () => {
    const html = main(
      slide('---\nlayout: two-cols\n---\n\nfirst\n\n::: right\naside\n:::\n\nback to first\n'),
    )

    const [left = '', right = ''] = html.split('<div class="slide-col"><p>aside</p>')
    expect(left).toContain('first')
    expect(left).toContain('back to first')
    expect(right).not.toContain('back to first')
  })

  it('reads as one column when nothing splits it', () => {
    const html = main(slide('---\nlayout: two-cols\n---\n\nonly this\n'))

    expect(html).toContain('only this')
    expect(html.match(/class="slide-col"/g)).toHaveLength(2)
  })

  it('keeps region content out of the main flow', () => {
    // Otherwise it would render twice: once in place, once in its column.
    const html = main(slide('---\nlayout: default\n---\n\nmain\n\n::: right\naside\n:::\n'))

    expect(html).toContain('main')
    expect(html).not.toContain('aside')
  })
})

describe('the image layouts', () => {
  it('put the picture on the side the name says', () => {
    const right = main(slide('---\nlayout: image-right\nimage: ./cat.png\nimageAlt: A cat\n---\n\n# Words\n'))
    const left = main(slide('---\nlayout: image-left\nimage: ./cat.png\n---\n\n# Words\n'))

    // The full attribute, or `slide-col` also matches inside `slide-cols`.
    expect(right.indexOf('"slide-col"')).toBeLessThan(right.indexOf('"slide-figure"'))
    expect(left.indexOf('"slide-figure"')).toBeLessThan(left.indexOf('"slide-col"'))
  })

  it('resolve the image through the asset pipeline, with its alt text', () => {
    const html = main(slide('---\nlayout: image-right\nimage: ./cat.png\nimageAlt: A cat\n---\n\n# Words\n'))

    expect(html).toContain('<img src="/assets/cat.png-hashed" alt="A cat">')
    // Sized by CSS: a width attribute or a style would both be wrong here.
    expect(html).not.toContain('style=')
    expect(html).not.toContain('width=')
  })

  it('say so when the slide forgot the image', () => {
    expect(() => slide('---\nlayout: image-right\n---\n\n# Words\n')).toThrow(
      /layout "image-right" needs an `image:` in the slide's frontmatter/,
    )
  })
})

describe("a layout of the deck's own", () => {
  const TEMPLATE =
    '<div class="slide-content card"><figure><img src="{{image}}" alt="{{alt}}"></figure>{{content}}</div>'

  it('is used by name, inside the usual slide element', () => {
    const html = main(slide('---\nlayout: card\nimage: ./cat.png\n---\n\n# Hello\n', { card: TEMPLATE }))

    // The <main> stays ours, so backgrounds and `class:` keep working.
    expect(html).toContain('<main class="slide layout-card"')
    expect(html).toContain('class="slide-content card"')
    expect(html).toContain('src="/assets/cat.png-hashed"')
    expect(html).toContain('<h1>Hello</h1>')
  })

  it('can place a region by name', () => {
    const html = main(
      slide('---\nlayout: split\n---\n\nmain\n\n::: right\naside\n:::\n', {
        split: '<div class="slide-content"><div>{{content}}</div><div>{{right}}</div></div>',
      }),
    )

    expect(html).toContain('<p>main</p>')
    expect(html).toContain('<p>aside</p>')
  })

  it('refuses a placeholder that is not a thing a slide has', () => {
    // A typo that rendered nothing would be a slide gone quietly missing.
    expect(() => slide('---\nlayout: card\n---\n\n# Hello\n', { card: '{{contnet}}' })).toThrow(
      /asks for \{\{contnet\}\}, which is not something a slide has/,
    )
  })

  it('joins the list an unknown layout is measured against', () => {
    expect(() => slide('---\nlayout: nope\n---\n\n# One\n', { card: TEMPLATE })).toThrow(
      /Available layouts: card, center, cover/,
    )
  })
})
