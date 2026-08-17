#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { displayPath } from '../build/paths.js'
import { SlideParseError } from '../parse/errors.js'
import { build } from '../build/index.js'
import { previewBuild } from '../build/serve.js'
import { dev } from '../dev/index.js'
import { init } from './init.js'

const USAGE = `slide — markdown-based web slideshow builder

Usage:
  slide dev <path> [options]      edit with live reload
  slide build <path> [options]    write a static site
  slide init [path]               write a deck to start from

  <path> is a markdown file — one deck, at the output root — or a directory
  holding several, which builds a project with an index page.

Options:
  --out <dir>    output directory for build (default: dist next to the input)
  --base <path>  public base path (default: /)
  --serve        serve the finished build and stay running (build only)
  --port <n>     port for dev or --serve
  --host <host>  host, e.g. 0.0.0.0 to reach it from a phone
  --open         open a browser
  --no-minify    leave the bundled runtime unminified (build only)
  -v, --version  show the version
  -h, --help     show this message
`

const OPTIONS = {
  out: { type: 'string' },
  base: { type: 'string' },
  serve: { type: 'boolean', default: false },
  port: { type: 'string' },
  host: { type: 'string' },
  open: { type: 'boolean', default: false },
  minify: { type: 'boolean', default: true },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

async function main(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  } catch (error) {
    // parseArgs says what is wrong, not what is allowed.
    process.stderr.write(`slide: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 1
  }

  const { values, positionals } = parsed
  const [command, entry] = positionals

  if (values.version) {
    process.stdout.write(`${version()}\n`)
    return 0
  }

  if (values.help || !command) {
    process.stdout.write(USAGE)
    return values.help ? 0 : 1
  }

  if (command === 'init') {
    const written = await init(entry ?? 'slides.md')
    process.stdout.write(`wrote ${displayPath(written)}\n\nslide dev ${displayPath(written)}\n`)
    return 0
  }

  if (command !== 'build' && command !== 'dev') {
    process.stderr.write(`slide: unknown command "${command}".\n\n${USAGE}`)
    return 1
  }

  if (!entry) {
    process.stderr.write(`slide: ${command} needs a markdown file or a directory of them.\n`)
    return 1
  }

  const port = parsePort(values.port)
  if (values.port !== undefined && port === null) {
    process.stderr.write(`slide: --port must be a number, got "${values.port}".\n`)
    return 1
  }

  if (command === 'dev') {
    const server = await dev({
      entry,
      open: values.open,
      ...(port !== null ? { port } : {}),
      ...(values.host !== undefined ? { host: values.host } : {}),
      ...(values.base !== undefined ? { base: values.base } : {}),
    })

    printUrls(server.resolvedUrls)
    reportPortFallback(port, server.httpServer)
    process.stdout.write('\nediting live · press ctrl-c to stop\n')
    await new Promise(() => {})
  }

  const outcome = await build({
    entry,
    minify: values.minify,
    ...(values.out !== undefined ? { outDir: values.out } : {}),
    ...(values.base !== undefined ? { base: values.base } : {}),
  })

  for (const { deck } of outcome.project.decks) {
    for (const warning of deck.warnings) {
      process.stderr.write(`warning ${deck.file}:${warning.line} ${warning.message}\n`)
    }
  }
  for (const missing of outcome.report.missing) {
    process.stderr.write(`warning: asset not found: ${missing.ref} (referenced by ${missing.from})\n`)
  }
  for (const over of outcome.report.oversize) {
    process.stderr.write(
      `warning: ${over.kind} over budget: ${over.fileName} is ${kb(over.bytes)}, ` +
        `past ${kb(over.limit)} — raise or silence it with \`budget\` in slide.config.\n`,
    )
  }

  const { pages, assets, scripts, styles } = outcome.report
  const pageBytes = pages.reduce((total, page) => total + page.bytes, 0)
  const assetBytes = assets.reduce((total, asset) => total + asset.bytes, 0)
  const decks = outcome.project.decks
  const slides = decks.reduce((total, target) => total + target.deck.slides.length, 0)

  const summary = outcome.project.single
    ? `built ${slides} slides to ${displayPath(outcome.outDir)}`
    : `built ${decks.length} decks, ${slides} slides to ${displayPath(outcome.outDir)}`

  process.stdout.write(
    [
      summary,
      ...(outcome.project.single
        ? []
        : decks.map((target) => `  · ${target.slug}/  ${target.deck.slides.length}`)),
      `  pages   ${pages.length} (${kb(pageBytes)})`,
      `  assets  ${assets.length} (${kb(assetBytes)})`,
      `  shared  ${scripts.length} script, ${styles.length} stylesheet`,
      '',
    ].join('\n'),
  )

  if (values.serve) {
    const server = await previewBuild({
      outDir: outcome.outDir,
      base: outcome.base,
      open: values.open,
      ...(port !== null ? { port } : {}),
      ...(values.host !== undefined ? { host: values.host } : {}),
    })
    printUrls(server.resolvedUrls)
    reportPortFallback(port, server.httpServer)
    process.stdout.write('\npress ctrl-c to stop\n')
    // Resolving here would end the process and take the server with it.
    await new Promise(() => {})
  }

  return 0
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`
}

/** Not the server's own `printUrls()`, which the `warn` log level swallows. */
function printUrls(resolved: { local: readonly string[]; network: readonly string[] } | null): void {
  const urls = [...(resolved?.local ?? []), ...(resolved?.network ?? [])]
  process.stdout.write(`\nserving${urls.length > 0 ? '' : ' (no address reported)'}\n`)
  for (const url of urls) process.stdout.write(`  ${url}\n`)
}

/** Vite moves to the next free port, rightly — but should not do it quietly. */
function reportPortFallback(requested: number | null, httpServer: { address: () => unknown } | null): void {
  if (requested === null) return
  const address = httpServer?.address()
  const actual =
    typeof address === 'object' && address !== null ? (address as { port?: number }).port : undefined
  if (actual === undefined || actual === requested) return
  process.stdout.write(`\nport ${requested} is already in use; serving on ${actual} instead.\n`)
}

function version(): string {
  // Two levels up from src/cli or dist/cli alike.
  const path = new URL('../../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

function parsePort(value: string | undefined): number | null {
  if (value === undefined) return null
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof SlideParseError) {
    process.stderr.write(`slide: ${error.message}\n`)
  } else {
    process.stderr.write(`slide: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 1
}
