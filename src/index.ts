/**
 * The package entry point, which exists for one reason: a project's
 * `slide.config.ts` is TypeScript, and it should be able to say
 *
 *     import type { ProjectConfig } from 'slide'
 *
 * as the README and the documentation both promise. Everything a config can
 * name is re-exported here; the CLI itself imports from the modules directly.
 */
export type { ProjectConfig } from './project/config.js'
export type { DeckMeta, SlideMeta } from './parse/types.js'
export type { Theme } from './theme/tokens.js'
export type { FontFace } from './theme/fonts.js'
