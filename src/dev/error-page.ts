import type { SlideParseError } from '../parse/errors.js'
import type { Deck } from '../parse/types.js'
import { escapeHtml } from '../render/html.js'
import { slideUrl } from '../build/paths.js'

/**
 * Dev-only pages, self-contained rather than themed: when the deck will not
 * parse, an error that renders beats one that matches.
 */
const SHELL_STYLE = `
  :root { color-scheme: dark }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #17131c; color: #ece6f1;
    font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
  }
  main { max-width: 46rem; padding: 2rem }
  h1 { margin: 0 0 .4rem; font-size: 1.35rem; letter-spacing: -0.01em }
  .where { margin: 0 0 1.2rem; color: #a196aa; font-family: ui-monospace, monospace; font-size: .85rem }
  pre {
    margin: 0 0 1.2rem; padding: 1rem 1.1rem; overflow-x: auto;
    border: 1px solid rgb(236 230 241 / .12); border-radius: 10px; background: #1f1826;
    font-family: ui-monospace, monospace; font-size: .85rem; white-space: pre-wrap;
  }
  p { color: #a196aa }
  a { color: #e6a878 }
  ul { padding-left: 1.1rem; color: #a196aa }
`

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${SHELL_STYLE}</style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>
`
}

export function renderErrorPage(error: SlideParseError): string {
  const location = `${error.file}:${error.line}`
  // The message is prefixed with file:line already; show it once.
  const detail = error.message.startsWith(location)
    ? error.message.slice(location.length).trim()
    : error.message

  return shell(
    'Deck failed to parse',
    `    <h1>This deck will not parse</h1>
    <p class="where">${escapeHtml(location)}</p>
    <pre>${escapeHtml(detail)}</pre>
    <p>Fix the file and this page reloads on its own.</p>`,
  )
}

export function renderMissingSlidePage(index: number, deck: Deck, base: string): string {
  const total = deck.slides.length
  const last = slideUrl(base, '', total)

  return shell(
    `No slide ${index}`,
    `    <h1>There is no slide ${index}</h1>
    <p class="where">${escapeHtml(deck.file)}</p>
    <p>The deck has ${total} slide${total === 1 ? '' : 's'}. This usually means you removed
    one while the page was open.</p>
    <ul>
      <li><a href="${escapeHtml(slideUrl(base, '', 1))}">first slide</a></li>
      <li><a href="${escapeHtml(last)}">last slide</a></li>
    </ul>`,
  )
}
