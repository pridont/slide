import { SlideParseError } from '../parse/errors.js'
import { closest } from '../parse/suggest.js'
import { escapeHtml } from './html.js'

/**
 * `::: iframe {…} :::` — an interactive piece authored as its own little web
 * page and framed inside a slide.
 *
 *     ::: iframe {src=./demo/ aspect=16/9}
 *     What the easing curves look like side by side.
 *     :::
 *
 * `src` is a file or a directory of one; a directory is served from its
 * `index.html`, which is what lets an embed have its own CSS and scripts. Any
 * content between the fences becomes a caption.
 *
 * Sizing is by class rather than a `style` attribute, because a strict
 * `style-src` blocks those and they cannot be allowed by hash. The default is
 * to fill whatever height the slide has left, which is usually what a slide
 * wants and always scales with the frame.
 *
 * An embed is its own page, so its own `color-scheme` decides whether the
 * frame starts light or dark — the parent's does not reach into it.
 */
export interface Embed {
  readonly src: string
  readonly title: string
  readonly aspect: string
  /** Pixels, as an HTML attribute — a presentational hint, not a style. */
  readonly height?: number
  readonly sandbox: string | null
  readonly loading: string
}

const KEYS = ['src', 'title', 'aspect', 'height', 'sandbox', 'loading'] as const

/**
 * Ratios with a class in the base stylesheet. A free-form ratio would have to
 * be a `style` attribute or a rule generated per embed, and the deck
 * stylesheet is written before the pages that would describe them.
 */
const ASPECTS: Record<string, string> = {
  fill: 'fill',
  fixed: 'fixed',
  '16/9': '16-9',
  '16:9': '16-9',
  '4/3': '4-3',
  '4:3': '4-3',
  '3/2': '3-2',
  '3:2': '3-2',
  '1/1': '1-1',
  '1:1': '1-1',
}

/** Everything but `allow-scripts` is off unless the author asks for it. */
const DEFAULT_SANDBOX = 'allow-scripts'
const SANDBOX_TOKEN = /^allow-[a-z-]+$/

export interface EmbedSource {
  readonly file: string
  readonly line: number
}

/** Reads the `{key=value}` block on the container's opening line. */
export function parseEmbed(info: string, where: EmbedSource): Embed {
  const attributes = parseAttributes(info, where)

  for (const key of Object.keys(attributes)) {
    if ((KEYS as readonly string[]).includes(key)) continue
    const suggestion = closest(key, KEYS)
    const hint = suggestion ? `Did you mean "${suggestion}"?` : `Valid keys: ${KEYS.join(', ')}.`
    throw new SlideParseError(`unknown embed key "${key}". ${hint}`, where.file, where.line)
  }

  const src = attributes.src
  if (!src) throw new SlideParseError('an embed needs a `src` to frame.', where.file, where.line)

  // A given height is the whole answer, so it takes the place of a ratio.
  const aspect = attributes.aspect ?? (attributes.height === undefined ? 'fill' : 'fixed')
  const shape = ASPECTS[aspect]
  if (!shape) {
    throw new SlideParseError(
      `unknown embed aspect "${aspect}". Valid: ${[...new Set(Object.values(ASPECTS))].filter((name) => name !== 'fixed').join(', ')}, ` +
        'or leave it out and the embed fills the space the slide has left.',
      where.file,
      where.line,
    )
  }

  return {
    src,
    title: attributes.title ?? titleFrom(src),
    aspect: shape,
    ...(attributes.height !== undefined ? { height: height(attributes.height, where) } : {}),
    sandbox: sandbox(attributes.sandbox, where),
    loading: loading(attributes.loading, where),
  }
}

/** The iframe, plus a caption when the container had content. */
export function renderEmbed(embed: Embed, url: string, caption: string): string {
  const attributes = [
    `class="slide-embed-frame"`,
    // Left as data until the page is activated: a prerendered slide would
    // otherwise run someone's demo before they had looked at it.
    `data-embed-src="${escapeHtml(url)}"`,
    `title="${escapeHtml(embed.title)}"`,
    `loading="${embed.loading}"`,
    ...(embed.height !== undefined ? [`height="${embed.height}"`] : []),
    ...(embed.sandbox === null ? [] : [`sandbox="${escapeHtml(embed.sandbox)}"`]),
  ]

  return [
    `<figure class="slide-embed embed-${embed.aspect}">`,
    `<iframe ${attributes.join(' ')}></iframe>`,
    // Without script the swap never happens, so the frame is written out in
    // full here — the same embed, loaded the moment the page is.
    `<noscript><iframe class="slide-embed-frame" src="${escapeHtml(url)}" title="${escapeHtml(embed.title)}"${
      embed.sandbox === null ? '' : ` sandbox="${escapeHtml(embed.sandbox)}"`
    }></iframe></noscript>`,
    ...(caption.trim() === '' ? [] : [`<figcaption>${caption}</figcaption>`]),
    '</figure>',
  ].join('\n')
}

/**
 * `key=value`, `key="two words"` or a bare `key`, inside optional braces. Small
 * enough to read in one go, which is why it is here rather than a dependency
 * that would also apply attributes to every other element.
 */
function parseAttributes(info: string, where: EmbedSource): Record<string, string> {
  const text = info.trim().replace(/^\{/, '').replace(/\}$/, '')
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s}]+)))?/g

  for (const match of text.matchAll(pattern)) {
    const [, key, doubleQuoted, singleQuoted, bare] = match
    if (!key) continue
    if (key in attributes) {
      throw new SlideParseError(`"${key}" is set twice on this embed.`, where.file, where.line)
    }
    attributes[key] = doubleQuoted ?? singleQuoted ?? bare ?? ''
  }

  return attributes
}

function height(value: string, where: EmbedSource): number {
  const pixels = Number(value.replace(/px$/, ''))
  if (!Number.isFinite(pixels) || pixels <= 0) {
    throw new SlideParseError(
      `an embed \`height\` is a number of pixels; got "${value}". For a height that ` +
        'follows the slide, use `aspect` instead, or leave both out to fill the space.',
      where.file,
      where.line,
    )
  }
  return Math.round(pixels)
}

function sandbox(value: string | undefined, where: EmbedSource): string | null {
  if (value === undefined) return DEFAULT_SANDBOX
  if (value === 'off') return null

  const tokens = value.split(/\s+/).filter((token) => token !== '')
  for (const token of tokens) {
    if (!SANDBOX_TOKEN.test(token)) {
      throw new SlideParseError(
        `"${token}" is not a sandbox permission. Use \`allow-…\` tokens, or \`sandbox=off\` ` +
          'to drop the sandbox entirely.',
        where.file,
        where.line,
      )
    }
  }
  return tokens.join(' ')
}

function loading(value: string | undefined, where: EmbedSource): string {
  if (value === undefined) return 'lazy'
  if (value === 'lazy' || value === 'eager') return value
  throw new SlideParseError(`an embed \`loading\` is lazy or eager; got "${value}".`, where.file, where.line)
}

/** `./demo/` becomes "demo", `./easing.html` becomes "easing". */
function titleFrom(src: string): string {
  const trimmed = src.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return name.replace(/\.[^.]+$/, '') || 'Embedded page'
}
