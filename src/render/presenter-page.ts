import type { Deck } from '../parse/types.js'
import { escapeHtml } from './html.js'
import type { PageAssets } from './page.js'

/**
 * The presenter's own window: the current slide, the next one, the notes, and
 * two clocks.
 *
 * Both slides are iframes of the real pages, so what the presenter sees is the
 * build's own output rather than a second renderer that could drift from it.
 * They carry `?preview`, which is how the runtime inside them knows to stay
 * quiet — no key handling, no announcing itself on the channel.
 *
 * Everything the page needs is in the markup: the notes for every slide and
 * each slide's URL. No fetch, no JSON island, nothing for a strict CSP to
 * object to.
 */
export interface PresenterPageInput {
  readonly deck: Deck
  readonly deckId: string
  /** 1-based slide index to its page URL. */
  readonly href: (index: number) => string
  /** Rendered notes HTML per slide, in order; an empty string for none. */
  readonly notes: readonly string[]
  readonly assets: PageAssets
  readonly lang?: string
}

export function renderPresenterPage(input: PresenterPageInput): string {
  const { deck, deckId, href } = input
  const total = deck.slides.length
  const title = deck.meta.title ?? deckId

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Presenter · ${escapeHtml(title)}</title>`,
    `<meta name="color-scheme" content="${deck.meta.colorScheme === 'light' ? 'light' : 'dark'}">`,
    '<meta name="robots" content="noindex">',
    `<script src="${escapeHtml(input.assets.head)}"></script>`,
    ...input.assets.styles.map((url) => `<link rel="stylesheet" href="${escapeHtml(url)}">`),
    ...input.assets.modules.map((url) => `<script type="module" src="${escapeHtml(url)}"></script>`),
  ]

  const htmlAttributes = [`lang="${escapeHtml(input.lang ?? 'en')}"`]
  if (deck.meta.colorScheme === 'light') htmlAttributes.push('class="light"')
  htmlAttributes.push(`data-deck="${escapeHtml(deckId)}"`)

  return [
    '<!doctype html>',
    `<html ${htmlAttributes.join(' ')}>`,
    '<head>',
    ...head.map((line) => `  ${line}`),
    '</head>',
    // `data-role`, not `data-presenter`: a slide page carries the *link* to
    // this window in `data-presenter`, and one attribute cannot mean both.
    `<body class="presenter-body" data-role="presenter" data-deck="${escapeHtml(deckId)}" data-total="${total}">`,
    '  <main class="presenter">',
    '    <div class="presenter-stage">',
    '      <div class="presenter-screen presenter-screen--current">',
    '        <iframe class="presenter-frame" data-role="current" title="Current slide"></iframe>',
    '      </div>',
    '      <div class="presenter-screen presenter-screen--next">',
    '        <span class="presenter-label">Next</span>',
    '        <iframe class="presenter-frame" data-role="next" title="Next slide"></iframe>',
    '      </div>',
    '    </div>',
    '    <aside class="presenter-panel">',
    '      <div class="presenter-clocks">',
    '        <button class="presenter-timer" data-action="timer" data-role="elapsed" title="Start or pause">',
    '          0:00',
    '        </button>',
    '        <span class="presenter-clock" data-role="clock">--:--</span>',
    '      </div>',
    '      <div class="presenter-controls">',
    '        <button data-action="prev" title="Previous slide">←</button>',
    '        <span class="presenter-position"><b data-role="index">1</b> / ' + total + '</span>',
    '        <button data-action="next" title="Next slide">→</button>',
    '        <button data-action="reset" title="Reset the timer">reset</button>',
    '      </div>',
    '      <div class="presenter-notes" data-role="notes"></div>',
    '    </aside>',
    '  </main>',
    // The deck itself: every slide's URL and notes, read by the runtime.
    '  <template data-role="slides">',
    ...deck.slides.map((slide, index) =>
      [
        `    <article data-slide="${slide.index}" data-url="${escapeHtml(href(slide.index))}">`,
        input.notes[index] ?? '',
        '    </article>',
      ].join('\n'),
    ),
    '  </template>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
