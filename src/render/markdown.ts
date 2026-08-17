import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import type { RenderRule } from 'markdown-it/lib/renderer.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import { fenceLanguage, renderDiagram, type DiagramLookup } from './diagram.js'
import { parseEmbed, renderEmbed } from './embed.js'
import { escapeHtml, isExternalUrl, isResolvableRef } from './html.js'

/** Per-render state handed to markdown-it as `env`. */
export interface RenderEnv {
  /**
   * Turns a markdown-relative reference into a URL the bundler can hash.
   * Dev and build supply different implementations; everything else is shared.
   */
  resolveAsset: (ref: string) => string
  /**
   * As `resolveAsset`, but for an embed, where the reference may be a whole
   * directory. Falls back to `resolveAsset` when a caller has no embeds.
   */
  resolveEmbed?: (ref: string) => string
  /** Where this body came from, so an embed error can name a line. */
  source?: { readonly file: string; readonly line: number }
  /**
   * A ```mermaid fence's drawn SVG, from the build's pre-pass. Absent when a
   * deck has no diagrams, and when a caller renders markdown that cannot have
   * any — speaker notes, an embed caption.
   */
  diagram?: DiagramLookup
  /** Filled in during render: `::: right` and friends, by name. */
  regions?: Record<string, string>
  /** Filled in during render: the text of the slide's first heading. */
  title?: string
}

/** Attributes in raw HTML that carry a resolvable reference. */
const RAW_ATTRIBUTE_RE = /\b(src|href|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Link targets we resolve as assets — anything that is not another page. */
const PAGE_EXTENSION_RE = /\.(md|markdown|html?)$/i

export function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight,
  })

  captureTitle(md)
  containers(md)
  diagrams(md)
  rewriteImages(md)
  rewriteLinks(md)
  rewriteRawHtml(md)

  return md
}

/**
 * A ```mermaid fence is a picture, not a code block.
 *
 * The SVG itself is drawn before this runs — see `src/build/diagrams.ts`. It
 * has to be, because markdown-it is synchronous end to end and a diagram is
 * not; this rule only looks the answer up. It is the fence *renderer* rather
 * than markdown-it's `highlight` hook for the same reason the lookup exists:
 * `highlight` is handed no `env`, and `env` is where the answers are.
 */
function diagrams(md: MarkdownIt): void {
  override(md, 'fence', (base) => (tokens, idx, options, env: RenderEnv, self) => {
    const token = tokens[idx]!
    if (fenceLanguage(token.info) !== 'mermaid') return base(tokens, idx, options, env, self)

    const diagram = env.diagram?.(token.content)
    // Nothing drew it: a caption or a speaker note, where a diagram is out of
    // place. Falling back to the source beats rendering nothing at all.
    return diagram ? renderDiagram(diagram) : base(tokens, idx, options, env, self)
  })
}

/**
 * Highlights at build time, so none of highlight.js ships to the browser.
 * Returning the whole `<pre>` is what stops markdown-it wrapping it again.
 * An unknown language falls through to a plain, escaped block.
 */
function highlight(code: string, language: string): string {
  const known = language !== '' && hljs.getLanguage(language) !== undefined
  const body = known ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code)
  const attribute = known ? ` data-language="${escapeHtml(language)}"` : ''
  return `<pre class="hljs"${attribute}><code>${body}</code></pre>`
}

/** Record the first heading's plain text so the page can use it as a title. */
function captureTitle(md: MarkdownIt): void {
  md.core.ruler.push('slide_title', (state) => {
    const env = state.env as RenderEnv
    if (env.title !== undefined) return

    const tokens = state.tokens as Token[]
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type !== 'heading_open') continue
      const inline = tokens[i + 1]
      if (!inline || inline.type !== 'inline') continue
      const text = (inline.children ?? [])
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('')
        .trim()
      if (text !== '') env.title = text
      return
    }
  })
}

const CONTAINER_FENCE = /^:{3,}\s*(\S+)?(.*)$/

/** Container names that put their content somewhere a layout decides. */
const REGIONS = new Set(['right'])

/**
 * `::: iframe {…}` and `::: right`, as one block rule of our own.
 *
 * markdown-it-container plus markdown-it-attrs would do this, but between them
 * they bring a general attribute syntax for every element in the document —
 * far more surface than two containers need, and two more dependencies to keep
 * an eye on.
 *
 * Closing is optional, which is what makes `::: right` read as a splitter:
 * with no `:::` after it, the rest of the slide is the second column.
 */
function containers(md: MarkdownIt): void {
  md.block.ruler.before(
    'fence',
    'slide_embed',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine]! + state.tShift[startLine]!
      const line = state.src.slice(start, state.eMarks[startLine]!)

      const opening = CONTAINER_FENCE.exec(line)
      const name = opening?.[1]
      if (!name || (name !== 'iframe' && !REGIONS.has(name))) return false
      if (silent) return true

      // Unterminated is not an error: the rest of the slide is the embed, the
      // same way an unclosed code fence runs to the end of its block.
      let next = startLine + 1
      for (; next < endLine; next++) {
        const from = state.bMarks[next]! + state.tShift[next]!
        if (/^:{3,}\s*$/.test(state.src.slice(from, state.eMarks[next]!))) break
      }

      const token = state.push(name === 'iframe' ? 'slide_embed' : 'slide_region', 'div', 0)
      token.info = name === 'iframe' ? (opening?.[2] ?? '') : name
      token.map = [startLine, Math.min(next + 1, endLine)]
      token.content = state.getLines(startLine + 1, next, state.blkIndent, false)

      state.line = Math.min(next + 1, endLine)
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )

  md.renderer.rules.slide_embed = (tokens, idx, _options, env: RenderEnv) => {
    const token = tokens[idx]!
    const source = env.source ?? { file: '<deck>', line: 1 }
    const line = source.line + (token.map?.[0] ?? 0)

    const embed = parseEmbed(token.info, { file: source.file, line })
    const url = (env.resolveEmbed ?? env.resolveAsset)(embed.src)
    const caption = token.content.trim() === '' ? '' : md.render(token.content, env)

    return renderEmbed(embed, url, caption)
  }

  /**
   * A region renders nothing where it stands. Its content is handed to the
   * layout instead, which is the only thing that knows whether this deck has
   * somewhere to put it.
   */
  md.renderer.rules.slide_region = (tokens, idx, _options, env: RenderEnv) => {
    const token = tokens[idx]!
    env.regions ??= {}
    env.regions[token.info] = md.render(token.content, { ...env, regions: {} })
    return ''
  }
}

function override(md: MarkdownIt, name: string, wrap: (base: RenderRule) => RenderRule): void {
  const base: RenderRule =
    md.renderer.rules[name] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules[name] = wrap(base)
}

function rewriteImages(md: MarkdownIt): void {
  override(md, 'image', (base) => (tokens, idx, options, env: RenderEnv, self) => {
    const src = tokens[idx]!.attrGet('src')
    if (src && isResolvableRef(src)) tokens[idx]!.attrSet('src', env.resolveAsset(src))
    return base(tokens, idx, options, env, self)
  })
}

function rewriteLinks(md: MarkdownIt): void {
  override(md, 'link_open', (base) => (tokens, idx, options, env: RenderEnv, self) => {
    const token = tokens[idx]!
    const href = token.attrGet('href')
    if (href) {
      if (isExternalUrl(href)) {
        token.attrSet('target', '_blank')
        token.attrSet('rel', 'noopener noreferrer')
      } else if (isResolvableRef(href) && /\.[a-z0-9]+$/i.test(href) && !PAGE_EXTENSION_RE.test(href)) {
        // A link straight at a file (a PDF, say) is an asset; links to other
        // pages are left alone for the router to deal with.
        token.attrSet('href', env.resolveAsset(href))
      }
    }
    return base(tokens, idx, options, env, self)
  })
}

/**
 * markdown-it passes raw HTML through untouched, so hand-written `<img>` and
 * friends would otherwise miss asset hashing entirely.
 */
function rewriteRawHtml(md: MarkdownIt): void {
  for (const name of ['html_block', 'html_inline']) {
    override(md, name, (base) => (tokens, idx, options, env: RenderEnv, self) => {
      const rendered = base(tokens, idx, options, env, self)
      return rewriteRawAttributes(rendered, env.resolveAsset)
    })
  }
}

export function rewriteRawAttributes(html: string, resolveAsset: (ref: string) => string): string {
  return html.replace(
    RAW_ATTRIBUTE_RE,
    (match, attribute: string, doubleQuoted?: string, singleQuoted?: string) => {
      const value = doubleQuoted ?? singleQuoted ?? ''
      const quote = doubleQuoted === undefined ? "'" : '"'

      if (attribute === 'srcset') {
        const rewritten = rewriteSrcset(value, resolveAsset)
        return rewritten === value ? match : `${attribute}=${quote}${rewritten}${quote}`
      }

      if (!isResolvableRef(value)) return match
      return `${attribute}=${quote}${resolveAsset(value)}${quote}`
    },
  )
}

/**
 * `srcset` is a list of candidates — `./a.png 1x, ./a@2x.png 2x` — so every
 * URL in it needs resolving, not just the attribute's whole value.
 *
 * The tool does not resize anything itself: that would mean a native image
 * dependency, and a deck's pictures are the author's own. What it can do is
 * make hand-written candidates go through the asset pipeline like everything
 * else, so the sizes an author prepares are hashed and copied.
 */
function rewriteSrcset(value: string, resolveAsset: (ref: string) => string): string {
  return value
    .split(',')
    .map((candidate) => {
      const match = /^(\s*)(\S+)(\s*.*)$/.exec(candidate)
      if (!match) return candidate

      const [, space = '', url = '', descriptor = ''] = match
      return isResolvableRef(url) ? `${space}${resolveAsset(url)}${descriptor}` : candidate
    })
    .join(',')
}

export interface MarkdownResult {
  readonly html: string
  readonly title: string | null
  /** Content a layout places itself — see `slide_region`. */
  readonly regions: Readonly<Record<string, string>>
}

export interface RenderOptions {
  readonly resolveEmbed?: (ref: string) => string
  readonly diagram?: DiagramLookup
  readonly source?: { readonly file: string; readonly line: number }
}

export function renderMarkdown(
  md: MarkdownIt,
  body: string,
  resolveAsset: (ref: string) => string,
  options: RenderOptions = {},
): MarkdownResult {
  const env: RenderEnv = {
    resolveAsset,
    ...(options.resolveEmbed ? { resolveEmbed: options.resolveEmbed } : {}),
    ...(options.diagram ? { diagram: options.diagram } : {}),
    ...(options.source ? { source: options.source } : {}),
  }
  const html = md.render(body, env)
  return { html, title: env.title ?? null, regions: env.regions ?? {} }
}
