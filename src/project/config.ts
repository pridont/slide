import { readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { loadConfigFromFile } from 'vite'
import { validateFonts, type FontFace } from '../theme/fonts.js'
import { validateTheme } from '../theme/tokens.js'

export interface ProjectConfig {
  /** Shown on the project index page. */
  title?: string
  description?: string
  base?: string
  outDir?: string
  /**
   * Deck files, relative to the project directory, in the order they should be
   * listed. Replaces discovery entirely when present.
   */
  decks?: string[]
  /** Defaults a deck's own frontmatter can override. */
  colorScheme?: 'dark' | 'light'
  aspectRatio?: string
  /**
   * Project-wide design tokens. A deck's own `theme:` is merged over this one
   * token by token, so a deck can change the accent without restating the rest.
   */
  theme?: Record<string, string>
  /** Webfaces every deck may use, in the same shape as deck frontmatter. */
  fonts?: Record<string, unknown>
  /**
   * Directory of layout templates, relative to the project. Each `<name>.html`
   * in it becomes a layout a slide can ask for by that name.
   */
  layouts?: string
  /**
   * Stylesheets to load after the theme, for whatever tokens cannot say — the
   * classes a custom layout invents, most of all. Relative to the project.
   */
  css?: string | string[]
  /** Sizes, in kB, the build should complain past. Zero turns a check off. */
  budget?: { page?: number; asset?: number }
}

const CONFIG_NAMES = [
  'slide.config.ts',
  'slide.config.mts',
  'slide.config.js',
  'slide.config.mjs',
  'slide.config.json',
]

export interface LoadedConfig {
  readonly config: ProjectConfig
  /** Absolute path, or null when the project has no config file. */
  readonly file: string | null
  /** `fonts:` already validated, since the raw mapping is author input. */
  readonly fonts: readonly FontFace[]
}

export async function loadProjectConfig(dir: string): Promise<LoadedConfig> {
  for (const name of CONFIG_NAMES) {
    const path = join(dir, name)
    if (!(await isFile(path))) continue

    const config = path.endsWith('.json')
      ? (JSON.parse(await readFile(path, 'utf8')) as ProjectConfig)
      : // Vite already knows how to bundle and evaluate a TypeScript config
        // file; it hands back whatever the module default-exports.
        (((await loadConfigFromFile({ command: 'build', mode: 'production' }, path, dir, 'silent'))?.config ??
          {}) as ProjectConfig)

    const where = { config: relative(dir, path) }
    if (config.theme) config.theme = validateTheme(config.theme, where)
    const fonts = config.fonts ? validateFonts(config.fonts, where) : []
    return { config, file: path, fonts }
  }

  return { config: {}, file: null, fonts: [] }
}

/** True when a path is one this project's config could live at. */
export function isConfigFile(path: string, dir: string): boolean {
  return CONFIG_NAMES.some((name) => join(dir, name) === path)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
