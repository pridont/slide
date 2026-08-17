import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { renderPresenter, renderSlidePage } from './index.js'

const DECK = `---
title: Talk
---

# One

<!-- Say hello, then *pause*. -->

---

# Two

---

# Three
`

const ASSETS = { styles: ['/base.css'], modules: ['/runtime.js'], head: '/head.js' }

function presenter(source = DECK): string {
  const deck = parseDeck(source, '/talk.md')
  return renderPresenter({
    deck,
    deckId: 'talk',
    href: (index) => (index === 1 ? '/talk/' : `/talk/${index}/`),
    resolveAsset: (ref) => ref,
    assets: ASSETS,
  })
}

describe('the presenter page', () => {
  it('marks itself so the runtime knows which half to be', () => {
    const html = presenter()

    // Not `data-presenter`, which on a slide page is the link to this window.
    expect(html).toContain('data-role="presenter"')
    expect(html).not.toContain('data-presenter')
    expect(html).toContain('data-deck="talk"')
    expect(html).toContain('data-total="3"')
  })

  it('loads the same runtime and stylesheet as a slide', () => {
    // Which is also how it gets the deck's tokens without a second theme.
    const html = presenter()

    expect(html).toContain('<link rel="stylesheet" href="/base.css">')
    expect(html).toContain('<script type="module" src="/runtime.js"></script>')
  })

  it("carries every slide's URL and notes in the markup", () => {
    const html = presenter()

    expect(html).toContain('<article data-slide="1" data-url="/talk/">')
    expect(html).toContain('<article data-slide="3" data-url="/talk/3/">')
    // Notes go through markdown, so a list in a note stays a list.
    expect(html).toContain('<em>pause</em>')
  })

  it('has two frames and no src on either', () => {
    const html = presenter()

    // The runtime fills them in; the page itself points at nothing.
    expect(html).toContain('data-role="current"')
    expect(html).toContain('data-role="next"')
    expect(html).not.toMatch(/<iframe[^>]*\ssrc=/)
  })

  it('has nothing inline for a strict CSP to object to', () => {
    const html = presenter()

    expect(html).not.toContain('style=')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/)
  })

  it("follows the deck's colour scheme", () => {
    expect(presenter('---\ncolorScheme: light\n---\n\n# One\n')).toContain('class="light"')
  })
})

describe('the slide pages', () => {
  it('know where their presenter window is, for the `p` key', () => {
    const deck = parseDeck(DECK, '/talk.md')
    const html = renderSlidePage({
      deck,
      slide: deck.slides[0]!,
      deckId: 'talk',
      presenter: '/talk/presenter/',
      resolveAsset: (ref) => ref,
      href: (index) => `/talk/${index}/`,
      assets: ASSETS,
    })

    expect(html).toContain('data-presenter="/talk/presenter/"')
  })
})
