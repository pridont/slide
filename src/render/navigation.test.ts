import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { clientScript } from '../build/client-script.js'
import { renderSlidePage } from './index.js'
import { firstImageRef } from './preload.js'

const FILE = '/deck.md'
const DECK = '# One\n\n---\n\n![hero](./hero.png)\n\n# Two\n\n---\n\n# Three\n'

function page(source: string, index: number, present = true): string {
  const deck = parseDeck(source, FILE)
  return renderSlidePage({
    deck,
    slide: deck.slides[index]!,
    resolveAsset: (ref) => `/assets/${ref.replace('./', '')}`,
    resolveAssetIfPresent: (ref) => (present ? `/assets/${ref.replace('./', '')}` : null),
    href: (n) => (n === 1 ? '/' : `/${n}/`),
    assets: { styles: [], scripts: [] },
  })
}

function speculationRules(html: string): { urls: string[]; eagerness: string } {
  const match = /<script type="speculationrules">(.*?)<\/script>/s.exec(html)
  if (!match) throw new Error('no speculation rules in page')
  const parsed = JSON.parse(match[1]!.replace(/\\u003c/g, '<')) as {
    prerender: Array<{ urls: string[]; eagerness: string }>
  }
  return parsed.prerender[0]!
}

describe('speculation rules', () => {
  it('prerenders both neighbours from the middle of a deck', () => {
    expect(speculationRules(page(DECK, 1))).toEqual({ urls: ['/', '/3/'], eagerness: 'immediate' })
  })

  it('prerenders only forward from the first slide', () => {
    expect(speculationRules(page(DECK, 0)).urls).toEqual(['/2/'])
  })

  it('prerenders only backward from the last slide', () => {
    expect(speculationRules(page(DECK, 2)).urls).toEqual(['/2/'])
  })

  it('emits no rules for a single-slide deck', () => {
    expect(page('# Only\n', 0)).not.toContain('speculationrules')
  })
})

describe('image warming', () => {
  it("prefetches the next slide's first image", () => {
    expect(page(DECK, 0)).toContain('<link rel="prefetch" as="image" href="/assets/hero.png">')
  })

  it('does not prefetch an image the next slide does not have', () => {
    expect(page(DECK, 1)).not.toContain('rel="prefetch" as="image"')
  })

  it('skips the hint when the guessed file is not there', () => {
    expect(page(DECK, 0, false)).not.toContain('rel="prefetch" as="image"')
  })

  it('is silent when no optional resolver is supplied', () => {
    const deck = parseDeck(DECK, FILE)
    const html = renderSlidePage({
      deck,
      slide: deck.slides[0]!,
      resolveAsset: (ref) => ref,
      href: (n) => `/${n}/`,
      assets: { styles: [], scripts: [] },
    })
    expect(html).not.toContain('rel="prefetch"')
  })
})

describe('firstImageRef', () => {
  it('finds a markdown image', () => {
    expect(firstImageRef('text\n\n![alt](./a.png)\n')).toBe('./a.png')
  })

  it('finds a raw HTML image', () => {
    expect(firstImageRef('<img src="./b.png" alt="">')).toBe('./b.png')
  })

  it('ignores an image inside a code fence', () => {
    expect(firstImageRef('```md\n![alt](./fake.png)\n```\n\n![real](./real.png)')).toBe('./real.png')
  })

  it('returns null when a slide has no image', () => {
    expect(firstImageRef('# Just words')).toBeNull()
  })
})

describe('the transition head script', () => {
  it('is linked as a parser-blocking classic script', () => {
    const deck = parseDeck(DECK, FILE)
    const html = renderSlidePage({
      deck,
      slide: deck.slides[1]!,
      resolveAsset: (ref) => ref,
      href: (n) => `/${n}/`,
      assets: { styles: [], scripts: [{ src: '/runtime.js' }] },
    })

    // Not `type=module`, not `defer`, not `async` — any of those would let the
    // first render happen before the listeners exist. Not inline either, so a
    // strict `script-src` does not block it.
    expect(html).toContain('<script src="/runtime.js"></script>')
  })

  it('comes after the stylesheet, so blocking the parser does not delay the paint', () => {
    const deck = parseDeck(DECK, FILE)
    const html = renderSlidePage({
      deck,
      slide: deck.slides[1]!,
      resolveAsset: (ref) => ref,
      href: (n) => `/${n}/`,
      assets: { styles: ['/base.css'], scripts: [{ src: '/runtime.js' }] },
    })

    expect(html.indexOf('href="/base.css"')).toBeGreaterThan(-1)
    expect(html.indexOf('href="/base.css"')).toBeLessThan(html.indexOf('src="/runtime.js"'))
  })

  it('holds the promises the outgoing document exposes', async () => {
    const head = await clientScript('head')
    expect(head).toContain('ready?.catch')
    expect(head).toContain('finished?.catch')
  })

  it('intercepts the rejection the incoming document never exposes', async () => {
    const head = await clientScript('head')
    // At pagereveal there is no ViewTransition to attach to, but the incoming
    // document's own transition still rejects, so it is caught where it lands.
    expect(head).toContain('unhandledrejection')
    // Narrowly: this AbortError and nothing else.
    expect(head).toContain('transition was skipped')
    expect(head).toContain('preventDefault')
  })

  it('marks direction from the two URLs, so back and forward both work', async () => {
    expect(await clientScript('head')).toContain('"back":"forward"')
  })

  it('is a minified IIFE small enough to stay parser-blocking', async () => {
    const head = await clientScript('head')
    expect(head.startsWith('(()=>{')).toBe(true)
    expect(head).not.toContain('\n')
    expect(Buffer.byteLength(head)).toBeLessThan(1500)
  })
})

describe('deck-end navigation', () => {
  it('offers Home and End targets from the middle', () => {
    const html = page(DECK, 1)
    expect(html).toContain('data-first="/"')
    expect(html).toContain('data-last="/3/"')
  })

  it('omits the target the viewer is already on', () => {
    expect(page(DECK, 0)).not.toContain('data-first')
    expect(page(DECK, 2)).not.toContain('data-last')
  })
})
