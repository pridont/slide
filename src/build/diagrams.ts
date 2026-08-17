import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type MarkdownIt from 'markdown-it'
import type { Project, ProjectDeck } from '../project/index.js'
import {
  DiagramStyles,
  diagramKey,
  findDiagrams,
  normalizeDiagram,
  type Diagram,
  type DiagramLookup,
} from '../render/diagram.js'
import { faceKey, type FontFace } from '../theme/fonts.js'
import { configHash, mermaidConfig } from '../theme/mermaid.js'
import { resolvePalette } from '../theme/palette.js'
import { mermaidVersion, type DiagramRequest, type MermaidRenderer, type RenderFont } from './mermaid.js'

/**
 * Every diagram in a project, drawn once, with the CSS they were carrying
 * lifted into one stylesheet.
 *
 * This is the pre-pass that lets the render stay synchronous. `markdown-it` is
 * sync from end to end and drawing a diagram is not, so the fences are found,
 * rendered and normalised here, and the renderer only looks the answers up.
 */
export interface DiagramBundle {
  /** Joins the generated deck stylesheet — see `generateDeckCss`. */
  readonly css: string
  /** By deck file, since each deck resolves its own palette. */
  readonly byDeck: ReadonlyMap<string, DiagramLookup>
}

export const EMPTY_DIAGRAMS: DiagramBundle = { css: '', byDeck: new Map() }

export interface RenderProjectDiagramsOptions {
  readonly project: Project
  readonly md: MarkdownIt
  /** Reused across builds in dev, so one browser serves a whole session. */
  readonly renderer: MermaidRenderer
}

export async function renderProjectDiagrams(options: RenderProjectDiagramsOptions): Promise<DiagramBundle> {
  const { project, md, renderer } = options

  const planned = project.decks.map((target) => plan(target, md))
  if (planned.every((deck) => deck.requests.length === 0)) return EMPTY_DIAGRAMS

  // Loaded once for the page, not once per deck: `@font-face` is global, and
  // so is the font set a page can measure in.
  const fonts = await loadFonts(project)
  renderer.configureFonts(fonts)

  const styles = new DiagramStyles()
  const byDeck = new Map<string, DiagramLookup>()
  const sheets: string[] = []

  for (const deck of planned) {
    if (deck.requests.length === 0) continue

    const raw = await renderer.render(deck.requests, deck.config)
    const diagrams = new Map<string, Diagram>()

    for (const request of deck.requests) {
      const svg = raw.get(request.key)
      if (svg === undefined) continue

      const diagram = normalizeDiagram(svg, request.key, styles)
      diagrams.set(request.source, diagram)
      sheets.push(diagram.css)
    }

    byDeck.set(deck.file, (source) => diagrams.get(source))
  }

  return { css: [...sheets, styles.rules()].filter((rule) => rule !== '').join('\n'), byDeck }
}

interface PlannedDeck {
  readonly file: string
  readonly config: Record<string, unknown>
  readonly requests: DiagramRequest[]
}

/** What this deck needs drawn, and in what palette. */
function plan(target: ProjectDeck, md: MarkdownIt): PlannedDeck {
  const { deck } = target

  const palette = resolvePalette(deck.meta.theme, deck.meta.colorScheme)
  const config = mermaidConfig({
    palette,
    fontFamily: palette['font-body'] ?? 'system-ui, sans-serif',
  })
  const hash = configHash(config, mermaidVersion())

  const requests: DiagramRequest[] = []
  const seen = new Set<string>()

  for (const slide of deck.slides) {
    for (const found of findDiagrams(md, slide.body)) {
      const key = diagramKey(found.source, hash)
      // The same diagram twice in a deck is one render.
      if (seen.has(key)) continue
      seen.add(key)

      requests.push({
        key,
        source: found.source,
        file: deck.file,
        line: slide.sourceLine + found.line,
      })
    }
  }

  return { file: deck.file, config, requests }
}

/**
 * The project's faces, read off disk. Two decks declaring the same family is
 * normal — `generateDeckCss` is the one that errors when they disagree about
 * what it is — so the first of a key wins here.
 */
async function loadFonts(project: Project): Promise<RenderFont[]> {
  const seen = new Set<string>()
  const fonts: RenderFont[] = []

  for (const target of project.decks) {
    for (const face of target.deck.meta.fonts ?? []) {
      const key = faceKey(face)
      if (seen.has(key)) continue
      seen.add(key)

      const data = await readFace(face, target.deck.file)
      if (data) fonts.push({ family: face.family, data, ...weightAndStyle(face) })
    }
  }

  return fonts
}

async function readFace(face: FontFace, from: string): Promise<Buffer | null> {
  try {
    return await readFile(resolve(dirname(from), face.src))
  } catch {
    // A missing face is already reported by the asset pass; a diagram just
    // measures in whatever the stack falls back to.
    return null
  }
}

function weightAndStyle(face: FontFace): { weight?: string; style?: string } {
  return {
    ...(face.weight !== undefined ? { weight: face.weight } : {}),
    ...(face.style !== undefined ? { style: face.style } : {}),
  }
}
