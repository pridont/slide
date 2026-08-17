import type MarkdownIt from 'markdown-it'
import type { Deck, Slide } from '../parse/types.js'
import type { DiagramLookup } from './diagram.js'
import { isResolvableRef } from './html.js'
import { applyLayout, type LayoutTemplates } from './layouts.js'
import { createMarkdown, renderMarkdown } from './markdown.js'
import { renderPage, type PageAssets } from './page.js'
import { renderPresenterPage } from './presenter-page.js'
import { firstImageRef } from './preload.js'

export { createMarkdown, renderMarkdown } from './markdown.js'
export {
  DiagramStyles,
  diagramKey,
  findDiagrams,
  normalizeDiagram,
  renderDiagram,
  type Diagram,
  type DiagramLookup,
  type DiagramRef,
} from './diagram.js'
export { applyLayout, LAYOUT_NAMES, type Layout, type LayoutInput, type LayoutTemplates } from './layouts.js'
export { renderPage, type PageAssets, type PageInput } from './page.js'
export { renderPresenterPage, type PresenterPageInput } from './presenter-page.js'
export { escapeHtml, isExternalUrl, isResolvableRef } from './html.js'

export interface RenderSlideOptions {
  readonly deck: Deck
  readonly slide: Slide
  /** Markdown-relative reference to a URL the bundler can hash. */
  readonly resolveAsset: (ref: string) => string
  /** As `resolveAsset`, but for guessed references: a miss returns null. */
  readonly resolveAssetIfPresent?: (ref: string) => string | null
  /** As `resolveAsset`, but the reference may be a directory — see embed.ts. */
  readonly resolveEmbed?: (ref: string) => string
  /** This deck's drawn diagrams, by source — see build/diagrams.ts. */
  readonly diagram?: DiagramLookup
  /** 1-based slide index to its page URL. */
  readonly href: (index: number) => string
  readonly assets: PageAssets
  readonly deckId?: string
  /** The project's own layout templates, if it has any. */
  readonly templates?: LayoutTemplates
  /** URL of the deck's presenter window, if it has one. */
  readonly presenter?: string
  readonly lang?: string
  /** Reuse one instance across a deck; a shared default is used otherwise. */
  readonly md?: MarkdownIt
}

let shared: MarkdownIt | undefined

function sharedMarkdown(): MarkdownIt {
  shared ??= createMarkdown()
  return shared
}

/**
 * The single path from a parsed slide to a finished document. Dev and build
 * both call it — if they diverge, preview stops predicting the build.
 */
export function renderSlidePage(options: RenderSlideOptions): string {
  const { deck, slide, resolveAsset, href } = options
  const md = options.md ?? sharedMarkdown()

  const { html, title, regions } = renderMarkdown(md, slide.body, resolveAsset, {
    source: { file: deck.file, line: slide.sourceLine },
    ...(options.resolveEmbed ? { resolveEmbed: options.resolveEmbed } : {}),
    ...(options.diagram ? { diagram: options.diagram } : {}),
  })
  const main = applyLayout({
    html,
    regions,
    slide,
    deck,
    ...(options.templates ? { templates: options.templates } : {}),
    ...(slide.meta.image ? { image: resolveAsset(slide.meta.image) } : {}),
  })

  const total = deck.slides.length
  const prev = slide.index > 1 ? href(slide.index - 1) : null
  const next = slide.index < total ? href(slide.index + 1) : null

  return renderPage({
    deck,
    slide,
    total,
    main,
    title,
    assets: options.assets,
    prev,
    next,
    first: slide.index > 1 ? href(1) : null,
    last: slide.index < total ? href(total) : null,
    // Neighbours only: a prerender renders and runs the whole target page.
    prerender: [prev, next].filter((url): url is string => url !== null),
    prefetchImages: neighbourImages(options),
    ...(options.deckId !== undefined ? { deckId: options.deckId } : {}),
    ...(options.presenter !== undefined ? { presenter: options.presenter } : {}),
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
  })
}

export interface RenderPresenterOptions {
  readonly deck: Deck
  readonly deckId: string
  readonly href: (index: number) => string
  readonly resolveAsset: (ref: string) => string
  readonly assets: PageAssets
  readonly lang?: string
  readonly md?: MarkdownIt
}

/**
 * The deck's presenter window. Notes go through the same markdown as the
 * slides, so a list in a note is a list.
 */
export function renderPresenter(options: RenderPresenterOptions): string {
  const md = options.md ?? sharedMarkdown()

  return renderPresenterPage({
    deck: options.deck,
    deckId: options.deckId,
    href: options.href,
    notes: options.deck.slides.map((slide) =>
      slide.notes ? renderMarkdown(md, slide.notes, options.resolveAsset).html : '',
    ),
    assets: options.assets,
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
  })
}

/** The next slide's hero image, warmed before the viewer asks for it. */
function neighbourImages(options: RenderSlideOptions): string[] {
  const resolve = options.resolveAssetIfPresent
  if (!resolve) return []

  const next = options.deck.slides[options.slide.index] // index is 1-based
  if (!next) return []

  const ref = firstImageRef(next.body)
  if (!ref || !isResolvableRef(ref)) return []

  const url = resolve(ref)
  return url ? [url] : []
}
