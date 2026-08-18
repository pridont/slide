// The documentation site: docs/*.md in, a static site out.
//
// It is deliberately not built with `slide` itself. A deck is one page per
// slide, sized to a projector; documentation is prose you scroll, search in the
// browser and deep-link into. Dogfooding here would make the docs worse to
// read, so the tool builds the *demos* the site links to instead, and this
// script — markdown-it, highlight.js and yaml, all of which are already
// dependencies — builds the pages around them. No framework, no client script.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import { parse as parseYaml } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')
const themeDir = join(root, 'src', 'theme')

const REPO = 'https://github.com/pridont/slide'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'docs-dist' },
    base: { type: 'string', default: '/' },
    serve: { type: 'boolean', default: false },
    port: { type: 'string', default: '4180' },
  },
})

const out = join(root, values.out)
const base = normalizeBase(values.base)

await build()
if (values.serve) await serve()

async function build() {
  const nav = JSON.parse(await readFile(join(docs, 'nav.json'), 'utf8'))
  const pages = []

  for (const section of nav) {
    for (const slug of section.pages) {
      pages.push(await load(slug, section.title))
    }
  }

  const md = createMarkdown()
  await mkdir(out, { recursive: true })

  for (const [index, page] of pages.entries()) {
    const env = { toc: [] }
    const html = md.render(page.body, env)
    const document = layout(page, html, env.toc, nav, pages, index)
    const target = page.slug === 'index' ? join(out, 'index.html') : join(out, page.slug, 'index.html')

    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, document, 'utf8')
  }

  await writeFile(join(out, '404.html'), notFound(nav, pages), 'utf8')
  await copyAssets()

  process.stdout.write(`docs: ${pages.length} pages -> ${values.out}${values.serve ? '' : '\n'}`)
  if (values.serve) process.stdout.write('\n')
}

/** Frontmatter is `title` and `description`; the rest of the file is the page. */
async function load(slug, section) {
  const source = await readFile(join(docs, `${slug}.md`), 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) throw new Error(`docs/${slug}.md has no frontmatter — it needs a title and a description.`)

  const meta = parseYaml(match[1]) ?? {}
  if (!meta.title) throw new Error(`docs/${slug}.md has no title.`)

  return {
    slug,
    section,
    title: meta.title,
    // `nav:` is for a page whose heading does not read as a menu entry — the
    // landing page's heading is the tool's name, and a menu wants a noun.
    navTitle: meta.nav ?? meta.title,
    description: meta.description ?? '',
    url: slug === 'index' ? base : `${base}${slug}/`,
    body: source.slice(match[0].length),
  }
}

async function copyAssets() {
  const assets = join(out, 'assets')
  await mkdir(assets, { recursive: true })

  // The palette and the syntax colours are the deck theme's own files, so the
  // site cannot drift from what a deck actually looks like.
  await cp(join(themeDir, 'tokens.css'), join(assets, 'tokens.css'))
  await cp(join(themeDir, 'highlight.css'), join(assets, 'highlight.css'))

  for (const name of await readdir(join(docs, 'assets'))) {
    await cp(join(docs, 'assets', name), join(assets, name))
  }

  // Hosted so `curl https://<site>/install.sh | sh` works, alongside the raw
  // GitHub URL. Both are the same file.
  await cp(join(root, 'install.sh'), join(out, 'install.sh'))

  // Pages runs Jekyll over an artifact it did not get from an action; this
  // costs one empty file and removes the question.
  await writeFile(join(out, '.nojekyll'), '', 'utf8')
}

function createMarkdown() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, highlight })

  headings(md)
  links(md)
  rawHtml(md)
  tables(md)

  return md
}

/** Highlighted at build time, so none of highlight.js reaches the browser. */
function highlight(code, language) {
  const known = language !== '' && hljs.getLanguage(language) !== undefined
  const body = known ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code)
  const label = known ? `<span class="code__lang">${escapeHtml(language)}</span>` : ''
  return `<div class="code">${label}<pre class="hljs"><code>${body}</code></pre></div>`
}

/**
 * Every h2 and h3 gets an id and an anchor link, and lands in the page's
 * contents list. A documentation URL that cannot point at a section is half a
 * URL.
 */
function headings(md) {
  md.core.ruler.push('docs_headings', (state) => {
    const seen = new Map()

    for (const [index, token] of state.tokens.entries()) {
      if (token.type !== 'heading_open') continue
      if (token.tag !== 'h2' && token.tag !== 'h3') continue

      const inline = state.tokens[index + 1]
      const text = inline?.type === 'inline' ? plainText(inline) : ''
      if (text === '') continue

      const id = unique(slugify(text), seen)
      token.attrSet('id', id)
      state.env.toc.push({ id, text, level: token.tag === 'h2' ? 2 : 3 })
    }
  })

  // The link goes at the end of the heading, not the start: a `#` before the
  // text takes up space even at zero opacity, and indents every heading on the
  // page by its own width.
  const close = md.renderer.rules.heading_close
  md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
    const rendered = close ? close(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
    const id = tokens[idx - 2]?.attrGet?.('id')
    if (!id) return rendered
    return `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${rendered}`
  }
}

/**
 * `./writing.md` is how a link reads in the repository, where the markdown is
 * also the source; here it has to become the built page's URL. A root-relative
 * link has to pick up the base path, which on a project Pages site is not `/`.
 */
function rewriteHref(href) {
  if (href.endsWith('.md') || href.includes('.md#')) {
    const [path, fragment] = href.split('#')
    const slug = path.replace(/^\.\//, '').replace(/\.md$/, '')
    const url = slug === 'index' ? base : `${base}${slug}/`
    return fragment ? `${url}#${fragment}` : url
  }

  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith(base)) {
    return `${base}${href.slice(1)}`
  }

  return href
}

function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
}

function links(md) {
  const open = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token.attrGet('href') ?? ''

    if (isExternal(href)) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    } else {
      token.attrSet('href', rewriteHref(href))
    }

    return open ? open(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
}

/**
 * A page can drop into raw HTML for the things markdown has no syntax for — a
 * row of cards, a pair of buttons — and the links inside it need the same
 * treatment as markdown's own, or they break under a base path.
 */
function rawHtml(md) {
  const HREF = /\b(href|src)="([^"]*)"/g

  for (const name of ['html_block', 'html_inline']) {
    const base_ = md.renderer.rules[name]
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const rendered = base_ ? base_(tokens, idx, options, env, self) : tokens[idx].content
      return rendered.replace(HREF, (match, attribute, href) =>
        isExternal(href) ? match : `${attribute}="${rewriteHref(href)}"`,
      )
    }
  }
}

/** A wide table scrolls in its own box rather than widening the page. */
function tables(md) {
  md.renderer.rules.table_open = () => '<div class="table"><table>'
  md.renderer.rules.table_close = () => '</table></div>'
}

function layout(page, html, toc, nav, pages, index) {
  const previous = pages[index - 1]
  const next = pages[index + 1]

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.slug === 'index' ? page.title : `${page.title} — slide`)}</title>
    ${page.description ? `<meta name="description" content="${escapeHtml(page.description)}" />` : ''}
    <link rel="stylesheet" href="${base}assets/tokens.css" />
    <link rel="stylesheet" href="${base}assets/highlight.css" />
    <link rel="stylesheet" href="${base}assets/docs.css" />
    <link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <a class="skip" href="#content">Skip to content</a>
    <header class="masthead">
      <a class="masthead__name" href="${base}">slide</a>
      <nav class="masthead__links">
        <a href="${base}demo/">Demo deck</a>
        <a href="${base}install/">Install</a>
        <a href="${REPO}" target="_blank" rel="noopener noreferrer">GitHub</a>
      </nav>
    </header>

    <div class="shell">
      ${sidebar(nav, pages, page.slug)}

      <main class="content" id="content">
        <article class="prose">
          <p class="eyebrow">${escapeHtml(page.section)}</p>
          <h1>${escapeHtml(page.title)}</h1>
          ${page.description ? `<p class="lede">${escapeHtml(page.description)}</p>` : ''}
          ${html}
        </article>
        ${pager(previous, next)}
      </main>

      ${contents(toc)}
    </div>

    <footer class="footer">
      <p>MIT licensed. <a href="${REPO}" target="_blank" rel="noopener noreferrer">Source on GitHub</a>.</p>
    </footer>
  </body>
</html>
`
}

/**
 * Twice: a plain nav for a wide screen, and the same list inside a <details>
 * for a narrow one, each hidden by a media query.
 *
 * One element would be neater, and does not work without script: a <details>
 * has to carry `open` in the markup to start expanded, and no media query can
 * take that back for the narrow case. Since the list is a hundred bytes, the
 * duplicate is cheaper than the alternative, which is a menu that needs JS.
 */
function sidebar(nav, pages, current) {
  const bySlug = new Map(pages.map((page) => [page.slug, page]))
  const sections = nav
    .map((section) => {
      const items = section.pages
        .map((slug) => {
          const page = bySlug.get(slug)
          const active = slug === current ? ' class="active" aria-current="page"' : ''
          return `<li><a href="${page.url}"${active}>${escapeHtml(page.navTitle)}</a></li>`
        })
        .join('\n            ')

      return `<div class="sidebar__section">
          <p class="sidebar__title">${escapeHtml(section.title)}</p>
          <ul>
            ${items}
          </ul>
        </div>`
    })
    .join('\n        ')

  return `<nav class="sidebar sidebar--wide" aria-label="Documentation">
        ${sections}
      </nav>

      <details class="sidebar sidebar--narrow">
        <summary class="sidebar__toggle">Documentation</summary>
        <nav class="sidebar__nav" aria-label="Documentation">
        ${sections}
        </nav>
      </details>`
}

function contents(toc) {
  const entries = toc.filter((entry) => entry.level === 2)
  if (entries.length < 2) return '<div class="toc"></div>'

  const items = entries
    .map((entry) => `<li><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`)
    .join('\n          ')

  return `<aside class="toc">
        <p class="toc__title">On this page</p>
        <ul>
          ${items}
        </ul>
      </aside>`
}

function pager(previous, next) {
  if (!previous && !next) return ''
  const link = (page, direction, label) =>
    page
      ? `<a class="pager__link pager__link--${direction}" href="${page.url}">
          <span>${label}</span>
          <strong>${escapeHtml(page.navTitle)}</strong>
        </a>`
      : '<span></span>'

  return `<nav class="pager">
          ${link(previous, 'previous', 'Previous')}
          ${link(next, 'next', 'Next')}
        </nav>`
}

function notFound(nav, pages) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Not found — slide</title>
    <link rel="stylesheet" href="${base}assets/tokens.css" />
    <link rel="stylesheet" href="${base}assets/docs.css" />
    <link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <header class="masthead">
      <a class="masthead__name" href="${base}">slide</a>
    </header>
    <div class="shell">
      ${sidebar(nav, pages, '')}
      <main class="content">
        <article class="prose">
          <h1>Not found</h1>
          <p class="lede">That page is not here. The documentation index is a good place to start.</p>
          <p><a href="${base}">Back to the documentation</a></p>
        </article>
      </main>
      <div class="toc"></div>
    </div>
  </body>
</html>
`
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sh': 'text/x-shellscript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** `--serve` is for looking at the site locally; the build is what ships. */
async function serve() {
  const port = Number(values.port)

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let path = decodeURIComponent(url.pathname)
    if (base !== '/' && path.startsWith(base)) path = `/${path.slice(base.length)}`

    let file = join(out, path)
    if (path.endsWith('/')) file = join(file, 'index.html')
    if (!existsSync(file) && existsSync(`${file}/index.html`)) file = `${file}/index.html`

    if (!file.startsWith(out) || !existsSync(file)) {
      response.writeHead(404, { 'content-type': MIME['.html'] })
      createReadStream(join(out, '404.html')).pipe(response)
      return
    }

    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    createReadStream(file).pipe(response)
  })

  await new Promise((resolve) => server.listen(port, resolve))
  process.stdout.write(`, serving http://localhost:${port}${base}\n`)
}

function normalizeBase(value) {
  let path = value.trim()
  if (path === '') path = '/'
  if (!path.startsWith('/')) path = `/${path}`
  if (!path.endsWith('/')) path = `${path}/`
  return path
}

function plainText(inline) {
  return (inline.children ?? [])
    .filter((child) => child.type === 'text' || child.type === 'code_inline')
    .map((child) => child.content)
    .join('')
    .trim()
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

function unique(id, seen) {
  const count = seen.get(id) ?? 0
  seen.set(id, count + 1)
  return count === 0 ? id : `${id}-${count}`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
