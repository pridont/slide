import { SlideParseError } from '../parse/errors.js'
import type { Deck, Slide } from '../parse/types.js'
import { escapeHtml } from './html.js'

/** `<name>.html` from the project's layouts directory, by name. */
export type LayoutTemplates = Readonly<Record<string, string>>

export interface LayoutInput {
  /** Rendered markdown body, with any region content taken out of it. */
  readonly html: string
  /** `::: right` and friends, rendered, for a layout to place. */
  readonly regions?: Readonly<Record<string, string>>
  /** `image:` frontmatter, already a URL. */
  readonly image?: string | null
  readonly slide: Slide
  readonly deck: Deck
  /** Templates from the project's `layouts:` directory, if it has one. */
  readonly templates?: LayoutTemplates
}

export type Layout = (input: LayoutInput) => string

/**
 * A layout owns its whole `<main>`, so a structural one can rearrange freely.
 * What it may not do is size anything in pixels: everything is `cqw` against
 * the slide's own size container, or the deck stops scaling.
 */
const LAYOUTS: Record<string, Layout> = {
  default: (input) => frame('default', input, content(input.html)),

  /** A title slide. Centred, larger, and usually over a background. */
  cover: (input) => frame('cover', input, content(input.html)),

  /** Everything centred, for a slide with one thing on it. */
  center: (input) => frame('center', input, content(input.html)),

  /** A divider: the heading and nothing else, for changing subject. */
  section: (input) => frame('section', input, content(input.html)),

  /** A pull quote. The blockquote does the talking; the layout gets out of the way. */
  quote: (input) => frame('quote', input, content(input.html)),

  /**
   * Two columns. Everything before `::: right` is the first, the region is the
   * second — so a slide that never splits still reads as one column.
   */
  'two-cols': (input) =>
    frame(
      'two-cols',
      input,
      columns(content(input.html, 'slide-col'), content(input.regions?.right ?? '', 'slide-col')),
    ),

  'image-right': (input) =>
    frame('image-right', input, columns(content(input.html, 'slide-col'), figure(input))),
  'image-left': (input) =>
    frame('image-left', input, columns(figure(input), content(input.html, 'slide-col'))),

  /**
   * The `background:` image, full bleed, with the content over a scrim. The
   * image itself comes from frontmatter like any other background — this
   * layout is the part that makes text on top of it readable.
   */
  'full-image': (input) => frame('full-image', input, content(input.html)),
}

export const LAYOUT_NAMES: readonly string[] = Object.keys(LAYOUTS).sort()

/** Layouts that need `image:` in frontmatter and say so when it is missing. */
const NEEDS_IMAGE = new Set(['image-right', 'image-left'])

export function applyLayout(input: LayoutInput): string {
  const name = input.slide.meta.layout ?? 'default'

  const template = input.templates?.[name]
  if (template !== undefined) return frame(name, input, fill(template, input, name))

  const layout = LAYOUTS[name]
  if (!layout) {
    const available = [...LAYOUT_NAMES, ...Object.keys(input.templates ?? {})].sort()
    throw new SlideParseError(
      `unknown layout "${name}". Available layouts: ${available.join(', ')}.`,
      input.deck.file,
      input.slide.sourceLine,
    )
  }
  if (NEEDS_IMAGE.has(name) && !input.image) {
    throw new SlideParseError(
      `layout "${name}" needs an \`image:\` in the slide's frontmatter.`,
      input.deck.file,
      input.slide.sourceLine,
    )
  }
  return layout(input)
}

/**
 * A template fills in `{{content}}`, `{{image}}`, `{{alt}}` and any region by
 * name. It supplies the inside of the slide only — the `<main>` around it
 * stays ours, so backgrounds, the aspect ratio and `class:` keep working
 * whatever the template does.
 *
 * An unknown placeholder is an error rather than empty output: a typo in a
 * template that silently renders nothing is a slide gone missing.
 */
function fill(template: string, input: LayoutInput, name: string): string {
  const values: Record<string, string> = {
    content: input.html,
    image: input.image ?? '',
    alt: escapeHtml(input.slide.meta.imageAlt ?? ''),
    ...input.regions,
  }

  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) {
      throw new SlideParseError(
        `layout "${name}" asks for {{${key}}}, which is not something a slide has. ` +
          `Available: ${Object.keys(values).sort().join(', ')}.`,
        input.deck.file,
        input.slide.sourceLine,
      )
    }
    return value
  })
}

function content(html: string, className = 'slide-content'): string {
  return `<div class="${className}">${html}</div>`
}

function columns(first: string, second: string): string {
  return `<div class="slide-content slide-cols">${first}\n${second}</div>`
}

/**
 * No `width`/`height` and no `style`: the image fills its half through CSS,
 * and a strict `style-src` blocks the attribute that would do it inline.
 */
function figure(input: LayoutInput): string {
  const alt = input.slide.meta.imageAlt ?? ''
  return `<div class="slide-figure"><img src="${escapeHtml(input.image ?? '')}" alt="${escapeHtml(alt)}"></div>`
}

/** The background lands in generated CSS, not a `style` attribute — CSP. */
function frame(name: string, input: LayoutInput, inner: string): string {
  const classes = ['slide', `layout-${name}`]
  if (input.slide.meta.class) classes.push(input.slide.meta.class)

  return `<main class="${escapeHtml(classes.join(' '))}" data-slide="${input.slide.index}">\n${inner}\n</main>`
}
