/**
 * URL ↔ deck and slide. The build writes slide 1 to the deck root and the rest
 * to numbered directories; dev has to answer exactly the same URLs, so both go
 * through one place.
 */

export type Route =
  | { readonly kind: 'index' }
  | { readonly kind: 'slide'; readonly deckBase: string; readonly index: number }
  | { readonly kind: 'presenter'; readonly deckBase: string }
  | { readonly kind: 'redirect'; readonly to: string }

export interface RouteTarget {
  /** '' for a single-deck project, otherwise 'slug/'. */
  readonly deckBase: string
}

export function matchRoute(
  pathname: string,
  base: string,
  targets: readonly RouteTarget[],
  hasIndex: boolean,
): Route | null {
  if (!pathname.startsWith(base)) return null

  const rest = stripIndexHtml(pathname.slice(base.length))

  if (rest === '' && hasIndex) return { kind: 'index' }

  // Longest first, so a deck slugged `talks/intro` wins over one called `talks`.
  const ordered = [...targets].sort((a, b) => b.deckBase.length - a.deckBase.length)

  for (const { deckBase } of ordered) {
    if (!rest.startsWith(deckBase)) continue

    const tail = rest.slice(deckBase.length)
    if (tail === '') return { kind: 'slide', deckBase, index: 1 }

    if (tail === 'presenter/') return { kind: 'presenter', deckBase }
    if (tail === 'presenter') return { kind: 'redirect', to: `${base}${deckBase}presenter/` }

    const numbered = /^(\d+)(\/?)$/.exec(tail)
    if (!numbered) continue

    const index = Number(numbered[1])
    if (!Number.isInteger(index) || index < 1) continue

    // `/2` means slide 2, but only `/2/` keeps relative references working.
    if (numbered[2] !== '/') return { kind: 'redirect', to: `${base}${deckBase}${index}/` }

    return { kind: 'slide', deckBase, index }
  }

  // A deck URL missing its trailing slash: `/intro` → `/intro/`.
  const missingSlash = ordered.find((target) => target.deckBase === `${rest}/`)
  if (missingSlash) return { kind: 'redirect', to: `${base}${missingSlash.deckBase}` }

  return null
}

function stripIndexHtml(rest: string): string {
  return rest === 'index.html' || rest.endsWith('/index.html') ? rest.slice(0, -'index.html'.length) : rest
}
