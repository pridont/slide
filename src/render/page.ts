import type { Deck, Slide } from '../parse/types.js'
import { escapeHtml } from './html.js'

export interface PageAssets {
  /** Stylesheet URLs, emitted as `<link rel=stylesheet>`. */
  readonly styles: readonly string[]
  /** Module script URLs, emitted as `<script type=module>`. */
  readonly modules: readonly string[]
  /** The parser-blocking head script — see head-script.ts. */
  readonly head: string
}

export interface PageInput {
  readonly deck: Deck
  readonly slide: Slide
  readonly total: number
  /** Layout output — a complete `<main>` element. */
  readonly main: string
  /** Text of the slide's first heading, if it has one. */
  readonly title: string | null
  readonly deckId?: string
  readonly prev?: string | null
  readonly next?: string | null
  /** Deck ends, for Home/End. */
  readonly first?: string | null
  readonly last?: string | null
  /** The deck's presenter window, opened with `p`. */
  readonly presenter?: string
  /** Pages to prerender via speculation rules. */
  readonly prerender?: readonly string[]
  /** Images the next slide will need. */
  readonly prefetchImages?: readonly string[]
  readonly assets: PageAssets
  readonly lang?: string
}

export function renderPage(input: PageInput): string {
  const head: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(documentTitle(input))}</title>`,
    // Before any stylesheet lands, this is what stops the browser painting a
    // white page between one slide and the next.
    `<meta name="color-scheme" content="${input.deck.meta.colorScheme === 'light' ? 'light' : 'dark'}">`,
    // Must run before the first render opportunity; see head-script.ts.
    `<script src="${escapeHtml(input.assets.head)}"></script>`,
  ]

  const description = input.deck.meta.description
  if (description && input.slide.index === 1) {
    head.push(`<meta name="description" content="${escapeHtml(description)}">`)
  }

  if (input.prev) head.push(`<link rel="prev" href="${escapeHtml(input.prev)}">`)
  if (input.next) head.push(`<link rel="next" href="${escapeHtml(input.next)}">`)

  for (const href of input.prefetchImages ?? []) {
    // `prefetch`, not `preload`: the image is for the *next* navigation, and
    // preloading what this page never paints earns a console warning.
    head.push(`<link rel="prefetch" as="image" href="${escapeHtml(href)}">`)
  }

  const prerender = input.prerender ?? []
  if (prerender.length > 0) {
    // Neighbours only, so we stay inside Chrome's budget for eager prerenders.
    const rules = JSON.stringify({ prerender: [{ urls: prerender, eagerness: 'immediate' }] })
    head.push(`<script type="speculationrules">${rules.replace(/</g, '\\u003c')}</script>`)
  }

  for (const href of input.assets.styles) {
    head.push(`<link rel="stylesheet" href="${escapeHtml(href)}">`)
  }
  for (const src of input.assets.modules) {
    head.push(`<script type="module" src="${escapeHtml(src)}"></script>`)
  }

  const htmlAttributes = [`lang="${escapeHtml(input.lang ?? 'en')}"`]
  // On the document element, so the palette is right at first paint.
  if (input.deck.meta.colorScheme === 'light') htmlAttributes.push('class="light"')
  // On <html> as well as <body>: token overrides have to be declared on the
  // same element the base theme declares its own on — see build/generated.ts.
  if (input.deckId) htmlAttributes.push(`data-deck="${escapeHtml(input.deckId)}"`)
  // The aspect ratio arrives through that generated CSS too, not a style
  // attribute.

  const bodyAttributes = [
    'class="slide-body"',
    `data-slide="${input.slide.index}"`,
    `data-total="${input.total}"`,
  ]
  if (input.deckId) bodyAttributes.push(`data-deck="${escapeHtml(input.deckId)}"`)
  if (input.presenter) bodyAttributes.push(`data-presenter="${escapeHtml(input.presenter)}"`)
  if (input.prev) bodyAttributes.push(`data-prev="${escapeHtml(input.prev)}"`)
  if (input.next) bodyAttributes.push(`data-next="${escapeHtml(input.next)}"`)
  if (input.first) bodyAttributes.push(`data-first="${escapeHtml(input.first)}"`)
  if (input.last) bodyAttributes.push(`data-last="${escapeHtml(input.last)}"`)

  return [
    '<!doctype html>',
    `<html ${htmlAttributes.join(' ')}>`,
    '<head>',
    ...head.map((line) => `  ${line}`),
    '</head>',
    `<body ${bodyAttributes.join(' ')}>`,
    '<div class="slide-viewport">',
    // Flush left on purpose: indenting the document would also indent the
    // inside of every <pre>, where whitespace is content.
    input.main,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function documentTitle(input: PageInput): string {
  const heading = input.title?.trim()
  const deckTitle = input.deck.meta.title?.trim()
  if (heading && deckTitle && heading !== deckTitle) return `${heading} · ${deckTitle}`
  return heading ?? deckTitle ?? 'Slide'
}
