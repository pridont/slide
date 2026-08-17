import type { FontFace } from '../theme/fonts.js'
import type { Theme } from '../theme/tokens.js'

/** Deck-level frontmatter (the leading block of the file). */
export interface DeckMeta {
  title?: string
  description?: string
  slug?: string
  /** e.g. "16/9". */
  aspectRatio?: string
  /** Which half of the token palette to use. Defaults to dark. */
  colorScheme?: 'dark' | 'light'
  /**
   * Design-token overrides, canonical short names to CSS values — see
   * `src/theme/tokens.ts`. Validated as the deck is parsed, so by the time it
   * is here every key is a real token.
   */
  theme?: Theme
  /** Webfaces the deck ships, emitted as `@font-face` — see theme/fonts.ts. */
  fonts?: readonly FontFace[]
}

/** Per-slide frontmatter. */
export interface SlideMeta {
  layout?: string
  class?: string
  background?: string
  /** The picture an `image-left`/`image-right` slide is built around. */
  image?: string
  imageAlt?: string
  transition?: string
  /** Speaker notes supplied via frontmatter instead of a trailing comment. */
  notes?: string
}

export interface Slide {
  /** 1-based position in the deck. */
  readonly index: number
  readonly meta: SlideMeta
  /** Markdown body, frontmatter and notes removed. */
  readonly body: string
  readonly notes: string | null
  /** 1-based line the body starts on, for error reporting and editor sync. */
  readonly sourceLine: number
}

/** Non-fatal authoring problem, surfaced by the CLI and the dev overlay. */
export interface ParseWarning {
  readonly message: string
  /** 1-based. */
  readonly line: number
}

export interface Deck {
  /** Absolute path of the source markdown file. */
  readonly file: string
  readonly meta: DeckMeta
  readonly slides: readonly Slide[]
  readonly warnings: readonly ParseWarning[]
}
