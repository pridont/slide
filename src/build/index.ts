import { resolve } from 'node:path'
import { build as viteBuild } from 'vite'
import { loadProject, type Project } from '../project/index.js'
import { slidePlugin, type BuildReport } from './plugin.js'
import { resolveRuntimeEntry } from './runtime-entry.js'

export type { BuildReport } from './plugin.js'
export { normalizeBase, deckSlug, slidePagePath, slideUrl } from './paths.js'

export interface BuildOptions {
  /** A markdown file, or a directory holding a project. */
  readonly entry: string
  readonly outDir?: string
  readonly base?: string
  readonly minify?: boolean
}

export interface BuildOutcome {
  readonly project: Project
  readonly outDir: string
  readonly base: string
  readonly report: BuildReport
}

const ASSETS_DIR = 'assets'

export async function build(options: BuildOptions): Promise<BuildOutcome> {
  const project = await loadProject({
    entry: options.entry,
    ...(options.base !== undefined ? { base: options.base } : {}),
  })

  const outDir = resolve(options.outDir ?? project.config.outDir ?? resolve(project.root, 'dist'))
  const report: BuildReport = { pages: [], assets: [], missing: [], oversize: [], scripts: [], styles: [] }

  await viteBuild({
    root: project.root,
    base: project.base,
    logLevel: 'warn',
    configFile: false,
    plugins: [slidePlugin({ project, assetsDir: ASSETS_DIR, report })],
    build: {
      outDir,
      emptyOutDir: true,
      minify: options.minify ?? true,
      rollupOptions: {
        // One entry for the whole project — what makes the runtime and its
        // stylesheet shared by every page of every deck.
        input: { runtime: resolveRuntimeEntry() },
        output: {
          entryFileNames: `${ASSETS_DIR}/runtime-[hash].js`,
          chunkFileNames: `${ASSETS_DIR}/[name]-[hash].js`,
          assetFileNames: `${ASSETS_DIR}/[name]-[hash][extname]`,
        },
      },
    },
  })

  return { project, outDir, base: project.base, report }
}
