import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transformWithEsbuild } from 'vite'

/**
 * Compiles the standalone browser scripts in `src/client/`.
 *
 * Those are handed to a browser as text rather than imported, so they cannot go
 * through the module graph the way `src/runtime/` does — but they were also not
 * worth writing as string literals, where nothing typechecks them and the
 * minifying was done by hand. They are ordinary TypeScript, compiled here.
 *
 * The sources ship as `.ts` beside the compiled output (see copy-assets), so
 * there is one code path whether slide runs from source or from an install.
 */
export type ClientScript = 'head' | 'overflow'

export interface CompileOptions {
  /** Off for dev-only scripts, where a readable stack trace is worth more. */
  readonly minify?: boolean
  /** esbuild `define` — compile-time constants, e.g. a report URL. */
  readonly define?: Readonly<Record<string, string>>
}

const cache = new Map<string, Promise<string>>()

export function clientScript(name: ClientScript, options: CompileOptions = {}): Promise<string> {
  const key = `${name}:${options.minify ?? true}:${JSON.stringify(options.define ?? {})}`
  const cached = cache.get(key)
  if (cached) return cached

  const compiled = compile(name, options)
  cache.set(key, compiled)
  return compiled
}

async function compile(name: ClientScript, options: CompileOptions): Promise<string> {
  const path = fileURLToPath(new URL(`../client/${name}.ts`, import.meta.url))
  const source = await readFile(path, 'utf8')

  // An IIFE, not a module: the head script has to be a classic script to be
  // parser-blocking, and neither wants to leak its helpers to the page.
  const result = await transformWithEsbuild(source, path, {
    loader: 'ts',
    format: 'iife',
    target: 'es2020',
    minify: options.minify ?? true,
    ...(options.define ? { define: { ...options.define } } : {}),
    sourcemap: false,
  })

  return result.code.trim()
}
