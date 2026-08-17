import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { SlideParseError } from '../parse/errors.js'

/**
 * Renders mermaid to SVG by driving a headless browser, once per build.
 *
 * A browser is here because mermaid measures text through the DOM — `getBBox`
 * and `getComputedTextLength` are what its layout engines size labels with, and
 * nothing short of a real engine answers those. The alternative was shipping
 * mermaid to the audience, which measured at roughly 400 kB over the wire for
 * a single flowchart against a whole-deck payload of 2.5 kB of JavaScript.
 *
 * Measured, the browser is cheap: about 60 ms to launch, 60 ms to load mermaid,
 * and 27 ms a diagram after that. It is also usually skipped entirely — every
 * diagram is cached on disk by its source and the resolved theme, so a build
 * only launches anything when a diagram is new or changed, and a deck with no
 * diagrams never touches this file.
 *
 * Three arrangements were tried and two rejected: batching every diagram into
 * one `evaluate` saves nothing, because the round trip is not the cost, and
 * spreading them over parallel pages loses more to spin-up than it wins back.
 * One long-lived page, one diagram at a time, is both the simplest and the
 * fastest.
 */

/** Enough of Playwright to drive it, so the dependency stays optional. */
interface Route {
  request: () => { url: () => string }
  fulfill: (response: { status?: number; contentType?: string; body: string | Buffer }) => Promise<void>
}

interface Page {
  goto: (url: string) => Promise<unknown>
  evaluate: <Result, Argument>(
    fn: (argument: Argument) => Result,
    argument: Argument,
  ) => Promise<Awaited<Result>>
}

interface BrowserContext {
  route: (pattern: string, handler: (route: Route) => Promise<void>) => Promise<void>
  newPage: () => Promise<Page>
}

interface Browser {
  newContext: () => Promise<BrowserContext>
  close: () => Promise<void>
}

interface Chromium {
  launch: (options: { headless: boolean }) => Promise<Browser>
}

/** A face the deck ships, loaded so mermaid measures in the deck's own type. */
export interface RenderFont {
  readonly family: string
  readonly data: Buffer
  readonly weight?: string
  readonly style?: string
}

export interface DiagramRequest {
  readonly key: string
  readonly source: string
  /** Where the fence was written, for an error that names a line. */
  readonly file: string
  readonly line: number
}

export interface MermaidRendererOptions {
  /**
   * Every face the project declares. `@font-face` is global to a page and so
   * is this: the faces are loaded once, and each deck's config names whichever
   * family its tokens point at.
   */
  readonly fonts?: readonly RenderFont[]
  /** Overridden in tests; defaults to a cache beside the project. */
  readonly cacheDir?: string
}

/** Nowhere for the page to reach except the files served to it. */
const ORIGIN = 'https://mermaid.slide.local'

/**
 * Mermaid's ESM entry, served off disk. The single-file build would do, and
 * costs five times the setup: it parses every diagram type, where the chunked
 * one loads only what this deck's diagrams reach for.
 */
const MERMAID_MODULE = '/mermaid.esm.min.mjs'

export class MermaidRenderer {
  private readonly options: MermaidRendererOptions
  private readonly memory = new Map<string, string>()
  private browser: Browser | null = null
  private page: Promise<Page> | null = null
  private applied: string | null = null
  private fonts: readonly RenderFont[]
  private fontKey: string

  constructor(options: MermaidRendererOptions = {}) {
    this.options = options
    this.fonts = options.fonts ?? []
    this.fontKey = fontKey(this.fonts)
  }

  /**
   * The faces to measure in. A dev session that adds one has to start a fresh
   * page: a face is loaded when the page is built, and a diagram already drawn
   * in the wrong type would otherwise stay that way.
   */
  configureFonts(fonts: readonly RenderFont[]): void {
    const key = fontKey(fonts)
    if (key === this.fontKey) return

    this.fonts = fonts
    this.fontKey = key
    this.page = null
    this.applied = null
    this.memory.clear()
  }

  /**
   * Raw SVG for every request, by key. Nothing is launched when they are all
   * already known, which is the common case for a rebuild.
   *
   * `config` is per deck, since it carries that deck's resolved palette.
   */
  async render(
    requests: readonly DiagramRequest[],
    config: Record<string, unknown>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const pending: DiagramRequest[] = []

    for (const request of requests) {
      if (out.has(request.key)) continue

      const remembered = this.memory.get(request.key)
      if (remembered !== undefined) {
        out.set(request.key, remembered)
        continue
      }

      const cached = await this.readCache(request.key)
      if (cached !== null) {
        this.memory.set(request.key, cached)
        out.set(request.key, cached)
        continue
      }

      pending.push(request)
    }

    for (const request of pending) {
      const svg = await this.renderOne(request, config)
      this.memory.set(request.key, svg)
      out.set(request.key, svg)
      await this.writeCache(request.key, svg)
    }

    return out
  }

  async close(): Promise<void> {
    const browser = this.browser
    this.browser = null
    this.page = null
    this.applied = null
    if (browser) await browser.close()
  }

  private async renderOne(request: DiagramRequest, config: Record<string, unknown>): Promise<string> {
    const page = await this.ready()

    const serialized = JSON.stringify(config)
    if (this.applied !== serialized) {
      await page.evaluate(configureInPage, config)
      this.applied = serialized
    }

    const result = await page.evaluate(renderInPage, { id: `m-${request.key}`, source: request.source })

    if (!result.ok) {
      throw new SlideParseError(
        `this mermaid diagram did not parse.\n${indent(result.message)}`,
        request.file,
        // Mermaid counts from the start of the diagram, the author counts from
        // the start of the file. `request.line` is the ```mermaid fence itself,
        // and the diagram's own line 1 is the line after it.
        request.line + Math.max(1, result.line ?? 1),
      )
    }

    return result.svg
  }

  private ready(): Promise<Page> {
    this.page ??= this.start()
    return this.page
  }

  private async start(): Promise<Page> {
    const { chromium } = await loadPlaywright()
    const dist = mermaidDist()

    const browser = await chromium.launch({ headless: true })
    this.browser = browser

    const context = await browser.newContext()

    // Mermaid's own dist, served off disk. Handing the page the single-file
    // build instead costs five times the setup, because it parses every
    // diagram type rather than the chunks this deck's diagrams reach for.
    await context.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname

      if (path === '/') {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body>' })
        return
      }

      const file = resolve(dist, `.${path}`)
      if (!file.startsWith(dist) || !existsSync(file)) {
        await route.fulfill({ status: 404, body: '' })
        return
      }
      await route.fulfill({ contentType: 'text/javascript', body: readFileSync(file) })
    })

    const page = await context.newPage()
    await page.goto(`${ORIGIN}/`)

    await page.evaluate(loadInPage, {
      module: MERMAID_MODULE,
      fonts: this.fonts.map((font) => ({
        family: font.family,
        base64: font.data.toString('base64'),
        ...(font.weight !== undefined ? { weight: font.weight } : {}),
        ...(font.style !== undefined ? { style: font.style } : {}),
      })),
    })

    return page
  }

  /**
   * The font fingerprint is in the filename rather than the caller's key: what
   * a deck's tokens name is part of the config already, but the *bytes* behind
   * that name are not, and a swapped file changes every measurement.
   */
  private cachePath(key: string): string | null {
    const dir = this.options.cacheDir ?? defaultCacheDir()
    return dir === null ? null : join(dir, `${key}-${this.fontKey}.svg`)
  }

  private async readCache(key: string): Promise<string | null> {
    const path = this.cachePath(key)
    if (path === null) return null
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  }

  private async writeCache(key: string, svg: string): Promise<void> {
    const path = this.cachePath(key)
    if (path === null) return
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, svg, 'utf8')
    } catch {
      // A cache that cannot be written is slower, not broken.
    }
  }
}

/**
 * Runs inside the page. Returns rather than throws, because only the message
 * survives the trip out and mermaid's parse errors carry the line separately.
 */
function renderInPage(input: {
  id: string
  source: string
}): Promise<{ ok: true; svg: string } | { ok: false; message: string; line: number | null }> {
  interface MermaidError {
    message?: string
    hash?: { loc?: { first_line?: number } }
  }
  const api = (
    globalThis as unknown as {
      __slideMermaid: { render: (id: string, src: string) => Promise<{ svg: string }> }
    }
  ).__slideMermaid

  return api.render(input.id, input.source).then(
    ({ svg }) => ({ ok: true, svg }) as const,
    (error: MermaidError) => {
      // A failed render leaves its half-drawn diagram behind; the next one
      // would inherit the mess.
      document.body.replaceChildren()
      return {
        ok: false,
        message: String(error?.message ?? error),
        line: error?.hash?.loc?.first_line ?? null,
      } as const
    },
  )
}

/**
 * Runs inside the page: load the deck's own faces, then import mermaid.
 *
 * The faces matter more than they look. Headless Chromium does not have the
 * host's UI font — `ui-sans-serif` measured a string 7% narrower there than
 * `system-ui` did — so a diagram sized against the build machine can overflow
 * its boxes on the viewer's. A face loaded here genuinely drives the layout:
 * the same flowchart came out 704.73px wide with the default and 671.21px with
 * one supplied.
 */
async function loadInPage(input: {
  module: string
  fonts: { family: string; base64: string; weight?: string; style?: string }[]
}): Promise<void> {
  for (const font of input.fonts) {
    const binary = atob(font.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const descriptors: Record<string, string> = {}
    if (font.weight !== undefined) descriptors.weight = font.weight
    if (font.style !== undefined) descriptors.style = font.style

    const face = new FontFace(font.family, bytes.buffer as ArrayBuffer, descriptors)
    await face.load()
    document.fonts.add(face)
  }
  await document.fonts.ready

  // Through a variable, so this is a URL the page fetches rather than a module
  // specifier anything in the build tries to resolve.
  const loaded = (await import(input.module)) as { default: unknown }
  ;(globalThis as unknown as { __slideMermaid: unknown }).__slideMermaid = loaded.default
}

/** Runs inside the page: this deck's palette, type and determinism settings. */
function configureInPage(config: Record<string, unknown>): void {
  const api = (globalThis as unknown as { __slideMermaid: { initialize: (c: unknown) => void } })
    .__slideMermaid
  api.initialize(config)
}

function fontKey(fonts: readonly RenderFont[]): string {
  if (fonts.length === 0) return '0'

  const hash = createHash('sha256')
  for (const font of fonts) {
    hash
      .update(font.family)
      .update(font.weight ?? '')
      .update(font.style ?? '')
      .update(font.data)
  }
  return hash.digest('base64url').slice(0, 8)
}

const require = createRequire(import.meta.url)

/**
 * Both are optional: only a deck that draws a diagram needs either, and a
 * hard dependency on 83 MB of mermaid plus a browser download would be paid by
 * every deck that does not. Imported through a variable so this stays a
 * runtime lookup rather than something the typechecker insists on finding.
 */
const PLAYWRIGHT = 'playwright'

async function loadPlaywright(): Promise<{ chromium: Chromium }> {
  try {
    return (await import(PLAYWRIGHT)) as { chromium: Chromium }
  } catch {
    throw new Error(missing('playwright'))
  }
}

function mermaidDist(): string {
  try {
    return dirname(require.resolve('mermaid/dist/mermaid.esm.min.mjs'))
  } catch {
    throw new Error(missing('mermaid'))
  }
}

export function mermaidVersion(): string {
  try {
    return (JSON.parse(readFileSync(require.resolve('mermaid/package.json'), 'utf8')) as { version: string })
      .version
  } catch {
    return '0'
  }
}

/**
 * One rendering path, gated — not a client-side fallback. Two paths would drift,
 * and the one that drifted would be the one nobody built a deck against.
 */
function missing(name: string): string {
  return (
    `slide: a deck here has a \`\`\`mermaid fence, which needs ${name}.\n` +
    'Diagrams are drawn at build time so nothing ships to the browser:\n\n' +
    '  pnpm add -D mermaid playwright && pnpm exec playwright install chromium\n'
  )
}

/**
 * `node_modules/.cache/slide`, the way every other build tool caches, falling
 * back to the temp directory when a deck sits nowhere near a package.
 */
function defaultCacheDir(): string | null {
  for (let dir = process.cwd(); ;) {
    if (existsSync(join(dir, 'node_modules'))) return join(dir, 'node_modules', '.cache', 'slide', 'mermaid')
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(tmpdir(), 'slide-mermaid')
}

function indent(message: string): string {
  return message
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
}
