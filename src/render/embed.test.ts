import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { renderSlidePage } from './index.js'
import { createMarkdown, renderMarkdown } from './markdown.js'

const FILE = '/deck.md'

function render(body: string): string {
  return renderMarkdown(createMarkdown(), body, (ref) => `/assets/${ref.replace('./', '')}-hashed`, {
    source: { file: FILE, line: 1 },
    resolveEmbed: (ref) => (ref.endsWith('/') ? `/embeds/${ref.replace('./', '')}index.html` : `/x/${ref}`),
  }).html
}

describe('the embed container', () => {
  it('frames a file', () => {
    const html = render('::: iframe {src=./demo.html}\n:::')

    expect(html).toContain('<figure class="slide-embed embed-fill">')
    expect(html).toContain('src="/x/./demo.html"'.replace('/x/./', '/x/./'))
    expect(html).toContain('title="demo"')
  })

  it('frames a directory through its index.html', () => {
    // Which is what lets an embed have its own stylesheet and scripts.
    expect(render('::: iframe {src=./demo/}\n:::')).toContain('/embeds/demo/index.html')
  })

  it('holds the URL as data until the page is activated', () => {
    const html = render('::: iframe {src=./demo.html}\n:::')

    // A prerendered slide would otherwise run the demo before anyone saw it.
    expect(html).toContain('data-embed-src=')
    expect(/<iframe(?![^>]*data-embed-src)[^>]*\ssrc=/.test(html.split('<noscript>')[0] ?? '')).toBe(false)
    // Without script nothing swaps it, so a plain frame is written out too.
    expect(html).toContain('<noscript><iframe')
  })

  it('sandboxes by default, and lets an author say otherwise', () => {
    expect(render('::: iframe {src=./a.html}\n:::')).toContain('sandbox="allow-scripts"')
    expect(render('::: iframe {src=./a.html sandbox="allow-scripts allow-forms"}\n:::')).toContain(
      'sandbox="allow-scripts allow-forms"',
    )
    expect(render('::: iframe {src=./a.html sandbox=off}\n:::')).not.toContain('sandbox=')
  })

  it('renders content between the fences as a caption', () => {
    const html = render('::: iframe {src=./a.html}\nEasing curves, *side by side*.\n:::')

    expect(html).toContain('<figcaption><p>Easing curves, <em>side by side</em>.</p>\n</figcaption>')
  })

  it('has no caption element when there is nothing to say', () => {
    expect(render('::: iframe {src=./a.html}\n:::')).not.toContain('figcaption')
  })

  it('takes a ratio, or a height in pixels', () => {
    expect(render('::: iframe {src=./a.html aspect=16:9}\n:::')).toContain('class="slide-embed embed-16-9"')
    const fixed = render('::: iframe {src=./a.html height=400}\n:::')
    expect(fixed).toContain('class="slide-embed embed-fixed"')
    // An attribute, not a style: a strict style-src blocks those outright.
    expect(fixed).toContain('height="400"')
    expect(fixed).not.toContain('style=')
  })

  it('leaves the rest of the slide alone', () => {
    const html = render('# Heading\n\n::: iframe {src=./a.html}\n:::\n\nAfter.')

    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<p>After.</p>')
  })

  it('is not a container when it is inside a code fence', () => {
    const html = render('```md\n::: iframe {src=./a.html}\n:::\n```')

    expect(html).not.toContain('<iframe')
    expect(html).toContain('::: iframe')
  })
})

describe('an embed that will not do', () => {
  function fail(body: string): () => string {
    return () => render(body)
  }

  it('needs a src', () => {
    expect(fail('::: iframe {aspect=16/9}\n:::')).toThrow(/an embed needs a `src` to frame/)
  })

  it('suggests a real key', () => {
    expect(fail('::: iframe {src=./a.html scr=./b.html}\n:::')).toThrow(
      /unknown embed key "scr"\. Did you mean "src"\?/,
    )
  })

  it('lists the ratios it knows', () => {
    expect(fail('::: iframe {src=./a.html aspect=21/9}\n:::')).toThrow(/unknown embed aspect "21\/9"/)
  })

  it('explains that a height is pixels', () => {
    expect(fail('::: iframe {src=./a.html height=40cqh}\n:::')).toThrow(/height` is a number of pixels/)
  })

  it('refuses a sandbox token that is not one', () => {
    expect(fail('::: iframe {src=./a.html sandbox="allow-scripts everything"}\n:::')).toThrow(
      /"everything" is not a sandbox permission/,
    )
  })

  it('points at the line in the deck, not the line in the slide', () => {
    const deck = parseDeck('# One\n\n---\n\n# Two\n\n::: iframe {src=./a.html bogus=1}\n:::\n', FILE)

    expect(() =>
      renderSlidePage({
        deck,
        slide: deck.slides[1]!,
        resolveAsset: (ref) => ref,
        href: () => '/',
        assets: { styles: [], modules: [], head: '/head.js' },
      }),
    ).toThrow(/deck\.md:7 unknown embed key "bogus"/)
  })
})
