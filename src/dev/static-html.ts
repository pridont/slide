import { readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

/**
 * Serves plain `.html` files a deck references — iframe embeds, mostly.
 *
 * Vite's static middleware skips HTML, leaving it to the HTML middlewares that
 * `appType: 'custom'` switches off; without this an embed works in the build
 * and 404s in dev. Byte-for-byte and untransformed, as the build copies it.
 */
export async function readEmbeddedHtml(pathname: string, root: string, base: string): Promise<string | null> {
  if (!pathname.startsWith(base)) return null
  if (!pathname.endsWith('.html')) return null

  const requested = resolve(join(root, pathname.slice(base.length)))

  // Anything that climbs out of the deck's directory is not ours to serve.
  const inside = relative(root, requested)
  if (inside.startsWith('..')) return null

  try {
    if (!(await stat(requested)).isFile()) return null
    return await readFile(requested, 'utf8')
  } catch {
    return null
  }
}
