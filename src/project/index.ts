import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { displayPath, normalizeBase, slugify } from '../build/paths.js'
import { SlideParseError, parseDeck } from '../parse/index.js'
import type { Deck } from '../parse/types.js'
import type { FontFace } from '../theme/fonts.js'
import { loadProjectConfig, type ProjectConfig } from './config.js'
import { discoverDecks } from './discover.js'

export type { ProjectConfig } from './config.js'
export { discoverDecks } from './discover.js'

export interface ProjectDeck {
  readonly deck: Deck
  /** '' for a single-deck build, otherwise the deck's slug. */
  readonly slug: string
  /** Output prefix: '' or 'slug/'. */
  readonly deckBase: string
}

export interface Project {
  /** Directory Vite treats as root — the deck's own directory when single. */
  readonly root: string
  readonly decks: readonly ProjectDeck[]
  readonly config: ProjectConfig
  readonly configFile: string | null
  /** True when the entry was one markdown file rather than a directory. */
  readonly single: boolean
  readonly base: string
  /** `<name>.html` templates from the project's `layouts:` directory. */
  readonly layouts: Readonly<Record<string, string>>
  /** Absolute paths of the project's own stylesheets, in order. */
  readonly styles: readonly string[]
  /** Every file whose change should invalidate the project. */
  readonly watchFiles: readonly string[]
}

export interface LoadProjectOptions {
  /** A markdown file or a directory. */
  readonly entry: string
  /** Overrides the config file's base. */
  readonly base?: string
}

export async function loadProject(options: LoadProjectOptions): Promise<Project> {
  const entry = resolve(options.entry)
  const kind = await entryKind(entry)

  if (kind === 'missing') {
    throw new Error(
      `no such file or directory: ${displayPath(entry)}\n` +
        'Point slide at a markdown file, or at a directory holding one.',
    )
  }

  const single = kind === 'file'

  if (single) {
    const deck = await readDeck(entry)
    return {
      root: dirname(entry),
      decks: [{ deck, slug: '', deckBase: '' }],
      config: {},
      configFile: null,
      single: true,
      base: normalizeBase(options.base ?? '/'),
      // Custom layouts and stylesheets come from a project's config, and a
      // lone markdown file has none.
      layouts: {},
      styles: [],
      watchFiles: [entry],
    }
  }

  const { config, file: configFile, fonts: projectFonts } = await loadProjectConfig(entry)

  const discovery = await discoverDecks(entry)
  if (discovery.files.length === 0 && !config.decks) {
    throw new Error(
      `no decks found in ${displayPath(entry)}\n` +
        'Add a markdown file there, put your decks in a `slides/` directory, or ' +
        'list them in `decks:` in slide.config.',
    )
  }

  // An explicit list sets which decks and in what order — not where slugs are
  // measured from, or naming a deck would silently change its URL.
  const files = config.decks?.map((path) => resolve(entry, path)) ?? discovery.files
  const deckRoot = discovery.deckRoot

  const decks: ProjectDeck[] = []
  for (const file of files) {
    const parsed = await readDeck(file)
    const deck = applyProjectDefaults(parsed, config, projectFonts)
    const slug = deck.meta.slug ? slugify(deck.meta.slug) : slugFromPath(file, deckRoot)
    decks.push({ deck, slug, deckBase: `${slug}/` })
  }

  assertUniqueSlugs(decks)

  const layoutsDir = config.layouts ? resolve(entry, config.layouts) : null
  const layouts = layoutsDir ? await readLayouts(layoutsDir) : {}
  const styles = await resolveStyles(entry, config.css)

  return {
    root: entry,
    decks,
    config,
    configFile,
    single: false,
    base: normalizeBase(options.base ?? config.base ?? '/'),
    layouts,
    styles,
    watchFiles: [
      ...files,
      ...(configFile ? [configFile] : []),
      ...Object.keys(layouts).map((name) => join(layoutsDir ?? '', `${name}.html`)),
      ...styles,
    ],
  }
}

/** The project's own stylesheets, checked here so a typo is not a silent miss. */
async function resolveStyles(dir: string, css: string | string[] | undefined): Promise<string[]> {
  const listed = css === undefined ? [] : Array.isArray(css) ? css : [css]

  const paths: string[] = []
  for (const ref of listed) {
    const path = resolve(dir, ref)
    if (!(await isFile(path))) {
      throw new Error(`no stylesheet at ${displayPath(path)}\nIt is listed in \`css:\` in slide.config.`)
    }
    paths.push(path)
  }
  return paths
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Every `<name>.html` in the layouts directory, read once, by name. */
async function readLayouts(dir: string): Promise<Record<string, string>> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    throw new Error(
      `no layouts directory at ${displayPath(dir)}\n` +
        'The `layouts:` in slide.config points at a directory of `<name>.html` templates.',
    )
  }

  const layouts: Record<string, string> = {}
  for (const name of entries.filter((file) => file.endsWith('.html'))) {
    layouts[basename(name, '.html')] = await readFile(join(dir, name), 'utf8')
  }
  return layouts
}

async function readDeck(file: string): Promise<Deck> {
  const deck = parseDeck(await readFile(file, 'utf8'), file)
  if (deck.slides.length === 0) {
    // Otherwise the build writes nothing and reports success.
    throw new SlideParseError('no slides here — a deck needs at least one line of markdown.', file, 1)
  }
  return deck
}

/**
 * Project settings are defaults; a deck's own frontmatter wins. Tokens merge
 * rather than replace, so a deck can change one and keep the palette.
 */
function applyProjectDefaults(deck: Deck, config: ProjectConfig, projectFonts: readonly FontFace[]): Deck {
  const meta = { ...deck.meta }
  meta.colorScheme ??= config.colorScheme
  meta.aspectRatio ??= config.aspectRatio
  if (config.theme) meta.theme = { ...config.theme, ...meta.theme }

  // Faces add up rather than replace: a project's fonts are available to every
  // deck, and a deck can ship one more of its own.
  if (projectFonts.length > 0) meta.fonts = [...projectFonts, ...(meta.fonts ?? [])]

  return { ...deck, meta }
}

/** `slides/2024/why-rust.md` under `slides/` becomes `2024/why-rust`. */
function slugFromPath(file: string, deckRoot: string): string {
  const path = relative(deckRoot, file)
  // A config can name a deck outside the deck root; then it is just the name.
  const withoutExtension = (path.startsWith('..') ? basename(file) : path).slice(0, -extname(file).length)
  return withoutExtension.split(sep).map(slugify).join('/')
}

function assertUniqueSlugs(decks: readonly ProjectDeck[]): void {
  const seen = new Map<string, string>()
  for (const { slug, deck } of decks) {
    const first = seen.get(slug)
    if (first) {
      throw new Error(
        `two decks resolve to the same URL "${slug}/":\n  ${first}\n  ${deck.file}\n` +
          'Rename one, or set a different `slug:` in its frontmatter.',
      )
    }
    seen.set(slug, deck.file)
  }
}

async function entryKind(path: string): Promise<'file' | 'directory' | 'missing'> {
  try {
    return (await stat(path)).isDirectory() ? 'directory' : 'file'
  } catch {
    return 'missing'
  }
}
