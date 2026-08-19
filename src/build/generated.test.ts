import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadProject } from '../project/index.js'
import { build } from './index.js'
import { generateDeckCss } from './generated.js'

const workspaces: string[] = []

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'slide-generated-'))
  workspaces.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return dir
}

const identity = (ref: string): string => ref

afterAll(async () => {
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('generated deck CSS', () => {
  it('is empty when nothing needs it', async () => {
    const dir = await workspace({ 'talk.md': '# One\n' })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    expect(generateDeckCss(project, identity)).toBe('')
  })

  it('scopes the aspect ratio to its deck', async () => {
    const dir = await workspace({ 'talk.md': '---\naspectRatio: "4:3"\n---\n\n# One\n' })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    expect(generateDeckCss(project, identity)).toBe('body[data-deck="deck"]{--slide-aspect:4/3}')
  })

  it('scopes a background to its slide', async () => {
    const dir = await workspace({ 'talk.md': '# One\n\n---\nbackground: "#101010"\n---\n\n# Two\n' })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    expect(generateDeckCss(project, identity)).toBe(
      'body[data-deck="deck"][data-slide="2"]{--slide-background: #101010}',
    )
  })

  it('resolves an image background through the asset pipeline', async () => {
    const dir = await workspace({ 'talk.md': '---\nbackground: ./bg.jpg\n---\n\n# One\n' })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    const css = generateDeckCss(project, (ref) => `/assets/${ref.replace('./', '')}-hashed.jpg`)
    expect(css).toContain('--slide-background-image: url("/assets/bg.jpg-hashed.jpg")')
  })

  it('keeps each deck of a project in its own scope', async () => {
    const dir = await workspace({
      'slides/one.md': '---\naspectRatio: "4:3"\n---\n\n# One\n',
      'slides/two.md': '---\naspectRatio: "1/1"\n---\n\n# Two\n',
    })
    const project = await loadProject({ entry: dir })

    const css = generateDeckCss(project, identity)
    expect(css).toContain('body[data-deck="one"]{--slide-aspect:4/3}')
    expect(css).toContain('body[data-deck="two"]{--slide-aspect:1/1}')
  })

  it('puts a deck theme on the document element, not the body', async () => {
    const dir = await workspace({ 'talk.md': '---\ntheme:\n  colorAccent: "#ff8800"\n---\n\n# One\n' })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    // On <html>, where the base theme declares its own, at a strength
    // `:root.light` cannot outrank.
    expect(generateDeckCss(project, identity)).toBe(
      'html[data-deck="deck"]:root{--slide-color-accent:#ff8800}',
    )
  })

  it('merges a project theme under each deck, token by token', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ theme: { colorAccent: '#ff8800', fontBody: 'Georgia' } }),
      'slides/one.md': '# One\n',
      'slides/two.md': '---\ntheme:\n  colorAccent: "#00aaff"\n---\n\n# Two\n',
    })
    const project = await loadProject({ entry: dir })

    const css = generateDeckCss(project, identity)
    expect(css).toContain(
      'html[data-deck="one"]:root{--slide-color-accent:#ff8800;--slide-font-body:Georgia}',
    )
    // The deck's own value wins for the token it names, and inherits the rest.
    expect(css).toContain(
      'html[data-deck="two"]:root{--slide-color-accent:#00aaff;--slide-font-body:Georgia}',
    )
    // The index page has no deck of its own to hang the project theme on.
    expect(css).toContain(':root:root{--slide-color-accent:#ff8800;--slide-font-body:Georgia}')
  })

  it('rejects a mistyped token against the line that wrote it', async () => {
    const dir = await workspace({ 'talk.md': '---\ntheme:\n  colorAcent: "#ff8800"\n---\n\n# One\n' })

    await expect(loadProject({ entry: join(dir, 'talk.md') })).rejects.toThrow(
      /talk\.md:2 unknown theme token "colorAcent"\. Did you mean "color-accent"\?/,
    )
  })

  it('emits a deck-supplied font face with the file hashed', async () => {
    const dir = await workspace({
      'talk.md': '---\nfonts:\n  Inter: ./inter.woff2\ntheme:\n  fontBody: Inter, sans-serif\n---\n\n# One\n',
      'inter.woff2': 'not really a font',
    })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    const css = generateDeckCss(project, (ref) => `/assets/${ref.replace('./', '')}-hashed`)
    expect(css).toContain(
      '@font-face{font-family:"Inter";src:url("/assets/inter.woff2-hashed") format("woff2")',
    )
    // Ahead of anything that might use it.
    expect(css.indexOf('@font-face')).toBeLessThan(css.indexOf('--slide-font-body'))
  })

  it('declares a project font once, however many decks use it', async () => {
    const dir = await workspace({
      'slide.config.json': JSON.stringify({ fonts: { Inter: './inter.woff2' } }),
      'inter.woff2': 'not really a font',
      'slides/one.md': '# One\n',
      'slides/two.md': '# Two\n',
    })
    const project = await loadProject({ entry: dir })

    const css = generateDeckCss(project, identity)
    expect(css.match(/@font-face/g)).toHaveLength(1)
  })

  it('refuses two decks that disagree about what a family is', async () => {
    const dir = await workspace({
      'slides/one.md': '---\nfonts:\n  Inter: ./one.woff2\n---\n\n# One\n',
      'slides/two.md': '---\nfonts:\n  Inter: ./two.woff2\n---\n\n# Two\n',
    })
    const project = await loadProject({ entry: dir })

    // A family name is global to the page, so last-loaded would otherwise win.
    expect(() => generateDeckCss(project, identity)).toThrow(/two decks declare "Inter" as different files/)
  })

  it('cannot be broken out of by a stray brace', async () => {
    const dir = await workspace({
      'talk.md': '---\nbackground: "red} body{display:none"\n---\n\n# One\n',
    })
    const project = await loadProject({ entry: join(dir, 'talk.md') })

    const css = generateDeckCss(project, identity)
    // Braces gone, so the value cannot close the declaration and open a rule.
    // What is left is a nonsense colour, confined to the author's own slide.
    expect(css).not.toContain('body{')
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css.match(/\}/g)).toHaveLength(1)
  })
})

describe('what a built page depends on', () => {
  async function buildPage(source: string): Promise<{ html: string; files: string[]; out: string }> {
    const dir = await workspace({
      'talk.md': source,
      'bg.jpg': 'not really a jpeg',
      'inter.woff2': 'not a font',
    })
    const out = join(dir, 'out')
    await build({ entry: join(dir, 'talk.md'), outDir: out })
    const entries = await readdir(out, { withFileTypes: true, recursive: true })
    return {
      html: await readFile(join(out, 'index.html'), 'utf8'),
      files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      out,
    }
  }

  it('has no inline script and no inline style attribute', async () => {
    // All a strict CSP would block, bar the speculation rules, which have no
    // static-host-friendly alternative.
    const { html } = await buildPage(
      '---\nbackground: ./bg.jpg\naspectRatio: "4:3"\n---\n\n# One\n\n---\n\n# Two\n',
    )

    expect(html).not.toContain('style=')
    // The only inline script left is the speculation rules block.
    const inlineScripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []
    expect(inlineScripts).toEqual(['<script type="speculationrules">'])
  }, 30_000)

  it('ships one script and one stylesheet, with everything generated inside them', async () => {
    const { html, files, out } = await buildPage('---\naspectRatio: "4:3"\n---\n\n# One\n')

    const scripts = files.filter((name) => name.endsWith('.js'))
    const stylesheets = files.filter((name) => name.endsWith('.css'))
    expect(scripts).toHaveLength(1)
    expect(stylesheets).toHaveLength(1)
    expect(html).toMatch(/<script src="\/assets\/runtime-[\w-]+\.js"><\/script>/)

    // The head hooks are inside that script, ahead of the runtime, rather than
    // a second file the page has to fetch.
    const js = await readFile(join(out, 'assets', scripts[0]!), 'utf8')
    expect(js).toContain('pageswap')
    expect(js.indexOf('pageswap')).toBeLessThan(js.indexOf('slide-presenter'))

    // Nor is the deck CSS a stylesheet of its own: the tokens only mean
    // anything beside the theme they override, so they travel with it.
    expect(await readFile(join(out, 'assets', stylesheets[0]!), 'utf8')).toContain('--slide-aspect:4/3')
  }, 30_000)

  it('puts a deck-supplied font through the asset pipeline', async () => {
    const { html, files, out } = await buildPage('---\nfonts:\n  Inter: ./inter.woff2\n---\n\n# One\n')

    const font = files.find((name) => /^inter-[\w-]+\.woff2$/.test(name))
    expect(font).toBeDefined()

    const stylesheet = files.find((name) => name.endsWith('.css'))
    expect(stylesheet).toBeDefined()

    const css = await readFile(join(out, 'assets', stylesheet!), 'utf8')
    expect(css).toContain(`url("/assets/${font}")`)
    // Linked, not inlined, and nothing about it reaches the page itself.
    expect(html).not.toContain('@font-face')
  }, 30_000)

  it('links exactly one stylesheet when a deck generates no CSS at all', async () => {
    const { html, files } = await buildPage('# One\n')

    expect(files.filter((name) => name.endsWith('.css'))).toHaveLength(1)
    expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(1)
  }, 30_000)
})
