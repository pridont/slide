import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'
import type { Project, ProjectDeck } from '../project/index.js'
import { createMarkdown, renderPresenter, renderSlidePage } from '../render/index.js'
import { renderIndexPage, type IndexEntry } from '../render/index-page.js'
import { isResolvableRef } from '../render/html.js'
import { AssetEmitter, type EmittedAsset, type MissingAsset } from './assets.js'
import { clientScript } from './client-script.js'
import { renderProjectDiagrams } from './diagrams.js'
import { generateDeckCss, hashedFileName } from './generated.js'
import { MermaidRenderer } from './mermaid.js'
import { displayPath, presenterPagePath, presenterUrl, slidePagePath, slideUrl } from './paths.js'

export interface EmittedPage {
  readonly fileName: string
  readonly bytes: number
}

/** A page or an asset past the size the project asked to hear about. */
export interface Oversize {
  readonly kind: 'page' | 'asset'
  readonly fileName: string
  readonly bytes: number
  readonly limit: number
}

/** Mutable by design — the plugin fills it in during `generateBundle`. */
export interface BuildReport {
  pages: EmittedPage[]
  assets: EmittedAsset[]
  missing: MissingAsset[]
  oversize: Oversize[]
  /** Public URLs of every script and stylesheet a page links. */
  scripts: string[]
  styles: string[]
}

export interface SlidePluginOptions {
  readonly project: Project
  readonly assetsDir: string
  readonly report: BuildReport
}

/**
 * Emits every slide page in `generateBundle`, rather than through Vite's HTML
 * pipeline, which wants entry documents on disk under `root` and mirrors their
 * paths into the output. Here the output paths are ours, and the runtime
 * chunk's hashed name is known by the time the pages linking it are written.
 */
export function slidePlugin(options: SlidePluginOptions): Plugin {
  const { project } = options

  return {
    name: 'slide',
    apply: 'build',
    enforce: 'post',

    async generateBundle(_outputOptions, bundle) {
      const scripts: string[] = []
      const bundledCss = new Set<string>()

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.isEntry) continue
        scripts.push(project.base + output.fileName)
        for (const css of output.viteMetadata?.importedCss ?? []) bundledCss.add(css)
      }

      const assets = new AssetEmitter(project.base, options.assetsDir, (fileName, source) => {
        this.emitFile({ type: 'asset', fileName, source })
      })

      // Parser-blocking and external — see src/client/head.ts for why.
      const head = await clientScript('head')
      const headFileName = hashedFileName(options.assetsDir, 'head', head, '.js')
      this.emitFile({ type: 'asset', fileName: headFileName, source: head })

      // One markdown instance for the whole build: the diagram pass parses
      // every slide to find its fences, and the pages parse them again.
      const md = createMarkdown()

      // Diagrams before the stylesheet, because they contribute to it, and the
      // stylesheet before the pages, because they link it. A project with no
      // ```mermaid fence never launches anything.
      const renderer = new MermaidRenderer()
      let diagrams
      try {
        diagrams = await renderProjectDiagrams({ project, md, renderer })
      } finally {
        await renderer.close()
      }

      const deckCss = generateDeckCss(project, (ref, from) => assets.resolve(ref, from), diagrams.css)

      // The theme, then what the decks generated, then the project's own — in
      // that order, so a project stylesheet can override everything it loads
      // after. Concatenated rather than linked one after another: three
      // requests that always arrive together are one request.
      const styleUrls = [
        mergeStylesheets({
          bundle,
          bundledCss,
          extra: [deckCss, ...(await projectStyles(project))],
          base: project.base,
          assetsDir: options.assetsDir,
          emit: (fileName, source) => this.emitFile({ type: 'asset', fileName, source }),
        }),
      ]

      const pageAssets = {
        styles: styleUrls,
        modules: scripts,
        head: project.base + headFileName,
      }
      const pages: EmittedPage[] = []
      const hasLayouts = Object.keys(project.layouts).length > 0

      const emit = (fileName: string, html: string): void => {
        this.emitFile({ type: 'asset', fileName, source: html })
        pages.push({ fileName, bytes: Buffer.byteLength(html) })
      }

      for (const target of project.decks) {
        const { deck, deckBase, slug } = target
        const deckId = slug || 'deck'
        const presenter = presenterUrl(project.base, deckBase)

        const diagram = diagrams.byDeck.get(deck.file)

        emit(
          presenterPagePath(deckBase),
          renderPresenter({
            deck,
            deckId,
            md,
            href: (index) => slideUrl(project.base, deckBase, index),
            resolveAsset: (ref) => assets.resolve(ref, deck.file),
            assets: pageAssets,
          }),
        )

        for (const slide of deck.slides) {
          const html = renderSlidePage({
            deck,
            slide,
            deckId,
            presenter,
            md,
            ...(hasLayouts ? { templates: project.layouts } : {}),
            ...(diagram ? { diagram } : {}),
            resolveAsset: (ref) => assets.resolve(ref, deck.file),
            resolveAssetIfPresent: (ref) => assets.resolveIfPresent(ref, deck.file),
            resolveEmbed: (ref) => assets.resolveEmbed(ref, deck.file),
            href: (index) => slideUrl(project.base, deckBase, index),
            assets: pageAssets,
          })

          emit(slidePagePath(deckBase, slide.index), html)
        }
      }

      if (!project.single) {
        emit('index.html', renderProjectIndex(project, assets, pageAssets))
      }

      options.report.pages = pages
      options.report.assets = assets.assets
      options.report.oversize = oversize(project, pages, assets.assets)
      options.report.missing = assets.missing
      // What a page links, not what Vite happened to bundle — the head script
      // and the merged stylesheet are emitted here, past Vite's own pass.
      options.report.scripts = [project.base + headFileName, ...scripts]
      options.report.styles = styleUrls
    },
  }
}

/**
 * One stylesheet for the whole site, out of Vite's own and everything
 * generated after it.
 *
 * Vite's CSS asset is replaced rather than joined by a second link: it is the
 * theme, and the deck tokens that follow it only mean anything alongside it.
 * When there is nothing to add — a deck with no background, no `theme:` and no
 * project stylesheet — Vite's asset is already the whole thing and is left
 * exactly as it is, hash included.
 */
function mergeStylesheets(input: {
  readonly bundle: Record<string, { type: string; source?: unknown }>
  readonly bundledCss: ReadonlySet<string>
  readonly extra: readonly string[]
  readonly base: string
  readonly assetsDir: string
  readonly emit: (fileName: string, source: string) => void
}): string {
  const extra = input.extra.filter((css) => css.trim() !== '')
  const [only] = [...input.bundledCss]

  if (extra.length === 0 && only !== undefined) return input.base + only

  const parts: string[] = []
  for (const fileName of input.bundledCss) {
    const asset = input.bundle[fileName]
    if (asset?.type === 'asset') parts.push(String(asset.source))
    // Deleted from the bundle, not left beside the merged file: a stylesheet
    // nothing links is a stylesheet someone will one day link.
    delete input.bundle[fileName]
  }
  parts.push(...extra)

  const css = parts.join('\n')
  const fileName = hashedFileName(input.assetsDir, 'runtime', css, '.css')
  input.emit(fileName, css)
  return input.base + fileName
}

/**
 * The project's own stylesheets, read rather than copied, since they are
 * concatenated into the one the pages link.
 */
async function projectStyles(project: Project): Promise<string[]> {
  return Promise.all(
    project.styles.map(async (path) => {
      const css = await readFile(path, 'utf8')

      // `@import` is only valid at the top of a stylesheet, so it cannot
      // survive being concatenated after the theme.
      if (/^[^{}]*?@import\b/.test(css)) {
        throw new Error(
          `${displayPath(path)} uses @import.\n` +
            'A build emits one stylesheet, so an @import partway through it would be ignored. ' +
            'List the imported file in `css:` instead — they are concatenated in the order given.',
        )
      }
      return css
    }),
  )
}

function renderProjectIndex(
  project: Project,
  assets: AssetEmitter,
  pageAssets: { styles: string[]; modules: string[]; head: string },
): string {
  return renderIndexPage({
    title: project.config.title ?? 'Slides',
    description: project.config.description,
    assets: pageAssets,
    colorScheme: project.config.colorScheme,
    entries: project.decks.map((target) => indexEntry(project, target, assets)),
  })
}

/**
 * What a slide costs, measured against what the project said it would accept.
 *
 * Defaults rather than silence, because the number that matters is the one
 * nobody thought to look at — but generous ones, since a warning that fires on
 * every build is a warning nobody reads. A deck of photographs is allowed to
 * be a deck of photographs; `budget` in the config moves either line, and a
 * zero turns it off.
 */
const DEFAULT_BUDGET = { page: 100, asset: 1000 } as const

function oversize(project: Project, pages: EmittedPage[], assets: EmittedAsset[]): Oversize[] {
  const budget = { ...DEFAULT_BUDGET, ...project.config.budget }
  const over: Oversize[] = []

  const check = (kind: 'page' | 'asset', fileName: string, bytes: number): void => {
    const limit = budget[kind] * 1024
    if (limit > 0 && bytes > limit) over.push({ kind, fileName, bytes, limit })
  }

  for (const page of pages) check('page', page.fileName, page.bytes)
  for (const asset of assets) check('asset', asset.fileName, asset.bytes)

  return over.sort((a, b) => b.bytes - a.bytes)
}

export function indexEntry(
  project: Project,
  target: ProjectDeck,
  assets: { resolveIfPresent: (ref: string, from: string) => string | null },
): IndexEntry {
  const { deck, deckBase, slug } = target
  const background = deck.slides[0]?.meta.background

  // Only an image; a colour would be a flat wash behind the title.
  const cover =
    background && isResolvableRef(background) && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(background)
      ? assets.resolveIfPresent(background, deck.file)
      : null

  return {
    href: slideUrl(project.base, deckBase, 1),
    title: deck.meta.title ?? slug,
    description: deck.meta.description,
    slides: deck.slides.length,
    cover,
  }
}
