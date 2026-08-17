import { createHash } from 'node:crypto'
import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { DIAGRAM_FONT_SIZE } from '../theme/mermaid.js'

/**
 * Mermaid diagrams, rendered to SVG at build time and inlined into the slide.
 *
 * What comes back from mermaid is not fit to inline as it stands, and this is
 * where that is fixed — no browser involved, so it is testable on its own:
 *
 *   - **Inline styles are removed.** Mermaid puts `style` attributes on the
 *     root and on a hundred inner elements, and a strict `style-src` blocks
 *     every one of them. Style *attributes* cannot even be allowed by hash, so
 *     they are turned into classes and the declarations move to the stylesheet.
 *     Across a set of six diagrams the 182 occurrences resolved to 28 distinct
 *     declarations, so this shrinks the output as well as unblocking it.
 *   - **The embedded `<style>` element is lifted out**, for the same reason and
 *     to the same place: the generated deck stylesheet, which is where
 *     `--slide-background` already goes.
 *   - **Ids are renumbered from the content hash.** Mermaid's own are a
 *     per-diagram-type counter that keeps climbing as a page renders more
 *     diagrams, so the same diagram comes out differently depending on what was
 *     rendered before it. Positional ids make a rebuild byte-identical, which
 *     is what lets the stylesheet be served immutable.
 *   - **Lengths are rounded.** Not path data: rounding inside `d=""` with a
 *     regex produces coordinates a browser rejects, and only a tenth of the
 *     long floats live there anyway.
 */

/** A fence asking for a diagram, and where the author wrote it. */
export interface DiagramRef {
  readonly source: string
  /**
   * Lines into the slide body, so `slide.sourceLine + line` is the line in the
   * file — the same arithmetic an embed error does.
   */
  readonly line: number
}

/** What the renderer produced for one diagram, ready to inline. */
export interface Diagram {
  readonly svg: string
  readonly css: string
}

/** Looks a rendered diagram up by its source; supplied to the renderer as env. */
export type DiagramLookup = (source: string) => Diagram | undefined

const LANGUAGE = 'mermaid'

/**
 * Every mermaid fence in a slide body, including the ones inside a `::: right`
 * region — a region's content is held on its token rather than parsed in
 * place, so it has to be walked rather than found in the top-level stream.
 */
export function findDiagrams(md: MarkdownIt, body: string): DiagramRef[] {
  const found: DiagramRef[] = []
  collect(md, body, 0, found)
  return found
}

function collect(md: MarkdownIt, body: string, offset: number, found: DiagramRef[]): void {
  let tokens: Token[]
  try {
    tokens = md.parse(body, {})
  } catch {
    // A body that will not parse is the renderer's problem to report, with a
    // better message than anything this pass could manage.
    return
  }

  for (const token of tokens) {
    const start = token.map?.[0] ?? 0

    if (token.type === 'fence' && fenceLanguage(token.info) === LANGUAGE) {
      found.push({ source: token.content, line: offset + start })
      continue
    }

    // The container rules keep their content as text; a diagram inside one is
    // still a diagram.
    if (token.type === 'slide_region' || token.type === 'slide_embed') {
      collect(md, token.content, offset + start + 1, found)
    }
  }
}

export function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0] ?? ''
}

/**
 * Cache and lookup key. The config hash is in it because a recoloured deck is a
 * different diagram, and nothing about its source says so.
 */
export function diagramKey(source: string, configHash: string): string {
  return createHash('sha256').update(configHash).update('\0').update(source).digest('base64url').slice(0, 10)
}

/**
 * Declarations shared by every diagram in a build, each one a class.
 *
 * Shared rather than per-diagram because the same handful of declarations —
 * `stroke: none`, `stroke-width: 0`, a font stack — accounts for nearly all of
 * them, whatever the diagram.
 */
export class DiagramStyles {
  private readonly classes = new Map<string, string>()
  private readonly keyframes = new Map<string, string>()

  classFor(declaration: string): string {
    const existing = this.classes.get(declaration)
    if (existing) return existing

    const name = `sd${this.classes.size.toString(36)}`
    this.classes.set(declaration, name)
    return name
  }

  /** `@keyframes` are global and identical in every diagram, so kept once. */
  addKeyframes(name: string, rule: string): void {
    if (!this.keyframes.has(name)) this.keyframes.set(name, rule)
  }

  rules(): string {
    return [
      ...this.keyframes.values(),
      ...[...this.classes].map(([declaration, name]) => `.${name}{${declaration}}`),
    ].join('')
  }
}

/** Attributes holding plain lengths. `d` is absent on purpose — see above. */
const LENGTH_ATTRIBUTES =
  /\b(x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|viewBox|transform|points|dx|dy|textLength|stroke-width|font-size)="([^"]*)"/g

const LONG_FLOAT = /-?\d+\.\d{3,}/g
const KEYFRAMES = /@keyframes\s+([\w-]+)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g

/**
 * One diagram's raw mermaid output, made inlineable. `key` is what scopes the
 * ids, so the same diagram always produces the same bytes.
 */
export function normalizeDiagram(raw: string, key: string, styles: DiagramStyles): Diagram {
  const scope = `sd-${key}`
  let svg = raw.trim()
  let css = ''

  svg = svg.replace(/<style>([\s\S]*?)<\/style>/g, (_match, body: string) => {
    // `<style>` inside `<svg>` is foreign content, not an HTML raw-text
    // element, so its selectors come back escaped: `text.actor>tspan` arrives
    // as `text.actor&gt;tspan`. Reinserted as HTML that decodes again and
    // nobody notices — but this stylesheet is written to a `.css` file, where
    // the entity is literal text and the rule silently never matches.
    css += unescapeHtml(body)
    return ''
  })

  css = css.replace(KEYFRAMES, (rule, name: string) => {
    styles.addKeyframes(name, rule)
    return ''
  })

  ;({ svg, css } = renameIds(svg, css, scope))

  svg = svg.replace(/(<\w+\b[^>]*?)\sstyle="([^"]*)"/g, (_match, head: string, attribute: string) => {
    const classes: string[] = []

    for (const part of splitDeclarations(unescapeHtml(attribute))) {
      // A measurement of this diagram rather than a shared declaration.
      if (part.startsWith('max-width:')) css += `#${scope}-0{max-width:${emWidth(part)}}`
      else classes.push(styles.classFor(part))
    }

    return classes.length === 0 ? head : withClasses(head, classes)
  })

  svg = svg.replace(LENGTH_ATTRIBUTES, (_match, name: string, value: string) => `${name}="${round(value)}"`)

  return { svg: svg.trim(), css: css.trim() }
}

/**
 * Mermaid's ids become `sd-<hash>-<n>` in document order, in the SVG and in the
 * stylesheet that selects on them. Longest first, so one id is never rewritten
 * inside another.
 */
function renameIds(svg: string, css: string, scope: string): Diagram {
  const ids: string[] = []
  for (const match of svg.matchAll(/\bid="([^"]+)"/g)) {
    const id = match[1]!
    if (!ids.includes(id)) ids.push(id)
  }

  const renamed = new Map(ids.map((id, index) => [id, `${scope}-${index}`]))
  let nextSvg = svg
  let nextCss = css

  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    const to = renamed.get(id)!
    const escaped = escapeRegExp(id)
    // `id="x"`, `href="#x"`, `url(#x)` and the stylesheet's own `#x`.
    nextSvg = nextSvg.replace(new RegExp(`(["'#(])${escaped}(?=["')\\s.:>])`, 'g'), `$1${to}`)
    nextCss = nextCss.replace(new RegExp(`#${escaped}\\b`, 'g'), `#${to}`)
  }

  return { svg: nextSvg, css: nextCss }
}

function round(value: string): string {
  return value.replace(LONG_FLOAT, (number) => String(Number(Number(number).toFixed(2))))
}

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
}

/**
 * Serialised SVG is escaped HTML, and both places this pass reads from are
 * affected. A style attribute's font stack arrives with `&quot;` around each
 * family, and splitting on `;` before decoding cuts the declaration in half at
 * the semicolon inside the entity — which is how one font stack became five
 * classes, one of them named after `Segoe UI`.
 */
function unescapeHtml(value: string): string {
  return value.replace(/&(?:quot|#39|apos|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity)
}

/**
 * Declarations, split on the semicolons that separate them rather than the
 * ones inside a quoted font name.
 *
 * A declaration carrying a brace is dropped: these values reach a stylesheet,
 * and closing the rule to open another is the one thing they must not do.
 */
function splitDeclarations(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null

  for (const character of value) {
    if (quote) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === ';') {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)

  return parts.map((part) => part.trim()).filter((part) => part !== '' && !/[{}]/.test(part))
}

/**
 * The diagram's natural width, in `em` rather than the pixels mermaid measured.
 *
 * Everything inside the SVG is in the `viewBox`'s own coordinate space and so
 * scales with the rendered box for nothing. The root's width is the one number
 * that does not, and left in pixels it would be the only thing on a slide that
 * ignores the frame — the theme puts every other size in `cqw`, and `em` here
 * rides the same scale.
 */
function emWidth(declaration: string): string {
  const pixels = Number(/max-width:\s*([\d.]+)px/.exec(declaration)?.[1])
  if (!Number.isFinite(pixels)) return declaration.slice(declaration.indexOf(':') + 1).trim()
  return `${Number((pixels / DIAGRAM_FONT_SIZE).toFixed(2))}em`
}

function withClasses(head: string, classes: string[]): string {
  const existing = /\sclass="([^"]*)"/.exec(head)
  return existing
    ? head.replace(existing[0], ` class="${existing[1]} ${classes.join(' ')}"`)
    : `${head} class="${classes.join(' ')}"`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The diagram in the flow of the slide. `figure` rather than a bare `svg` so it
 * takes the same margins as an image or an embed, and so a caption has
 * somewhere to go if one is ever wanted.
 */
export function renderDiagram(diagram: Diagram): string {
  return `<figure class="slide-diagram">${diagram.svg}</figure>`
}
