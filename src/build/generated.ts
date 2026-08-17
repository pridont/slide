import { createHash } from 'node:crypto'
import type { Project } from '../project/index.js'
import { backgroundDeclaration } from '../render/background.js'
import { faceKey, fontFaceRules, type FontFace } from '../theme/fonts.js'
import { themeDeclarations } from '../theme/tokens.js'

/**
 * Per-deck and per-slide custom properties, as real CSS keyed on the
 * `data-deck`/`data-slide` attributes the pages already carry.
 *
 * Not inline `style` attributes: a strict `style-src` blocks those outright,
 * and unlike inline `<style>` elements they cannot be allowed by hash.
 */
export function generateDeckCss(
  project: Project,
  resolveAsset: (ref: string, from: string) => string,
  /** What the diagram pass lifted out of its SVGs — see build/diagrams.ts. */
  diagramCss = '',
): string {
  // `@font-face` is global, so the faces are collected across the project and
  // emitted once, ahead of everything that might use them.
  const rules: string[] = [...fontFaces(project, resolveAsset)]

  // Ahead of the deck's own tokens, so a `theme:` or a project stylesheet can
  // still reach past a diagram's baked-in colours.
  if (diagramCss !== '') rules.push(diagramCss)

  // For the index page, which has no deck. `:root:root` outranks the theme's
  // `:root.light` whatever order the stylesheets load in.
  const projectTokens = themeDeclarations(project.config.theme)
  if (projectTokens !== '') rules.push(`:root:root{${projectTokens}}`)

  for (const target of project.decks) {
    const deckId = target.slug || 'deck'
    const scope = `body[data-deck="${deckId}"]`

    // On <html>, where the base theme derives one token from another
    // (`--slide-color-bg: var(--slide-paper-bg)` under `.light`). A raw palette
    // token overridden further down leaves those derivations already resolved.
    const tokens = themeDeclarations(target.deck.meta.theme)
    if (tokens !== '') rules.push(`html[data-deck="${deckId}"]:root{${tokens}}`)

    const aspect = normalizeAspectRatio(target.deck.meta.aspectRatio)
    if (aspect) rules.push(`${scope}{--slide-aspect:${aspect}}`)

    for (const slide of target.deck.slides) {
      const background = slide.meta.background
      if (!background) continue

      const declaration = backgroundDeclaration(background, (ref) => resolveAsset(ref, target.deck.file))
      rules.push(`${scope}[data-slide="${slide.index}"]{${declaration}}`)
    }
  }

  return rules.join('\n')
}

/**
 * Every deck's faces, deduplicated. Two decks declaring the same family is
 * normal — a project sets one for all of them — but two decks disagreeing
 * about what a family *is* would leave whichever loaded last winning, so that
 * is an error naming both.
 */
function fontFaces(project: Project, resolveAsset: (ref: string, from: string) => string): string[] {
  const seen = new Map<string, { readonly face: FontFace; readonly file: string }>()

  for (const target of project.decks) {
    for (const face of target.deck.meta.fonts ?? []) {
      const key = faceKey(face)
      const first = seen.get(key)

      if (!first) {
        seen.set(key, { face, file: target.deck.file })
        continue
      }
      if (first.face.src === face.src) continue

      throw new Error(
        `two decks declare "${face.family}" as different files:\n` +
          `  ${first.face.src} in ${first.file}\n  ${face.src} in ${target.deck.file}\n` +
          'A font family is global to the page — give one of them another name.',
      )
    }
  }

  return [...seen.values()].flatMap(({ face, file }) =>
    fontFaceRules([face], (ref) => resolveAsset(ref, file)),
  )
}

/** Accepts `16/9` and `16:9`; anything else is passed through as authored. */
export function normalizeAspectRatio(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.includes(':') ? value.replace(':', '/') : value
  return normalized.replace(/[{};<>]/g, '').trim() || null
}

export function hashedFileName(assetsDir: string, stem: string, source: string, extension: string): string {
  const hash = createHash('sha256').update(source).digest('base64url').slice(0, 8)
  return `${assetsDir}/${stem}-${hash}${extension}`
}
