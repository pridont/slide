import { basename, extname, relative } from 'node:path'

/**
 * A path as it should read in a message: relative to where the command was
 * run, unless that means climbing out of it, where the absolute path is both
 * shorter and clearer.
 */
export function displayPath(path: string): string {
  const rel = relative(process.cwd(), path)
  if (rel === '') return '.'
  return rel.startsWith('..') ? path : rel
}

/** Always leading and trailing slash, so joins are unambiguous. */
export function normalizeBase(base: string): string {
  let value = base.trim()
  if (value === '') value = '/'
  if (!value.startsWith('/')) value = `/${value}`
  if (!value.endsWith('/')) value = `${value}/`
  return value
}

export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'deck'
  )
}

export function deckSlug(file: string, slug?: string): string {
  return slugify(slug ?? basename(file, extname(file)))
}

/**
 * Slide 1 lives at the deck root so the entry URL is the short one; the rest
 * are numbered. Every caller goes through here rather than rebuilding the
 * asymmetry by hand.
 */
export function slidePagePath(deckBase: string, index: number): string {
  return index === 1 ? `${deckBase}index.html` : `${deckBase}${index}/index.html`
}

export function slideUrl(base: string, deckBase: string, index: number): string {
  return index === 1 ? `${base}${deckBase}` : `${base}${deckBase}${index}/`
}

/** The presenter window for a deck, one per deck, beside its slides. */
export function presenterPagePath(deckBase: string): string {
  return `${deckBase}presenter/index.html`
}

export function presenterUrl(base: string, deckBase: string): string {
  return `${base}${deckBase}presenter/`
}
