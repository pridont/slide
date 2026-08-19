import { escapeHtml } from './html.js'
import { assetTags, type PageAssets } from './page.js'

export interface IndexEntry {
  readonly href: string
  readonly title: string
  readonly description?: string | undefined
  readonly slides: number
  /** The deck's cover image, when it has one, used as the card's backdrop. */
  readonly cover?: string | null
}

export interface IndexPageInput {
  readonly title: string
  readonly description?: string | undefined
  readonly entries: readonly IndexEntry[]
  readonly assets: PageAssets
  readonly lang?: string
  readonly colorScheme?: 'dark' | 'light' | undefined
}

/**
 * The front door of a multi-deck project: a web page rather than a slide, so
 * no slide layout, but the same tokens, so a project looks like one thing.
 */
export function renderIndexPage(input: IndexPageInput): string {
  const head: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    `<meta name="color-scheme" content="${input.colorScheme === 'light' ? 'light' : 'dark'}">`,
  ]

  if (input.description) {
    head.push(`<meta name="description" content="${escapeHtml(input.description)}">`)
  }
  // The index transitions into decks, so it needs the same early listeners.
  head.push(...assetTags(input.assets))

  const htmlAttributes = [`lang="${escapeHtml(input.lang ?? 'en')}"`]
  if (input.colorScheme === 'light') htmlAttributes.push('class="light"')

  return [
    '<!doctype html>',
    `<html ${htmlAttributes.join(' ')}>`,
    '<head>',
    ...head.map((line) => `  ${line}`),
    '</head>',
    '<body class="index-body">',
    '  <main class="deck-index">',
    '    <header class="deck-index__header">',
    `      <h1>${escapeHtml(input.title)}</h1>`,
    ...(input.description ? [`      <p>${escapeHtml(input.description)}</p>`] : []),
    '    </header>',
    '    <ul class="deck-list">',
    ...input.entries.map((entry) => renderCard(entry)),
    '    </ul>',
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function renderCard(entry: IndexEntry): string {
  const style = entry.cover ? ` style="--deck-cover: url(&quot;${escapeHtml(entry.cover)}&quot;)"` : ''
  const count = `${entry.slides} slide${entry.slides === 1 ? '' : 's'}`

  return [
    `      <li class="deck-card"${style}>`,
    `        <a href="${escapeHtml(entry.href)}">`,
    `          <span class="deck-card__title">${escapeHtml(entry.title)}</span>`,
    ...(entry.description
      ? [`          <span class="deck-card__note">${escapeHtml(entry.description)}</span>`]
      : []),
    `          <span class="deck-card__count">${count}</span>`,
    '        </a>',
    '      </li>',
  ].join('\n')
}
