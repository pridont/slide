/**
 * What a deck costs, measured rather than remembered.
 *
 * Every payload figure in the README and the documentation comes from here, so
 * they cannot drift from what the build actually emits. `--check` turns the
 * same numbers into a budget CI can fail on.
 *
 *   node scripts/measure.mjs            # the table
 *   node scripts/measure.mjs --json     # the same, machine-readable
 *   node scripts/measure.mjs --check    # fail past the budgets below
 *   node scripts/measure.mjs --mermaid  # what shipping mermaid would cost
 *
 * Brotli, because that is what a static host serves and what "over the wire"
 * means. Needs `pnpm build` first: it drives the real CLI, not the sources.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'dist', 'cli', 'index.js')

/**
 * What the numbers in the docs promise. Generous enough that ordinary work
 * does not trip them, tight enough that a framework arriving by accident does.
 */
const BUDGETS = {
  'a minimal deck': { firstLoad: 6500, requests: 3 },
  'the example deck': { firstLoad: 7500, requests: 3 },
  'a project of four decks': { firstLoad: 12_000, requests: 3 },
}

const brotli = (buffer) =>
  brotliCompressSync(buffer, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength

/** Everything a page tells the browser to fetch, in the order it says so. */
function linkedFrom(html) {
  const grab = (pattern) => [...html.matchAll(pattern)].map((match) => match[1])
  return [...grab(/<link rel="stylesheet" href="([^"]+)"/g), ...grab(/<script[^>]*\bsrc="([^"]+)"/g)]
}

/**
 * The CLI, run for real. Its stderr is the interesting part of a failure —
 * execFileSync would otherwise throw with the raw byte buffer in it.
 */
function buildDeck(entry, out) {
  try {
    execFileSync('node', [CLI, 'build', entry, '--out', out], { cwd: ROOT, stdio: 'pipe' })
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim()
    const hint = /playwright|browserType\.launch/i.test(stderr)
      ? '\n\nA deck with a ```mermaid fence needs a browser to draw it:\n' +
        '  pnpm exec playwright install chromium'
      : ''
    throw new Error(`measuring ${relative(ROOT, entry)} failed.\n\n${stderr}${hint}`)
  }
}

async function measureDeck(label, entry) {
  const out = await mkdtemp(join(tmpdir(), 'slide-measure-'))
  try {
    buildDeck(entry, out)

    // Slide 1 of the first deck: a project puts an index page at the root.
    const files = await tree(out)
    const entryPage = files.includes('index.html') ? 'index.html' : files.find((f) => f.endsWith('.html'))
    const html = await readFile(join(out, entryPage), 'utf8')

    const parts = [{ file: entryPage, bytes: brotli(Buffer.from(html)) }]
    for (const url of linkedFrom(html)) {
      const file = url.replace(/^\//, '')
      parts.push({ file, bytes: brotli(await readFile(join(out, file))) })
    }

    // Every page, so "whatever its length" is a claim and not a hope.
    let whole = 0
    const pages = files.filter((file) => file.endsWith('.html'))
    for (const page of pages) whole += brotli(await readFile(join(out, page)))
    for (const part of parts) if (part.file !== entryPage) whole += part.bytes

    return {
      label,
      entry: relative(ROOT, entry),
      requests: parts.length,
      firstLoad: parts.reduce((total, part) => total + part.bytes, 0),
      wholeDeck: whole,
      pages: pages.length,
      parts,
    }
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}

async function tree(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(relative(dir, join(entry.parentPath, entry.name)))
  }
  return out.sort()
}

/**
 * The other half of the diagram claim: what a browser downloads to draw one
 * flowchart, against the nothing an inlined SVG costs.
 *
 * Measured through a real browser because mermaid loads its diagram types on
 * demand — the bundle size on disk is not what a flowchart pulls.
 */
async function measureMermaid() {
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright', 'index.mjs'))
  const { createServer } = await import('node:http')
  const { extname } = await import('node:path')

  const dist = join(ROOT, 'node_modules', 'mermaid', 'dist')
  const version = JSON.parse(
    await readFile(join(ROOT, 'node_modules', 'mermaid', 'package.json'), 'utf8'),
  ).version

  const page = `<!doctype html><html><body><pre class="mermaid">
flowchart LR
  A[markdown] --> B{fence?}
  B -->|mermaid| C[draw SVG]
  B -->|anything else| D[highlight]
</pre>
<script type="module">
import mermaid from '/mermaid/dist/mermaid.esm.min.mjs'
await mermaid.run()
</script></body></html>`

  const server = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end(page)
      return
    }
    try {
      const body = await readFile(join(dist, path.replace('/mermaid/dist/', '')))
      response.setHeader('Content-Type', extname(path) === '.mjs' ? 'text/javascript' : 'text/plain')
      response.end(body)
    } catch {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise((resolve) => server.listen(4323, resolve))

  const browser = await chromium.launch()
  const tab = await browser.newPage()
  let raw = 0
  let compressed = 0
  let requests = 0

  tab.on('response', async (response) => {
    if (!response.url().includes('/mermaid/')) return
    try {
      const body = await response.body()
      raw += body.byteLength
      compressed += brotli(body)
      requests++
    } catch {
      // A response the page abandoned; it cost nothing to abandon.
    }
  })

  await tab.goto('http://localhost:4323/', { waitUntil: 'networkidle' })
  await tab.waitForTimeout(1500)
  const drawn = await tab.evaluate(() => document.querySelector('svg') !== null)

  await browser.close()
  server.close()

  if (!drawn) throw new Error('mermaid drew nothing — the measurement would be meaningless')
  return { version, requests, raw, compressed }
}

/**
 * What drawing the diagrams adds to a build, which is the fear this approach
 * has to answer: that driving a headless browser would dominate it.
 *
 * The cache is cleared for the cold runs and left alone for the warm ones, so
 * the difference is the drawing and nothing else. Best of three either way —
 * a build this short is mostly noise otherwise.
 */
async function measureDiagrams() {
  const project = join(ROOT, 'examples', 'project')
  const cache = join(ROOT, 'node_modules', '.cache', 'slide')
  const out = await mkdtemp(join(tmpdir(), 'slide-timing-'))

  const run = async (clearCache) => {
    const times = []
    for (let attempt = 0; attempt < 3; attempt++) {
      if (clearCache) await rm(cache, { recursive: true, force: true })
      const started = process.hrtime.bigint()
      buildDeck(project, out)
      times.push(Number(process.hrtime.bigint() - started) / 1e6)
    }
    return Math.min(...times)
  }

  try {
    // Cold first, so the warm run is measuring a cache the cold run filled.
    const cold = await run(true)
    const warm = await run(false)
    return { cold, warm, drawing: cold - warm, count: await countFences(project) }
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}

/** How many ```mermaid fences the project actually draws. */
async function countFences(project) {
  let fences = 0
  for (const file of await tree(project)) {
    if (!file.endsWith('.md')) continue
    const source = await readFile(join(project, file), 'utf8')
    fences += (source.match(/^```mermaid\b/gm) ?? []).length
  }
  return fences
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const ms = (value) => `${Math.round(value)} ms`
const n = (bytes) => bytes.toLocaleString('en-US')

const flags = new Set(process.argv.slice(2))

const decks = [
  await measureDeck('a minimal deck', join(ROOT, 'examples', 'minimal.md')),
  await measureDeck('the example deck', join(ROOT, 'examples', 'basic.md')),
  await measureDeck('a project of four decks', join(ROOT, 'examples', 'project')),
]

const mermaid = flags.has('--mermaid') ? await measureMermaid() : null
const diagrams = flags.has('--diagrams') ? await measureDiagrams() : null

if (flags.has('--json')) {
  console.log(JSON.stringify({ decks, mermaid, diagrams }, null, 2))
} else {
  console.log('\nbrotli -q 11, first slide included\n')
  for (const deck of decks) {
    console.log(
      `  ${deck.label.padEnd(26)} ${String(deck.requests).padStart(2)} requests  ` +
        `${n(deck.firstLoad).padStart(7)} B   (${deck.pages} pages, ${kb(deck.wholeDeck)} in all)`,
    )
    for (const part of deck.parts) {
      console.log(`      ${part.file.padEnd(36)} ${n(part.bytes).padStart(7)} B`)
    }
    console.log()
  }
  if (mermaid) {
    console.log(
      `  mermaid ${mermaid.version}, one flowchart in a browser:\n` +
        `      ${mermaid.requests} requests, ${kb(mermaid.raw)} unpacked, ${kb(mermaid.compressed)} brotli\n` +
        '      slide draws it at build time and ships none of it.\n',
    )
  }
  if (diagrams) {
    console.log(
      `  ${diagrams.count} diagrams, best of three:\n` +
        `      ${ms(diagrams.cold).padStart(7)}  building them from nothing\n` +
        `      ${ms(diagrams.warm).padStart(7)}  rebuilding with the cache, launching no browser\n` +
        `      ${ms(diagrams.drawing).padStart(7)}  the drawing itself, ` +
        `${ms(diagrams.drawing / diagrams.count)} a diagram\n`,
    )
  }
}

if (flags.has('--check')) {
  const over = []
  for (const deck of decks) {
    const budget = BUDGETS[deck.label]
    if (!budget) continue
    if (deck.firstLoad > budget.firstLoad) {
      over.push(`${deck.label}: ${n(deck.firstLoad)} B over the wire, past ${n(budget.firstLoad)} B`)
    }
    if (deck.requests > budget.requests) {
      over.push(`${deck.label}: ${deck.requests} requests, past ${budget.requests}`)
    }
  }

  if (over.length > 0) {
    console.error('\npayload budget exceeded:')
    for (const line of over) console.error(`  ${line}`)
    console.error('\nRaise the budget in scripts/measure.mjs if the cost is meant to be there,')
    console.error('and update the figures in README.md and docs/ to match.\n')
    process.exit(1)
  }
  console.log('payload within budget\n')
}
