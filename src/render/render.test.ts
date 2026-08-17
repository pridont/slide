import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { SlideParseError } from '../parse/errors.js'
import { renderSlidePage } from './index.js'
import { createMarkdown, renderMarkdown } from './markdown.js'

const FILE = '/deck.md'

/** Stand-in for the bundler: marks every reference it was asked to resolve. */
const resolveAsset = (ref: string): string => `/assets/${ref.replace(/^\.\//, '')}?hashed`

function renderBody(body: string): string {
  return renderMarkdown(createMarkdown(), body, resolveAsset).html
}

function renderFirstSlide(source: string): string {
  const deck = parseDeck(source, FILE)
  return renderSlidePage({
    deck,
    slide: deck.slides[0]!,
    resolveAsset,
    href: (index) => (index === 1 ? './' : `./${index}/`),
    assets: { styles: ['/base.css'], modules: ['/runtime.js'], head: '/head.js' },
    deckId: 'talk',
  })
}

describe('asset resolution', () => {
  it('rewrites relative image sources', () => {
    expect(renderBody('![alt](./photo.png)')).toContain('src="/assets/photo.png?hashed"')
  })

  it('keeps the alt text the default renderer would have produced', () => {
    expect(renderBody('![some *alt*](./photo.png)')).toContain('alt="some alt"')
  })

  it('leaves absolute and root-relative references alone', () => {
    const html = renderBody('![a](https://example.com/a.png)\n\n![b](/b.png)')
    expect(html).toContain('src="https://example.com/a.png"')
    expect(html).toContain('src="/b.png"')
  })

  it('rewrites references inside raw HTML', () => {
    expect(renderBody('<img src="./photo.png" alt="x">')).toContain('src="/assets/photo.png?hashed"')
  })

  it('rewrites references inside inline raw HTML', () => {
    expect(renderBody('text <img src="./inline.png"> more')).toContain('src="/assets/inline.png?hashed"')
  })

  it('preserves single-quoted raw HTML attributes', () => {
    expect(renderBody("<img src='./photo.png'>")).toContain("src='/assets/photo.png?hashed'")
  })

  it('resolves links that point straight at a file', () => {
    expect(renderBody('[paper](./paper.pdf)')).toContain('href="/assets/paper.pdf?hashed"')
  })

  it('leaves links to other pages for the router', () => {
    expect(renderBody('[next](./other.md)')).toContain('href="./other.md"')
  })

  it('marks external links safe to open in a new tab', () => {
    const html = renderBody('[out](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})

describe('layouts', () => {
  it('defaults to the default layout', () => {
    expect(renderFirstSlide('# One\n')).toContain('class="slide layout-default"')
  })

  it('applies the layout named in frontmatter', () => {
    expect(renderFirstSlide('---\nlayout: cover\n---\n\n# One\n')).toContain('class="slide layout-cover"')
  })

  it('appends the author class', () => {
    expect(renderFirstSlide('---\nclass: dark\n---\n\n# One\n')).toContain(
      'class="slide layout-default dark"',
    )
  })

  it('emits no inline style attribute for a background', () => {
    // Backgrounds moved to generated CSS so a strict `style-src` cannot break
    // them; the value itself is asserted in generated.test.ts.
    const html = renderFirstSlide('---\nbackground: "#101010"\n---\n\n# One\n')
    expect(html).toContain('<main class="slide layout-default" data-slide="1">')
    expect(html).not.toContain('style=')
  })

  it('leaves the slide addressable by deck and index, which the CSS keys on', () => {
    const html = renderFirstSlide('---\nbackground: ./bg.jpg\n---\n\n# One\n')
    expect(html).toContain('data-deck="talk"')
    expect(html).toContain('data-slide="1"')
  })

  it('rejects an unknown layout at the slide it came from', () => {
    let thrown: unknown
    try {
      renderFirstSlide('# One\n\n---\nlayout: nope\n---\n\n# Two\n')
    } catch (error) {
      thrown = error
    }
    // Slide 1 renders fine; the failure has to name slide 2's layout.
    expect(renderFirstSlide('# One\n')).toContain('layout-default')
    expect(() => {
      const deck = parseDeck('# One\n\n---\nlayout: nope\n---\n\n# Two\n', FILE)
      renderSlidePage({
        deck,
        slide: deck.slides[1]!,
        resolveAsset,
        href: () => './',
        assets: { styles: [], modules: [], head: '/head.js' },
      })
    }).toThrow(/unknown layout "nope"\. Available layouts: center, cover, default, full-image, image-left/)
    expect(thrown).toBeUndefined()
  })
})

describe('page shell', () => {
  it('builds a title from the heading and the deck title', () => {
    const html = renderFirstSlide('---\ntitle: Talk\n---\n\n## Intro\n')
    expect(html).toContain('<title>Intro · Talk</title>')
  })

  it('does not repeat a heading that matches the deck title', () => {
    expect(renderFirstSlide('---\ntitle: Talk\n---\n\n# Talk\n')).toContain('<title>Talk</title>')
  })

  it('falls back to the deck title when a slide has no heading', () => {
    expect(renderFirstSlide('---\ntitle: Talk\n---\n\njust text\n')).toContain('<title>Talk</title>')
  })

  it('ignores markdown emphasis in the captured heading', () => {
    expect(renderFirstSlide('# Hello *there*\n')).toContain('<title>Hello there</title>')
  })

  it('emits the description only on the first slide', () => {
    const deck = parseDeck('---\ntitle: Talk\ndescription: About\n---\n\n# One\n\n---\n\n# Two\n', FILE)
    const page = (index: number) =>
      renderSlidePage({
        deck,
        slide: deck.slides[index]!,
        resolveAsset,
        href: () => './',
        assets: { styles: [], modules: [], head: '/head.js' },
      })
    expect(page(0)).toContain('<meta name="description" content="About">')
    expect(page(1)).not.toContain('name="description"')
  })

  it('links assets in the head', () => {
    const html = renderFirstSlide('# One\n')
    expect(html).toContain('<link rel="stylesheet" href="/base.css">')
    expect(html).toContain('<script type="module" src="/runtime.js"></script>')
  })

  it('exposes navigation to the runtime as data attributes', () => {
    const deck = parseDeck('# One\n\n---\n\n# Two\n\n---\n\n# Three\n', FILE)
    const html = renderSlidePage({
      deck,
      slide: deck.slides[1]!,
      resolveAsset,
      href: (index) => (index === 1 ? './' : `./${index}/`),
      assets: { styles: [], modules: [], head: '/head.js' },
    })
    expect(html).toContain('data-slide="2"')
    expect(html).toContain('data-total="3"')
    expect(html).toContain('data-prev="./"')
    expect(html).toContain('data-next="./3/"')
    expect(html).toContain('<link rel="prev" href="./">')
  })

  it('omits navigation past the ends of the deck', () => {
    const html = renderFirstSlide('# Only\n')
    expect(html).not.toContain('data-prev')
    expect(html).not.toContain('data-next')
  })

  it('emits no inline style for the aspect ratio either', () => {
    expect(renderFirstSlide('---\naspectRatio: "4:3"\n---\n\n# One\n')).not.toContain('style=')
  })

  it('escapes title text coming from the source document', () => {
    expect(renderFirstSlide('# Tom & Jerry "live"\n')).toContain(
      '<title>Tom &amp; Jerry &quot;live&quot;</title>',
    )
  })

  it('escapes deck metadata', () => {
    expect(renderFirstSlide('---\ndescription: a "quoted" & <thing>\n---\n\n# One\n')).toContain(
      '<meta name="description" content="a &quot;quoted&quot; &amp; &lt;thing&gt;">',
    )
  })

  it('strips raw HTML out of the captured title', () => {
    // `html: true` is deliberate — authors embed markup — but the tags have no
    // business in a <title>.
    expect(renderFirstSlide('# <em>Emphatic</em>\n')).toContain('<title>Emphatic</title>')
  })
})

describe('SlideParseError plumbing', () => {
  it('reports the layout error against the deck file', () => {
    const deck = parseDeck('---\nlayout: nope\n---\n\n# One\n', FILE)
    try {
      renderSlidePage({
        deck,
        slide: deck.slides[0]!,
        resolveAsset,
        href: () => './',
        assets: { styles: [], modules: [], head: '/head.js' },
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SlideParseError)
      expect((error as SlideParseError).file).toBe(FILE)
    }
  })
})

describe('srcset', () => {
  it('resolves every candidate, not just the attribute', () => {
    const html = renderMarkdown(
      createMarkdown(),
      '<img src="./a.png" srcset="./a.png 1x, ./a@2x.png 2x" sizes="50vw">',
      (ref) => `/assets/${ref.replace('./', '')}-hashed`,
    ).html

    expect(html).toContain('srcset="/assets/a.png-hashed 1x, /assets/a@2x.png-hashed 2x"')
    // The tool resizes nothing itself; it carries what the author prepared.
    expect(html).toContain('sizes="50vw"')
  })

  it('leaves a remote candidate alone', () => {
    const html = renderMarkdown(
      createMarkdown(),
      '<img srcset="https://example.com/a.png 1x, ./b.png 2x">',
      (ref) => `/assets/${ref.replace('./', '')}-hashed`,
    ).html

    expect(html).toContain('https://example.com/a.png 1x')
    expect(html).toContain('/assets/b.png-hashed 2x')
  })
})
