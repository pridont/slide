import { readdir, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

/** Files that live in a repository root without being talks. */
const NOT_DECKS = new Set(['readme.md', 'changelog.md', 'license.md', 'licence.md', 'contributing.md'])

const SLIDES_DIR = 'slides'

export interface Discovery {
  /** Absolute paths, sorted. */
  readonly files: string[]
  /** Directory slugs are taken relative to. */
  readonly deckRoot: string
}

/**
 * Finds the decks in a project directory. A `slides/` directory wins and is
 * walked recursively; without one only top-level markdown counts, so a
 * `notes/` or `drafts/` folder never quietly joins the build.
 */
export async function discoverDecks(dir: string): Promise<Discovery> {
  const slidesDir = join(dir, SLIDES_DIR)

  if (await isDirectory(slidesDir)) {
    return { files: await walk(slidesDir, true), deckRoot: slidesDir }
  }

  return { files: await walk(dir, false), deckRoot: dir }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function walk(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive })
  const files: string[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (extname(entry.name).toLowerCase() !== '.md') continue
    if (isHidden(entry.name) || NOT_DECKS.has(entry.name.toLowerCase())) continue

    const path = join(entry.parentPath, entry.name)
    // A hidden or underscored directory anywhere in the path opts out.
    if (relative(dir, path).split(sep).some(isHidden)) continue

    files.push(path)
  }

  return files.sort()
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_')
}
