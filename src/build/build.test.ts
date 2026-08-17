import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from './index.js'

const workspaces: string[] = []

async function workspace(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'slide-build-'))
  workspaces.push(dir)
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content)
  }
  return dir
}

/** Smallest valid PNG, so the asset pipeline has something real to hash. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function tree(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath, entry.name).slice(dir.length + 1))
  }
  return out.sort()
}

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('the size budget', () => {
  it('says nothing about a deck that fits', async () => {
    const dir = await workspace({ 'talk.md': '# One\n' })
    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: join(dir, 'out') })

    expect(report.oversize).toEqual([])
  }, 30_000)

  it('names what went past, biggest first', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ budget: { page: 1, asset: 1 } }),
      'one.md': `# One\n\n![big](./big.png)\n\n${'padding for the page. '.repeat(200)}`,
      'big.png': Buffer.concat([PNG, Buffer.alloc(4000)]),
    })
    const { report } = await build({ entry: dir, outDir: join(dir, 'out') })

    // Every page of the project counts, the index and the presenter included.
    expect(report.oversize.some((over) => over.kind === 'asset')).toBe(true)
    expect(report.oversize.some((over) => over.kind === 'page')).toBe(true)
    expect(report.oversize[0]?.limit).toBe(1024)

    const sizes = report.oversize.map((over) => over.bytes)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(Math.min(...sizes)).toBeGreaterThan(1024)
  }, 30_000)

  it('is off for whichever line the project zeroes', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ budget: { page: 0, asset: 0 } }),
      'one.md': `# One\n\n${'padding for the page. '.repeat(200)}`,
    })
    const { report } = await build({ entry: dir, outDir: join(dir, 'out') })

    expect(report.oversize).toEqual([])
  }, 30_000)
})

describe('embedded pages', () => {
  async function buildEmbed(source: string): Promise<{ html: string; files: string[] }> {
    const dir = await workspace({ 'talk.md': source })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'demo', 'lib'), { recursive: true })
    await writeFile(join(dir, 'demo', 'index.html'), '<!doctype html><script src="./lib/app.js"></script>')
    await writeFile(join(dir, 'demo', 'lib', 'app.js'), 'console.log("demo")')

    const out = join(dir, 'out')
    await build({ entry: join(dir, 'talk.md'), outDir: out })
    return { html: await readFile(join(out, 'index.html'), 'utf8'), files: await tree(out) }
  }

  it('copies a directory embed as a tree, hashed as one', async () => {
    const { html, files } = await buildEmbed('# One\n\n::: iframe {src=./demo/}\n:::\n')

    const entry = files.find((file) => /^embeds\/demo-[\w-]+\/index\.html$/.test(file))
    expect(entry).toBeDefined()
    // Its own files keep their paths, or every relative link inside would break.
    expect(files).toContain(`${entry?.replace('index.html', '')}lib/app.js`)
    expect(html).toContain(`data-embed-src="/${entry}"`)
  }, 30_000)

  it('refuses a directory with no index.html to serve', async () => {
    const dir = await workspace({ 'talk.md': '# One\n\n::: iframe {src=./empty/}\n:::\n' })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'empty'), { recursive: true })
    await writeFile(join(dir, 'empty', 'page.html'), '<!doctype html>')

    await expect(build({ entry: join(dir, 'talk.md'), outDir: join(dir, 'out') })).rejects.toThrow(
      /has no index\.html/,
    )
  }, 30_000)

  it('hashes a single-file embed like any other asset', async () => {
    const dir = await workspace({
      'talk.md': '# One\n\n::: iframe {src=./solo.html}\n:::\n',
      'solo.html': '<!doctype html><p>solo</p>',
    })
    const out = join(dir, 'out')
    await build({ entry: join(dir, 'talk.md'), outDir: out })

    const files = await tree(out)
    expect(files.some((file) => /^assets\/solo-[\w-]+\.html$/.test(file))).toBe(true)
  }, 30_000)
})

describe('build', () => {
  it('emits one page per slide at clean paths, plus one shared chunk', async () => {
    const dir = await workspace({
      'talk.md': '---\ntitle: Talk\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n',
    })
    const out = join(dir, 'out')

    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: out })
    const files = await tree(out)

    expect(files.filter((file) => file.endsWith('.html'))).toEqual([
      '2/index.html',
      '3/index.html',
      'index.html',
      // One presenter window per deck, beside its slides.
      'presenter/index.html',
    ])

    // The shared-chunk requirement: one runtime, one stylesheet, for all pages.
    expect(report.scripts).toHaveLength(1)
    expect(report.styles).toHaveLength(1)
    // The head script is a separate generated file, not a second chunk.
    expect(files.filter((file) => file.endsWith('.js') && !file.includes('head-'))).toHaveLength(1)
    expect(files.filter((file) => file.endsWith('.css'))).toHaveLength(1)

    const first = await readFile(join(out, 'index.html'), 'utf8')
    const second = await readFile(join(out, '2/index.html'), 'utf8')
    expect(first).toContain(report.scripts[0]!)
    expect(second).toContain(report.scripts[0]!)
    expect(first).toContain(report.styles[0]!)
  }, 30_000)

  it('names the runtime chunk and its stylesheet consistently', async () => {
    const dir = await workspace({ 'talk.md': '# One\n' })
    const out = join(dir, 'out')

    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: out })

    expect(report.scripts[0]).toMatch(/^\/assets\/runtime-[\w-]+\.js$/)
    expect(report.styles[0]).toMatch(/^\/assets\/runtime-[\w-]+\.css$/)
  }, 30_000)

  it('hashes referenced images and rewrites the reference', async () => {
    const dir = await workspace({
      'talk.md': '# One\n\n![a picture](./photo.png)\n',
      'photo.png': PNG,
    })
    const out = join(dir, 'out')

    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: out })

    expect(report.assets).toHaveLength(1)
    expect(report.assets[0]!.fileName).toMatch(/^assets\/photo-[\w-]{8}\.png$/)

    const html = await readFile(join(out, 'index.html'), 'utf8')
    expect(html).toContain(`/${report.assets[0]!.fileName}`)
    expect(await tree(out)).toContain(report.assets[0]!.fileName)
  }, 30_000)

  it('emits a shared asset once when several slides reference it', async () => {
    const dir = await workspace({
      'talk.md': '![a](./photo.png)\n\n---\n\n![b](./photo.png)\n',
      'photo.png': PNG,
    })
    const out = join(dir, 'out')

    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: out })

    expect(report.assets).toHaveLength(1)
    expect((await tree(out)).filter((file) => file.endsWith('.png'))).toHaveLength(1)
  }, 30_000)

  it('reports a missing asset instead of failing the build', async () => {
    const dir = await workspace({ 'talk.md': '![gone](./missing.png)\n' })
    const out = join(dir, 'out')

    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: out })

    expect(report.missing.map((entry) => entry.ref)).toEqual(['./missing.png'])
    expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('src="./missing.png"')
  }, 30_000)

  it('honours a public base path', async () => {
    const dir = await workspace({ 'talk.md': '# One\n\n---\n\n# Two\n' })
    const out = join(dir, 'out')

    const { report } = await build({ entry: join(dir, 'talk.md'), outDir: out, base: '/talks/' })

    expect(report.scripts[0]).toMatch(/^\/talks\/assets\//)
    const html = await readFile(join(out, 'index.html'), 'utf8')
    expect(html).toContain('data-next="/talks/2/"')
  }, 30_000)
})
