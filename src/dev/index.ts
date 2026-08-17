import type { IncomingMessage } from 'node:http'
import { dirname, resolve } from 'node:path'
import { createServer, type InlineConfig, type ViteDevServer } from 'vite'
import { generateDeckCss } from '../build/generated.js'
import { presenterUrl, slideUrl } from '../build/paths.js'
import { indexEntry } from '../build/plugin.js'
import { clientScript } from '../build/client-script.js'
import { renderProjectDiagrams, type DiagramBundle } from '../build/diagrams.js'
import { MermaidRenderer } from '../build/mermaid.js'
import { resolveRuntimeEntry, resolveThemeStylesheet } from '../build/runtime-entry.js'
import { SlideParseError } from '../parse/errors.js'
import { isConfigFile } from '../project/config.js'
import { loadProject, type Project, type ProjectDeck } from '../project/index.js'
import { createMarkdown, renderPresenter, renderSlidePage } from '../render/index.js'
import { renderIndexPage } from '../render/index-page.js'
import { createDevAssetResolver } from './assets.js'
import { renderErrorPage, renderMissingSlidePage } from './error-page.js'
import { matchRoute } from './routes.js'
import { readEmbeddedHtml } from './static-html.js'

/** Namespace for files dev generates rather than reads off disk. */
const GENERATED_PREFIX = '_slide/'

/**
 * A virtual module, not a middleware route: Vite pre-transforms every
 * `<script type="module">` it serves, and warns on a URL it cannot resolve.
 */
const OVERFLOW_ID = 'virtual:slide-overflow'
const OVERFLOW_RESOLVED = `\0${OVERFLOW_ID}`
/** Vite's own URL space sits under the public base like everything else. */
const overflowUrl = (base: string): string => `${base}@id/__x00__${OVERFLOW_ID}`

export interface DevOptions {
  readonly entry: string
  readonly port?: number
  readonly host?: string
  readonly open?: boolean
  readonly base?: string
}

export async function dev(options: DevOptions): Promise<ViteDevServer> {
  const entry = resolve(options.entry)
  const runtimeEntry = resolveRuntimeEntry()
  // `?direct` is Vite's way of asking for the processed CSS itself rather than
  // the module that would inject it.
  const themeStylesheet = `/@fs${resolveThemeStylesheet()}?direct`

  // Loaded up front for the server's root, then reloaded whenever a file it
  // was built from changes.
  let project = await loadProject({
    entry,
    ...(options.base !== undefined ? { base: options.base } : {}),
  })
  let stale = false

  const root = project.root
  const reported = new Set<string>()

  // One markdown instance and one browser for the whole session. The browser
  // is only launched by a deck that actually draws something, and a diagram
  // whose source has not changed comes back off disk without it.
  const md = createMarkdown()
  const renderer = new MermaidRenderer()
  let diagrams: Promise<DiagramBundle> | null = null

  const current = async (): Promise<Project> => {
    if (stale) {
      project = await loadProject({ entry, ...(options.base !== undefined ? { base: options.base } : {}) })
      stale = false
      diagrams = null
      reported.clear()
    }
    return project
  }

  const currentDiagrams = async (): Promise<DiagramBundle> => {
    const active = await current()
    diagrams ??= renderProjectDiagrams({ project: active, md, renderer })
    try {
      return await diagrams
    } catch (error) {
      // Otherwise a diagram that failed to parse once keeps failing from the
      // memoised promise, and the next save never recovers.
      diagrams = null
      throw error
    }
  }

  // Mutable on purpose: a restart re-resolves this very object, which is how a
  // changed `base` takes effect — see `reconfigure`.
  const inlineConfig: InlineConfig = {
    root,
    base: project.base,
    configFile: false,
    appType: 'custom',
    logLevel: 'warn',
    server: {
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.open !== undefined ? { open: options.open } : {}),
      fs: {
        // The runtime and theme live with the tool, not with the deck.
        allow: [root, dirname(dirname(runtimeEntry))],
      },
    },
    plugins: [
      {
        name: 'slide-dev',

        resolveId(id) {
          return id === OVERFLOW_ID ? OVERFLOW_RESOLVED : null
        },

        load(id) {
          if (id !== OVERFLOW_RESOLVED) return null
          // Unminified: its warnings name a line in this file when an author
          // opens the console.
          return clientScript('overflow', {
            minify: false,
            define: {
              __SLIDE_REPORT_URL__: JSON.stringify(`${inlineConfig.base ?? '/'}${GENERATED_PREFIX}overflow`),
            },
          })
        },

        configureServer(vite) {
          for (const file of project.watchFiles) vite.watcher.add(file)

          /**
           * Vite resolves `base` once, at creation, so a moved base needs a
           * restart — a reload would leave the page asking for the old paths.
           */
          const reconfigure = async (): Promise<void> => {
            let next: Project
            try {
              next = await current()
            } catch {
              // Broken config: stays stale, so the next request renders the
              // error page this reload asks for.
              vite.ws.send({ type: 'full-reload' })
              return
            }
            if (next.base === inlineConfig.base) {
              vite.ws.send({ type: 'full-reload' })
              return
            }
            inlineConfig.base = next.base
            vite.config.logger.info(`slide: base is now ${next.base} — restarting`, { timestamp: true })
            await vite.restart()
          }

          const invalidate = (changed: string): void => {
            const path = resolve(changed)
            const config = isConfigFile(path, root)
            // Any markdown under the root can be a deck, or become one, and a
            // layout template is html under the root. The project is cheap to
            // rebuild, so do not try to be clever.
            if (
              !path.endsWith('.md') &&
              !path.endsWith('.html') &&
              !config &&
              !project.watchFiles.includes(path)
            ) {
              return
            }
            stale = true
            if (config) void reconfigure()
            else vite.ws.send({ type: 'full-reload' })
          }

          vite.watcher.on('change', invalidate)
          vite.watcher.on('add', invalidate)
          vite.watcher.on('unlink', invalidate)

          return () => {
            vite.middlewares.use(async (request, response, next) => {
              const base = inlineConfig.base ?? '/'
              // Vite strips the public base off `req.url`; the pages and the
              // routing both work in URLs that carry it, so put it back.
              const stripped = decodeURI((request.url ?? '/').split('?')[0] ?? '/')
              const pathname = base === '/' ? stripped : `${base.slice(0, -1)}${stripped}`

              if (request.method === 'POST' && pathname === `${base}${GENERATED_PREFIX}overflow`) {
                await readOverflowReport(request, (report) => logOverflow(vite, report, reported))
                response.statusCode = 204
                response.end()
                return
              }

              if (request.method !== 'GET' && request.method !== 'HEAD') return next()

              let active: Project
              let drawn: DiagramBundle
              try {
                active = await current()
                drawn = await currentDiagrams()
              } catch (error) {
                return handleFailure(vite, response, base, error, next)
              }

              // What the build emits as hashed assets, at fixed URLs here.
              if (pathname === `${base}${GENERATED_PREFIX}head.js`) {
                response.statusCode = 200
                response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
                response.end(await clientScript('head'))
                return
              }

              if (pathname === `${base}${GENERATED_PREFIX}decks.css`) {
                const css = generateDeckCss(
                  active,
                  (ref, from) => createDevAssetResolver(from, root, base).resolve(ref),
                  drawn.css,
                )
                response.statusCode = 200
                response.setHeader('Content-Type', 'text/css; charset=utf-8')
                response.end(css)
                return
              }

              const route = matchRoute(pathname, base, active.decks, !active.single)

              if (!route) {
                const embedded = await readEmbeddedHtml(pathname, root, base)
                if (embedded === null) return next()
                response.statusCode = 200
                response.setHeader('Content-Type', 'text/html; charset=utf-8')
                response.end(embedded)
                return
              }

              if (route.kind === 'redirect') {
                response.statusCode = 302
                response.setHeader('Location', route.to)
                response.end()
                return
              }

              const assets = {
                // The theme is linked *and* imported by the runtime: the link
                // is what paints the first frame, the import is what
                // hot-reloads it while an author edits.
                styles: [
                  themeStylesheet,
                  `${base}${GENERATED_PREFIX}decks.css`,
                  ...active.styles.map((path) => createDevAssetResolver(path, root, base).resolve(path)),
                ],
                modules: [`${base}@fs${runtimeEntry}`, overflowUrl(base)],
                head: `${base}${GENERATED_PREFIX}head.js`,
              }

              if (route.kind === 'index') {
                send(response, base, renderProjectIndex(active, root, base, assets), 200)
                return
              }

              const target = active.decks.find((deck) => deck.deckBase === route.deckBase)
              if (!target) return next()

              if (route.kind === 'presenter') {
                const resolver = createDevAssetResolver(target.deck.file, root, base)
                const html = renderPresenter({
                  deck: target.deck,
                  deckId: target.slug || 'deck',
                  md,
                  href: (index) => slideUrl(base, target.deckBase, index),
                  resolveAsset: resolver.resolve,
                  assets,
                })
                send(response, base, html, 200)
                return
              }

              const slide = target.deck.slides[route.index - 1]
              if (!slide) {
                const html = renderMissingSlidePage(route.index, target.deck, base + target.deckBase)
                send(response, base, html, 404)
                return
              }

              const resolver = createDevAssetResolver(target.deck.file, root, base)
              const diagram = drawn.byDeck.get(target.deck.file)
              const html = renderSlidePage({
                deck: target.deck,
                slide,
                deckId: target.slug || 'deck',
                presenter: presenterUrl(base, target.deckBase),
                md,
                ...(Object.keys(active.layouts).length > 0 ? { templates: active.layouts } : {}),
                ...(diagram ? { diagram } : {}),
                resolveAsset: resolver.resolve,
                resolveAssetIfPresent: resolver.resolveIfPresent,
                resolveEmbed: resolver.resolveEmbed,
                href: (index) => slideUrl(base, target.deckBase, index),
                assets,
              })

              for (const ref of resolver.missing) {
                vite.config.logger.warn(`slide: asset not found: ${ref} (referenced by ${target.deck.file})`)
              }
              for (const warning of target.deck.warnings) {
                vite.config.logger.warn(`slide: ${target.deck.file}:${warning.line} ${warning.message}`)
              }

              send(response, base, html, 200)
            })
          }
        },
      },
    ],
  }

  const server = await createServer(inlineConfig)

  // The render browser outlives every request and nothing else would stop it.
  const close = server.close.bind(server)
  server.close = async () => {
    await renderer.close()
    await close()
  }

  await server.listen()
  return server
}

function renderProjectIndex(
  project: Project,
  root: string,
  base: string,
  assets: { styles: string[]; modules: string[]; head: string },
): string {
  const resolveIfPresent = (ref: string, from: string): string | null =>
    createDevAssetResolver(from, root, base).resolveIfPresent(ref)

  return renderIndexPage({
    title: project.config.title ?? 'Slides',
    description: project.config.description,
    assets,
    colorScheme: project.config.colorScheme,
    entries: project.decks.map((target: ProjectDeck) => indexEntry(project, target, { resolveIfPresent })),
  })
}

interface Response {
  statusCode: number
  setHeader: (key: string, value: string) => void
  end: (body?: string) => void
}

interface OverflowReport {
  readonly deck?: string
  readonly slide?: number
  readonly vertical?: number
  readonly horizontal?: number
  /** Descendants that ended up shorter than their own content. */
  readonly clipped?: readonly { readonly tag?: string; readonly hidden?: number }[]
}

/** Small, dev-only and self-inflicted, so a body cap is enough validation. */
async function readOverflowReport(
  request: IncomingMessage,
  handle: (report: OverflowReport) => void,
): Promise<void> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += (chunk as Buffer).length
    if (bytes > 4096) return
    chunks.push(chunk as Buffer)
  }
  try {
    handle(JSON.parse(Buffer.concat(chunks).toString('utf8')) as OverflowReport)
  } catch {
    // A malformed report is not worth a word to the author.
  }
}

/** Said once per slide, though every visit to it reports again. */
function logOverflow(vite: ViteDevServer, report: OverflowReport, reported: Set<string>): void {
  const parts: string[] = []
  if (report.vertical) parts.push(`${report.vertical}px too tall`)
  if (report.horizontal) parts.push(`${report.horizontal}px too wide`)
  for (const clip of report.clipped ?? []) {
    if (clip.tag && clip.hidden) parts.push(`<${clip.tag}> clipped by ${clip.hidden}px`)
  }
  if (parts.length === 0) return

  const where =
    report.deck && report.deck !== 'deck' ? `${report.deck} slide ${report.slide}` : `slide ${report.slide}`
  const key = `${where}:${parts.join()}`
  if (reported.has(key)) return
  reported.add(key)

  vite.config.logger.warn(
    `slide: ${where} loses content to the frame (${parts.join(', ')}). The build cuts it without a word.`,
    { timestamp: true },
  )
}

function handleFailure(
  vite: ViteDevServer,
  response: Response,
  base: string,
  error: unknown,
  next: (error?: unknown) => void,
): void {
  if (!(error instanceof SlideParseError)) return next(error)

  // Push it at any tab already open, then answer this request too.
  vite.ws.send({
    type: 'error',
    err: { message: error.message, stack: '', plugin: 'slide', id: error.file },
  })
  send(response, base, renderErrorPage(error), 500)
}

/**
 * The Vite client is injected here rather than by `transformIndexHtml`, which
 * also prefixes the public base onto every `src` and `href` — already on these
 * URLs, since they are the ones the build writes. `/talks/` gave `/talks/talks/`.
 */
function send(response: Response, base: string, html: string, status: number): void {
  const client = `<script type="module" src="${base}@vite/client"></script>`
  const withClient = html.includes('</head>')
    ? html.replace('</head>', `  ${client}\n</head>`)
    : `${client}\n${html}`

  response.statusCode = status
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(withClient)
}
