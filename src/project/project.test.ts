import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from '../build/index.js'
import { loadProject } from './index.js'

const workspaces: string[] = []

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'slide-project-'))
  workspaces.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return dir
}

const DECK = (title: string): string => `---\ntitle: ${title}\n---\n\n# ${title}\n\n---\n\n# Second\n`

afterAll(async () => {
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('discovery', () => {
  it('prefers slides/ and walks it recursively', async () => {
    const dir = await workspace({
      'slides/intro.md': DECK('Intro'),
      'slides/2026/deep.md': DECK('Deep'),
      'stray.md': DECK('Stray'),
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks.map((deck) => deck.slug)).toEqual(['2026/deep', 'intro'])
  })

  it('falls back to top-level markdown, without recursing', async () => {
    const dir = await workspace({
      'one.md': DECK('One'),
      'two.md': DECK('Two'),
      'notes/scratch.md': DECK('Scratch'),
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks.map((deck) => deck.slug)).toEqual(['one', 'two'])
  })

  it('leaves repository furniture alone', async () => {
    const dir = await workspace({
      'talk.md': DECK('Talk'),
      'README.md': '# Not a talk',
      'CHANGELOG.md': '# Nope',
      '_draft.md': DECK('Draft'),
      '.hidden.md': DECK('Hidden'),
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks.map((deck) => deck.slug)).toEqual(['talk'])
  })

  it('skips underscored directories inside slides/', async () => {
    const dir = await workspace({
      'slides/live.md': DECK('Live'),
      'slides/_wip/later.md': DECK('Later'),
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks.map((deck) => deck.slug)).toEqual(['live'])
  })
})

describe('slugs', () => {
  it('keeps nesting in the URL', async () => {
    const dir = await workspace({ 'slides/2026/why-rust.md': DECK('Why Rust') })

    const project = await loadProject({ entry: dir })

    expect(project.decks[0]!.slug).toBe('2026/why-rust')
    expect(project.decks[0]!.deckBase).toBe('2026/why-rust/')
  })

  it('lets frontmatter override the path', async () => {
    const dir = await workspace({
      'slides/a-very-long-filename.md': `---\ntitle: Talk\nslug: short\n---\n\n# Talk\n`,
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks[0]!.slug).toBe('short')
  })

  it('refuses two decks that would share a URL', async () => {
    const dir = await workspace({
      'slides/one.md': `---\nslug: same\n---\n\n# One\n`,
      'slides/two.md': `---\nslug: same\n---\n\n# Two\n`,
    })

    await expect(loadProject({ entry: dir })).rejects.toThrow(/resolve to the same URL "same\/"/)
  })
})

describe('layout templates', () => {
  it('reads `<name>.html` from the configured directory', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ layouts: './layouts' }),
      'slides/one.md': '---\nlayout: card\n---\n\n# One\n',
      'layouts/card.html': '<div class="slide-content card">{{content}}</div>',
    })

    const project = await loadProject({ entry: dir })
    expect(Object.keys(project.layouts)).toEqual(['card'])
    // Changed template, changed deck: dev has to know to rebuild.
    expect(project.watchFiles.some((file) => file.endsWith('card.html'))).toBe(true)
  })

  it('reaches the built page', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ layouts: './layouts' }),
      'slides/one.md': '---\nlayout: card\n---\n\n# One\n',
      'layouts/card.html': '<div class="slide-content card">{{content}}</div>',
    })
    const out = join(dir, 'out')

    await build({ entry: dir, outDir: out })
    const html = await readFile(join(out, 'one', 'index.html'), 'utf8')

    expect(html).toContain('<main class="slide layout-card"')
    expect(html).toContain('class="slide-content card"')
  }, 30_000)

  it('says so when the directory is not there', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ layouts: './nope' }),
      'slides/one.md': '# One\n',
    })

    await expect(loadProject({ entry: dir })).rejects.toThrow(/no layouts directory at/)
  })
})

describe('a project stylesheet', () => {
  it('is linked after the theme, hashed like any asset', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ css: './theme.css' }),
      'slides/one.md': '# One\n',
      'theme.css': '.card { color: red }',
    })
    const out = join(dir, 'out')

    await build({ entry: dir, outDir: out })
    const html = await readFile(join(out, 'one', 'index.html'), 'utf8')

    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1])
    expect(links.at(-1)).toMatch(/^\/assets\/theme-[\w-]+\.css$/)
    // Last, so a project can override the theme it loads after.
    expect(links).toHaveLength(2)
  }, 30_000)

  it('says so when the file is not there', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ css: './missing.css' }),
      'slides/one.md': '# One\n',
    })

    await expect(loadProject({ entry: dir })).rejects.toThrow(/no stylesheet at/)
  })
})

describe('config', () => {
  it('sets the order of the decks', async () => {
    const dir = await workspace({
      'slides/alpha.md': DECK('Alpha'),
      'slides/beta.md': DECK('Beta'),
      'slide.config.json': JSON.stringify({ decks: ['slides/beta.md', 'slides/alpha.md'] }),
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks.map((deck) => deck.slug)).toEqual(['beta', 'alpha'])
  })

  it('does not change slugs by naming a deck', async () => {
    // Listing a deck must not move its URL, or the config would be a trap.
    const dir = await workspace({
      'slides/intro.md': DECK('Intro'),
      'slide.config.json': JSON.stringify({ decks: ['slides/intro.md'] }),
    })

    const project = await loadProject({ entry: dir })

    expect(project.decks[0]!.slug).toBe('intro')
  })

  it('supplies defaults a deck can override', async () => {
    const dir = await workspace({
      'slides/plain.md': DECK('Plain'),
      'slides/own.md': `---\ntitle: Own\ncolorScheme: light\n---\n\n# Own\n`,
      'slide.config.json': JSON.stringify({ colorScheme: 'dark', aspectRatio: '4:3' }),
    })

    const project = await loadProject({ entry: dir })
    const bySlug = new Map(project.decks.map((deck) => [deck.slug, deck.deck.meta]))

    expect(bySlug.get('plain')).toMatchObject({ colorScheme: 'dark', aspectRatio: '4:3' })
    expect(bySlug.get('own')).toMatchObject({ colorScheme: 'light', aspectRatio: '4:3' })
  })

  it('loads a TypeScript config', async () => {
    const dir = await workspace({
      'slides/intro.md': DECK('Intro'),
      'slide.config.ts': `export default { title: 'Typed' satisfies string }\n`,
    })

    const project = await loadProject({ entry: dir })

    expect(project.config.title).toBe('Typed')
  })
})

describe('a project build', () => {
  it('namespaces decks and writes an index', async () => {
    const dir = await workspace({
      'slides/intro.md': DECK('Intro'),
      'slides/2026/deep.md': DECK('Deep'),
      'slide.config.json': JSON.stringify({ title: 'Talks', description: 'All of them' }),
    })
    const out = join(dir, 'out')

    const { report } = await build({ entry: dir, outDir: out })

    expect(report.pages.map((page) => page.fileName).sort()).toEqual([
      '2026/deep/2/index.html',
      '2026/deep/index.html',
      // Each deck brings its own presenter window.
      '2026/deep/presenter/index.html',
      'index.html',
      'intro/2/index.html',
      'intro/index.html',
      'intro/presenter/index.html',
    ])

    const index = await readFile(join(out, 'index.html'), 'utf8')
    expect(index).toContain('Talks')
    expect(index).toContain('All of them')
    expect(index).toContain('href="/intro/"')
    expect(index).toContain('href="/2026/deep/"')
    expect(index).toContain('2 slides')
  }, 30_000)

  it('shares one runtime chunk across every deck', async () => {
    const dir = await workspace({
      'slides/one.md': DECK('One'),
      'slides/two.md': DECK('Two'),
    })
    const out = join(dir, 'out')

    const { report } = await build({ entry: dir, outDir: out })

    expect(report.scripts).toHaveLength(1)
    expect(report.styles).toHaveLength(1)

    const [a, b] = await Promise.all([
      readFile(join(out, 'one/index.html'), 'utf8'),
      readFile(join(out, 'two/index.html'), 'utf8'),
    ])
    expect(a).toContain(report.scripts[0]!)
    expect(b).toContain(report.scripts[0]!)
  }, 30_000)

  it('keeps navigation inside its own deck', async () => {
    const dir = await workspace({
      'slides/one.md': DECK('One'),
      'slides/two.md': DECK('Two'),
    })
    const out = join(dir, 'out')

    await build({ entry: dir, outDir: out })
    const first = await readFile(join(out, 'one/index.html'), 'utf8')

    expect(first).toContain('data-next="/one/2/"')
    expect(first).not.toContain('/two/')
  }, 30_000)

  it('still puts a single deck at the output root, with no index page', async () => {
    const dir = await workspace({ 'talk.md': DECK('Talk') })
    const out = join(dir, 'out')

    const { report, project } = await build({ entry: join(dir, 'talk.md'), outDir: out })

    expect(project.single).toBe(true)
    expect(report.pages.map((page) => page.fileName).sort()).toEqual([
      '2/index.html',
      'index.html',
      'presenter/index.html',
    ])
    expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('<h1>Talk</h1>')
  }, 30_000)

  it('honours a base path across decks', async () => {
    const dir = await workspace({
      'slides/one.md': DECK('One'),
      'slides/two.md': DECK('Two'),
    })
    const out = join(dir, 'out')

    await build({ entry: dir, outDir: out, base: '/talks/' })

    const index = await readFile(join(out, 'index.html'), 'utf8')
    expect(index).toContain('href="/talks/one/"')
  }, 30_000)
})
