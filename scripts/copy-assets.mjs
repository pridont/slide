// tsc only emits JS. Anything the build ships verbatim — theme CSS, page
// templates — gets mirrored from src/ into dist/ here.
import { cp, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')
const dist = join(root, 'dist')

const COPY_EXTENSIONS = ['.css', '.html']

// The standalone browser scripts ship as source: they are compiled on demand
// rather than imported, so dist needs the .ts, not tsc's output.
const CLIENT_DIR = join(src, 'client')

function shouldCopy(path, name) {
  if (COPY_EXTENSIONS.some((ext) => name.endsWith(ext))) return true
  return path.startsWith(CLIENT_DIR) && name.endsWith('.ts')
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
    } else if (shouldCopy(path, entry.name)) {
      const target = join(dist, path.slice(src.length + 1))
      await mkdir(dirname(target), { recursive: true })
      await cp(path, target)
    }
  }
}

if (existsSync(src)) await walk(src)
