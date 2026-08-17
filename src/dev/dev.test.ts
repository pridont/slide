import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ViteDevServer } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from '../build/index.js'
import { dev } from './index.js'

const DECK = `---
title: Talk
---

# One

---

#### Kicker

## Two

\`\`\`py
def f():
    if x:
        return 1
\`\`\`

---

# Three
`

const servers: ViteDevServer[] = []
const workspaces: string[] = []

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'slide-dev-'))
  workspaces.push(dir)
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content)
  }
  return dir
}

async function startServer(entry: string): Promise<{ origin: string; server: ViteDevServer }> {
  const server = await dev({ entry, port: 0 })
  servers.push(server)
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('dev server reported no address')
  return { origin: url.replace(/\/$/, ''), server }
}

async function start(entry: string): Promise<string> {
  return (await startServer(entry)).origin
}

async function text(url: string): Promise<string> {
  const response = await fetch(url)
  return response.text()
}

/** Polls, because the file watcher does not settle synchronously. */
async function waitFor(url: string, predicate: (html: string) => boolean): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const html = await text(url)
    if (predicate(html)) return html
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`page never satisfied the predicate: ${url}`)
}

/**
 * Same idea, for a URL that does not exist yet rather than a page that changes.
 * Connection errors are part of waiting here: a restart closes the socket.
 */
async function waitForStatus(url: string, status: number): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === status) return response.text()
    } catch {
      // Still coming back up.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${url} never answered ${status}`)
}

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()))
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('dev server', () => {
  it('serves a page per slide at the same URLs the build writes', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    expect(await text(`${origin}/`)).toContain('<h1>One</h1>')
    expect(await text(`${origin}/2/`)).toContain('<h2>Two</h2>')
    expect(await text(`${origin}/3/`)).toContain('<h1>Three</h1>')
  }, 30_000)

  it('injects the Vite client so the overlay and reload work', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    expect(await text(`${origin}/`)).toContain('/@vite/client')
  }, 30_000)

  it('redirects a slide URL without its trailing slash', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    const response = await fetch(`${origin}/2`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/2/')
  }, 30_000)

  it('explains a slide that does not exist instead of failing', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    const response = await fetch(`${origin}/99/`)
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('There is no slide 99')
  }, 30_000)

  it('picks up an edit to the deck', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const entry = join(dir, 'talk.md')
    const origin = await start(entry)

    expect(await text(`${origin}/`)).toContain('<h1>One</h1>')

    await writeFile(entry, DECK.replace('# One', '# Edited'))
    const html = await waitFor(`${origin}/`, (body) => body.includes('<h1>Edited</h1>'))

    expect(html).not.toContain('<h1>One</h1>')
  }, 30_000)

  it('shows a readable page when the deck stops parsing, and recovers', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const entry = join(dir, 'talk.md')
    const origin = await start(entry)

    await writeFile(entry, '---\nlayuot: cover\n---\n\n# One\n')
    const broken = await waitFor(`${origin}/`, (body) => body.includes('will not parse'))
    // The message is escaped on the way into the page, quotes included.
    expect(broken).toContain('Did you mean &quot;layout&quot;')
    expect(broken).toContain('talk.md:2')

    await writeFile(entry, DECK)
    await waitFor(`${origin}/`, (body) => body.includes('<h1>One</h1>'))
  }, 30_000)

  it('serves an embedded HTML file, which Vite would otherwise skip', async () => {
    const dir = await workspace({ 'talk.md': '# One\n\n<iframe src="./embed.html"></iframe>\n' })
    await writeFile(join(dir, 'embed.html'), '<!doctype html><p>embedded</p>')
    const origin = await start(join(dir, 'talk.md'))

    const response = await fetch(`${origin}/embed.html`)
    expect(response.status).toBe(200)
    // Byte for byte, exactly as the build copies it.
    expect(await response.text()).toBe('<!doctype html><p>embedded</p>')
  }, 30_000)

  it('refuses to serve a file outside the deck directory', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    expect((await fetch(`${origin}/../../etc/hosts.html`)).status).toBe(404)
  }, 30_000)
})

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'slide-dev-project-'))
  workspaces.push(dir)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(dir, 'slides', '2026'), { recursive: true })
  await writeFile(join(dir, 'slides', 'intro.md'), DECK)
  await writeFile(join(dir, 'slides', '2026', 'deep.md'), '# Deep one\n\n---\n\n# Deep two\n')
  await writeFile(join(dir, 'slide.config.json'), JSON.stringify({ title: 'Talks' }))
  return dir
}

describe('dev server, multi-deck project', () => {
  it('serves the index at the root', async () => {
    const origin = await start(await project())

    const html = await text(`${origin}/`)
    expect(html).toContain('Talks')
    expect(html).toContain('href="/intro/"')
    expect(html).toContain('href="/2026/deep/"')
  }, 30_000)

  it('serves each deck under its own slug, nesting included', async () => {
    const origin = await start(await project())

    expect(await text(`${origin}/intro/`)).toContain('<h1>One</h1>')
    expect(await text(`${origin}/intro/2/`)).toContain('<h2>Two</h2>')
    expect(await text(`${origin}/2026/deep/`)).toContain('<h1>Deep one</h1>')
    expect(await text(`${origin}/2026/deep/2/`)).toContain('<h1>Deep two</h1>')
  }, 30_000)

  it('redirects a deck URL that is missing its trailing slash', async () => {
    const origin = await start(await project())

    const response = await fetch(`${origin}/intro`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/intro/')
  }, 30_000)

  it('keeps navigation inside the deck being viewed', async () => {
    const origin = await start(await project())

    const html = await text(`${origin}/intro/`)
    expect(html).toContain('data-next="/intro/2/"')
    expect(html).not.toContain('/2026/')
  }, 30_000)

  it('picks up a deck added while running', async () => {
    const dir = await project()
    const origin = await start(dir)

    expect((await fetch(`${origin}/late/`)).status).toBe(404)

    await writeFile(join(dir, 'slides', 'late.md'), '# Added later\n')
    await waitFor(`${origin}/`, (html) => html.includes('href="/late/"'))

    expect(await text(`${origin}/late/`)).toContain('<h1>Added later</h1>')
  }, 30_000)
})

describe('what paints first', () => {
  it('links the theme, rather than waiting for the runtime to inject it', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))
    const html = await text(`${origin}/`)

    // Without the link, every navigation in dev paints an unstyled page until
    // the module graph has run — a white flash between slides.
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1])
    expect(links[0]).toMatch(/base\.css\?direct$/)

    const css = await text(`${origin}${links[0]}`)
    expect(css).toContain('--slide-color-bg')
  }, 30_000)

  it('declares the colour scheme before any stylesheet can say so', async () => {
    const dir = await workspace({ 'talk.md': '---\ncolorScheme: light\n---\n\n# One\n' })
    const origin = await start(join(dir, 'talk.md'))

    expect(await text(`${origin}/`)).toContain('<meta name="color-scheme" content="light">')
  }, 30_000)
})

describe('the presenter window', () => {
  it('is served beside the deck, and links back to the real slide pages', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    const html = await text(`${origin}/presenter/`)
    expect(html).toContain('data-role="presenter"')
    expect(html).toContain('<article data-slide="1" data-url="/">')
    expect(html).toContain('<article data-slide="2" data-url="/2/">')
  }, 30_000)

  it('redirects the URL without its trailing slash', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    const response = await fetch(`${origin}/presenter`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/presenter/')
  }, 30_000)

  it('is reachable per deck in a project, and slides point at their own', async () => {
    const origin = await start(await project())

    expect(await text(`${origin}/intro/presenter/`)).toContain('data-deck="intro"')
    expect(await text(`${origin}/2026/deep/presenter/`)).toContain('data-deck="2026/deep"')
    expect(await text(`${origin}/intro/`)).toContain('data-presenter="/intro/presenter/"')
  }, 30_000)
})

describe('embeds', () => {
  it('serves a directory embed from its index.html, off disk', async () => {
    const dir = await workspace({ 'talk.md': '# One\n\n::: iframe {src=./demo/}\n:::\n' })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'demo'), { recursive: true })
    await writeFile(join(dir, 'demo', 'index.html'), '<!doctype html><p>demo</p>')
    await writeFile(join(dir, 'demo', 'app.js'), 'console.log("demo")')

    const origin = await start(join(dir, 'talk.md'))
    const html = await text(`${origin}/`)

    // No hashing in dev — the same URL the file already has.
    expect(html).toContain('data-embed-src="/demo/index.html"')
    expect(await text(`${origin}/demo/index.html`)).toBe('<!doctype html><p>demo</p>')
    expect((await fetch(`${origin}/demo/app.js`)).status).toBe(200)
  }, 30_000)
})

describe('overflow check', () => {
  const MODULE_URL = '/@id/__x00__virtual:slide-overflow'

  it('is served through the module graph, so Vite can resolve it', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const origin = await start(join(dir, 'talk.md'))

    expect(await text(`${origin}/`)).toContain(`src="${MODULE_URL}"`)

    const response = await fetch(`${origin}${MODULE_URL}`)
    expect(response.status).toBe(200)
    // Carries the URL it should report back to, base included.
    expect(await response.text()).toContain('/_slide/overflow')
  }, 30_000)

  it('is nowhere near the build output', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const out = join(dir, 'out')
    await build({ entry: join(dir, 'talk.md'), outDir: out })

    const html = await readFile(join(out, 'index.html'), 'utf8')
    expect(html).not.toContain('overflow')
  }, 30_000)

  it('turns a report from the page into a line in the terminal', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const { origin, server } = await startServer(join(dir, 'talk.md'))

    const warnings: string[] = []
    server.config.logger.warn = (message: string) => void warnings.push(message)

    const post = (report: unknown): Promise<Response> =>
      fetch(`${origin}/_slide/overflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      })

    const tooTall = { deck: 'deck', slide: 2, vertical: 37, horizontal: 0, clipped: [] }
    expect((await post(tooTall)).status).toBe(204)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('slide 2 loses content to the frame (37px too tall)')

    // Re-reported on every visit to the slide; said once until the deck changes.
    await post(tooTall)
    expect(warnings).toHaveLength(1)

    // A shrunken code block loses content too, and the frame measurement
    // alone cannot see it.
    const clipped = {
      deck: 'deck',
      slide: 3,
      vertical: 0,
      horizontal: 0,
      clipped: [{ tag: 'pre', hidden: 84 }],
    }
    await post(clipped)
    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('slide 3 loses content to the frame (<pre> clipped by 84px)')
  }, 30_000)
})

describe('a config change', () => {
  it('restarts the server when it moves the base, and keeps the port', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    await writeFile(join(dir, 'slide.config.json'), JSON.stringify({ base: '/' }))
    const origin = await start(dir)

    expect((await fetch(`${origin}/talk/`)).status).toBe(200)

    await writeFile(join(dir, 'slide.config.json'), JSON.stringify({ base: '/talks/' }))

    // A reload would not do: `base` is resolved once, at creation, so the
    // page would still point at the old root.
    const html = await waitForStatus(`${origin}/talks/talk/`, 200)
    expect(html).toContain('<h1>One</h1>')
    expect(html).toContain('href="/talks/_slide/decks.css"')
  }, 30_000)
})

describe('dev and build agree', () => {
  it('renders the same slide body through both paths', async () => {
    const dir = await workspace({ 'talk.md': DECK })
    const entry = join(dir, 'talk.md')
    const out = join(dir, 'out')

    await build({ entry, outDir: out })
    const built = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(out, '2/index.html'), 'utf8'),
    )

    const origin = await start(entry)
    const served = await text(`${origin}/2/`)

    // Asset URLs and script tags differ by design; the slide itself must not.
    const main = (html: string) => /<main[\s\S]*?<\/main>/.exec(html)?.[0]
    expect(main(served)).toBe(main(built))

    // Including whitespace inside code, which is content.
    expect(main(served)).toContain('\n    <span class="hljs-keyword">if</span> x:')
  }, 30_000)
})
