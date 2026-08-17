import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { splitSuffix } from '../build/assets.js'

export interface DevAssetResolver {
  resolve: (ref: string) => string
  resolveIfPresent: (ref: string) => string | null
  /** A file, or a directory served from its index.html. */
  resolveEmbed: (ref: string) => string
  /** References that pointed at nothing, for the console. */
  readonly missing: string[]
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Nothing is hashed or copied in dev — Vite serves the disk. A reference only
 * has to become a URL it answers: root-relative under the deck's directory,
 * `/@fs/` outside it.
 */
export function createDevAssetResolver(deckFile: string, root: string, base: string): DevAssetResolver {
  const missing: string[] = []

  const lookup = (ref: string, report: boolean): string | null => {
    const [path = '', suffix = ''] = splitSuffix(ref)
    const absolute = resolve(dirname(deckFile), decodeURIComponent(path))

    if (!existsSync(absolute)) {
      if (report && !missing.includes(ref)) missing.push(ref)
      return null
    }

    const relativePath = relative(root, absolute)
    if (relativePath.startsWith('..')) return `/@fs${absolute}${suffix}`
    return `${base}${relativePath.split(sep).join('/')}${suffix}`
  }

  return {
    resolve: (ref) => lookup(ref, true) ?? ref,
    resolveIfPresent: (ref) => lookup(ref, false),
    resolveEmbed: (ref) => {
      const [path = ''] = splitSuffix(ref)
      const absolute = resolve(dirname(deckFile), decodeURIComponent(path))
      const directory = isDirectory(absolute)
      // The build hashes a directory into embeds/<name>-<hash>/index.html; dev
      // serves it off disk, so only the entry file has to be named.
      const entry = directory ? `${ref.replace(/\/*$/, '')}/index.html` : ref
      if (directory && !existsSync(join(absolute, 'index.html'))) {
        missing.push(entry)
        return entry
      }
      return lookup(entry, true) ?? entry
    },
    missing,
  }
}
