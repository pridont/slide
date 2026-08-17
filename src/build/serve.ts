import { dirname } from 'node:path'
import { preview, type PreviewServer } from 'vite'

export interface PreviewOptions {
  /** Directory holding a finished build. */
  readonly outDir: string
  /** Normalised public base path the build was made for. */
  readonly base: string
  readonly port?: number
  readonly host?: string
  readonly open?: boolean
}

/**
 * Vite's preview server, not the dev server: it serves exactly the files
 * `slide build` wrote, so what you check is what deploys.
 */
export async function previewBuild(options: PreviewOptions): Promise<PreviewServer> {
  const server = await preview({
    // Vite warns if outDir is the root or above it, so root sits one level
    // up. Only outDir is served, so nothing beside it is exposed.
    root: dirname(options.outDir),
    base: options.base,
    configFile: false,
    logLevel: 'warn',
    build: { outDir: options.outDir },
    preview: {
      ...(options.port !== undefined ? { port: options.port, strictPort: false } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.open !== undefined ? { open: options.open } : {}),
    },
  })

  return server
}
