import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, basename, join, relative, resolve, sep } from 'node:path'
import { slugify } from './paths.js'

export interface MissingAsset {
  readonly ref: string
  /** Markdown file that referenced it. */
  readonly from: string
}

export interface EmittedAsset {
  readonly fileName: string
  readonly bytes: number
}

/**
 * Content-hashes and emits the files a deck references. Hashed here rather
 * than by Vite: slide HTML is emitted in `generateBundle`, after Vite's asset
 * pass has run, so the URLs have to be ones we can compute.
 */
export class AssetEmitter {
  readonly missing: MissingAsset[] = []
  private readonly byPath = new Map<string, string>()
  private readonly emitted = new Map<string, EmittedAsset>()

  constructor(
    private readonly base: string,
    private readonly assetsDir: string,
    private readonly emit: (fileName: string, source: Buffer) => void,
  ) {}

  get assets(): EmittedAsset[] {
    return [...this.emitted.values()]
  }

  /** Resolve a reference from a markdown file into a public URL. */
  resolve(ref: string, fromFile: string): string {
    return this.lookup(ref, fromFile, true) ?? ref
  }

  /** As `resolve`, but for guessed references — a miss is not the author's. */
  resolveIfPresent(ref: string, fromFile: string): string | null {
    return this.lookup(ref, fromFile, false)
  }

  /**
   * An embed: a single self-contained page, or a directory served from its
   * `index.html`.
   *
   * A directory is hashed and emitted as a *tree*, not file by file. Its pages
   * link to each other and to their own stylesheets by relative path, and
   * hashing those individually would break every one of them. The hash covers
   * the whole directory, so the URL still changes when anything inside does.
   */
  resolveEmbed(ref: string, fromFile: string): string {
    const [path = '', suffix = ''] = splitSuffix(ref)
    const absolute = resolve(dirname(fromFile), decodeURIComponent(path))

    if (!isDirectory(absolute)) return this.resolve(ref, fromFile)

    const cached = this.byPath.get(absolute)
    if (cached) return `${this.base}${cached}${suffix}`

    const files = walk(absolute)
    if (!files.includes('index.html')) {
      throw new Error(
        `the embed directory ${ref} has no index.html.\n` +
          'A directory embed is served from its index.html; point `src` at a file instead if it has none.',
      )
    }

    const hash = createHash('sha256')
    for (const file of files) hash.update(file).update(readFileSync(join(absolute, file)))
    const dirName = `${EMBEDS_DIR}/${slugify(basename(absolute))}-${hash.digest('base64url').slice(0, 8)}`

    for (const file of files) {
      const source = readFileSync(join(absolute, file))
      const fileName = `${dirName}/${file}`
      this.emitted.set(fileName, { fileName, bytes: source.byteLength })
      this.emit(fileName, source)
    }

    const entry = `${dirName}/index.html`
    this.byPath.set(absolute, entry)
    return `${this.base}${entry}${suffix}`
  }

  private lookup(ref: string, fromFile: string, report: boolean): string | null {
    const [path = '', suffix = ''] = splitSuffix(ref)
    const absolute = resolve(dirname(fromFile), decodeURIComponent(path))

    const cached = this.byPath.get(absolute)
    if (cached) return `${this.base}${cached}${suffix}`

    let source: Buffer
    try {
      source = readFileSync(absolute)
    } catch {
      if (report) this.missing.push({ ref, from: fromFile })
      return null
    }

    const fileName = `${this.assetsDir}/${hashedName(absolute, source)}`
    this.byPath.set(absolute, fileName)
    this.emitted.set(fileName, { fileName, bytes: source.byteLength })
    this.emit(fileName, source)
    return `${this.base}${fileName}${suffix}`
  }
}

/** Embedded directories keep their shape, so they sit apart from the assets. */
const EMBEDS_DIR = 'embeds'

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Every file under a directory, as posix-ish relative paths, sorted. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/** Separates `./a.png?v=2` into its path and the `?…`/`#…` tail. */
export function splitSuffix(ref: string): [string, string] {
  const match = /[?#]/.exec(ref)
  return match ? [ref.slice(0, match.index), ref.slice(match.index)] : [ref, '']
}

function hashedName(absolute: string, source: Buffer): string {
  const extension = extname(absolute)
  const stem = slugify(basename(absolute, extension))
  const hash = createHash('sha256').update(source).digest('base64url').slice(0, 8)
  return `${stem}-${hash}${extension}`
}
